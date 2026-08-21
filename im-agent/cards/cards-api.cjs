'use strict';
/**
 * cards-api.cjs — 명함 사진 → Claude Vision 파싱 → 중복 검사 → 확정 저장
 *
 * 공급물(Express 라우터, 2026-08-21)을 본체 서버(im-engine-server.cjs, 의존성 0 순수 http)
 * 방식으로 이식한 것. Express·@anthropic-ai/sdk 는 들이지 않는다 —
 *   · 라우트는 ui/routes.cjs 표(ROUTES) + createHandlers() 로 낸다 (report-api 와 같은 계약)
 *   · Anthropic 호출은 내장 fetch 로 messages API 를 직접 부른다
 *   · better-sqlite3 만 유일한 외부 의존성 — im-agent 는 tar 통째 배포(맥→NAS)라
 *     네이티브 모듈을 안에 둘 수 없다. NAS 의 별도 폴더(LP_CARDS_DEPS)에서 지연 로드하고,
 *     없으면 503 에 설치 방법을 말한다(조용한 실패 금지).
 *
 * ★ 저장 축 구분 — 앱 연락처의 권위는 /volume1/web/linkpilot_data.store.php (sync.php).
 *   여기 SQLite 는 「명함 원본 아카이브·이력·전문검색」 축이다. confirm 은 appContact
 *   (앱 contacts 필드 모양)를 돌려주고, 앱 화면에 보이게 하는 것은 프론트가 기존
 *   저장 동선(로컬 저장 → sync)으로 한다. 서버가 store.php 를 직접 쓰지 않는다 —
 *   두 벌이 서로 권위를 다투는 순간 한쪽만 고치는 날이 온다.
 *
 * 인증 — 본체 서버의 authenticate(Bearer, login.php 발급)를 주입받아 전 라우트에 적용.
 *   8181 은 Funnel 역프록시로 공개망에 닿는다. 무인증 라우트를 내면 안 된다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ── 명함 파싱 프롬프트 (핵심 자산 — 튜닝은 여기서) ───────────── */
const CARD_PARSE_PROMPT = `당신은 한국 비즈니스 명함 전문 파서입니다. 첨부된 명함 이미지(앞면, 있으면 뒷면 포함)에서 정보를 추출해 JSON만 출력하세요.

## 출력 형식 (이 JSON 외 어떤 텍스트도 출력 금지 — 마크다운 백틱 금지)
{
  "name_ko": "홍길동",
  "name_en": "Gil-dong Hong 또는 null",
  "company_ko": "회사명 국문 또는 null",
  "company_en": "회사명 영문 또는 null",
  "department": "부서 또는 null",
  "title": "직함 또는 null",
  "mobile": "010-0000-0000 또는 null",
  "phone": "02-000-0000 또는 null",
  "fax": "또는 null",
  "email": "소문자 또는 null",
  "website": "또는 null",
  "address": "또는 null",
  "biz_reg_no": "사업자등록번호 000-00-00000 또는 null",
  "sns": "카카오ID/링크드인 등 또는 null",
  "extra": "위 항목에 안 들어가는 정보(자격, 슬로건 등) 또는 null",
  "raw_text": "명함에 보이는 모든 텍스트를 줄 단위로",
  "confidence": 0.0에서 1.0 사이 숫자,
  "low_confidence_fields": ["판독이 불확실한 필드명 배열"]
}

## 추출 규칙
1. 이름과 직함 분리: "홍길동 상무" → name_ko="홍길동", title="상무". 직함이 이름에 섞이지 않게 할 것.
2. 전화번호 정규화: 숫자만 남기고 한국 표준 하이픈 재삽입 (휴대폰 010-XXXX-XXXX, 서울 02-XXX(X)-XXXX, 지역 0XX-XXX(X)-XXXX). +82 국제표기는 0으로 치환.
3. M/Mobile/HP/C.P → mobile, T/Tel/Office → phone, F/Fax → fax 로 매핑.
4. 세로쓰기·회전된 명함도 읽을 것. 앞뒤 양면이 주어지면 통합하되, 한 면이 영문이면 name_en/company_en에 배치.
5. 회사명에서 법인격 표기는 유지 ("(주)", "주식회사", "Co., Ltd.").
6. 확실하지 않은 값은 추측하지 말고 null 처리 후 low_confidence_fields에 명시. 읽었지만 애매한 글자는 raw_text에는 그대로 기록.
7. 명함이 아닌 이미지(영수증, 문서 등)이면: {"error": "not_a_business_card", "raw_text": "..."} 만 출력.`;

/* ── better-sqlite3 지연 로드 ─────────────────────────────────── */
function loadSqlite() {
  const tried = [];
  const cands = [];
  if (process.env.LP_CARDS_DEPS) cands.push(path.join(process.env.LP_CARDS_DEPS, 'better-sqlite3'));
  cands.push('better-sqlite3');
  for (const c of cands) {
    try { return { Database: require(c) }; } catch (e) { tried.push(`${c}: ${e.code || e.message}`); }
  }
  return { error: 'better-sqlite3 을 찾지 못했습니다 (' + tried.join(' / ') + '). ' +
    'NAS: mkdir -p /volume1/docker/linkpilot/cards-runtime && cd 거기 && npm i better-sqlite3, ' +
    '실행 환경변수 LP_CARDS_DEPS=/volume1/docker/linkpilot/cards-runtime/node_modules' };
}

/* ── Anthropic 키 — env 또는 키 파일(/volume1/web/*_key.txt 관례) ── */
function readKey(keyFile) {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  try { const v = fs.readFileSync(keyFile, 'utf8').trim(); if (v) return v; } catch (_) {}
  return null;
}

function b64ToBuf(s) { return Buffer.from(String(s).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
function extOf(mediaType) { return mediaType === 'image/png' ? '.png' : mediaType === 'image/webp' ? '.webp' : '.jpg'; }

function createHandlers(opts) {
  const {
    authenticate,                                     // 필수 — 본체와 같은 토큰 규칙
    dbPath = process.env.LINKPILOT_DB || './linkpilot.db',
    imageDir = process.env.LP_CARDS_IMAGES || path.join(path.dirname(dbPath), 'cards-images'),
    keyFile = process.env.ANTHROPIC_KEY_FILE || '/volume1/web/anthropic_key.txt',
    model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    fetchImpl = fetch,
  } = opts || {};
  if (typeof authenticate !== 'function') throw new Error('cards-api: authenticate 주입이 필요합니다 (무인증 라우트 금지)');

  let dbHandle = null, dbError = null;
  function db() {
    if (dbHandle) return dbHandle;
    if (dbError) throw Object.assign(new Error(dbError), { status: 503 });
    const sq = loadSqlite();
    if (sq.error) { dbError = sq.error; throw Object.assign(new Error(dbError), { status: 503 }); }
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    const h = new sq.Database(dbPath);
    h.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));   // idempotent (IF NOT EXISTS)
    dbHandle = h;
    return h;
  }

  function saveImage(base64, mediaType, suffix) {
    const d = new Date();
    const dir = path.join(imageDir, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'));
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, crypto.randomUUID() + '-' + suffix + extOf(mediaType));
    fs.writeFileSync(f, b64ToBuf(base64));
    return f;
  }

  function findDuplicates(p) {
    return db().prepare(`
      SELECT c.id, c.name, c.title, c.mobile, c.email, co.name AS company
      FROM contacts c LEFT JOIN companies co ON co.id = c.company_id
      WHERE (c.mobile = @mobile AND @mobile IS NOT NULL)
         OR (c.email  = @email  AND @email  IS NOT NULL)
         OR (c.name   = @name   AND co.name = @company AND @company IS NOT NULL)
    `).all({
      mobile: p.mobile ?? null, email: p.email ?? null,
      name: p.name_ko ?? null, company: p.company_ko ?? null,
    });
  }

  const H = {
    /* GET /cards/status — 준비 상태. 조용히 실패하는 축(키·DB)을 화면이 물을 수 있게 한다 */
    cardsStatus(ctx) {
      const user = authenticate(ctx);
      if (!user) return { status: 401, body: { error: '로그인이 필요합니다' } };
      let dbOk = false, dbMsg = null;
      try { db(); dbOk = true; } catch (e) { dbMsg = e.message; }
      const key = readKey(keyFile);
      return { status: 200, body: { ok: dbOk && !!key, db: dbOk ? 'ready' : dbMsg, anthropicKey: key ? 'ready' : ('없음 — ' + keyFile + ' 에 키를 넣거나 ANTHROPIC_API_KEY 를 설정하세요'), model } };
    },

    /* POST /cards/parse — 파싱 + 중복 후보 조회 */
    async cardsParse(ctx) {
      const user = authenticate(ctx);
      if (!user) return { status: 401, body: { error: '로그인이 필요합니다' } };
      const { imageBase64, mediaType = 'image/jpeg', imageBackBase64, eventContext } = ctx.body || {};
      if (!imageBase64) return { status: 400, body: { error: 'imageBase64 required' } };
      const key = readKey(keyFile);
      if (!key) return { status: 501, body: { error: 'anthropic_key_missing', hint: keyFile + ' 에 키를 넣거나 ANTHROPIC_API_KEY 를 설정하세요' } };

      const content = [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: String(imageBase64).replace(/^data:[^;]+;base64,/, '') } }];
      if (imageBackBase64) content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: String(imageBackBase64).replace(/^data:[^;]+;base64,/, '') } });
      content.push({ type: 'text', text: CARD_PARSE_PROMPT });

      const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content }] }),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        return { status: 502, body: { error: 'anthropic_' + r.status, detail: detail.slice(0, 500) } };
      }
      const msg = await r.json();
      const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      let parsed;
      try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); }
      catch (_) { return { status: 502, body: { error: 'parse_failed', raw: text.slice(0, 2000) } }; }
      if (parsed.error) return { status: 422, body: parsed };

      return { status: 200, body: { parsed, duplicates: findDuplicates(parsed), eventContext: eventContext ?? null } };
    },

    /* POST /cards/confirm — 검토 화면에서 확정한 데이터 저장
       body: { parsed, imageFrontBase64, imageBackBase64?, mediaType?, receivedDate?, eventContext?, mergeIntoContactId? } */
    cardsConfirm(ctx) {
      const user = authenticate(ctx);
      if (!user) return { status: 401, body: { error: '로그인이 필요합니다' } };
      const { parsed: p, imageFrontBase64, imageBackBase64, mediaType = 'image/jpeg',
              receivedDate, eventContext, mergeIntoContactId } = ctx.body || {};
      if (!p || !p.name_ko || !imageFrontBase64) return { status: 400, body: { error: 'parsed.name_ko 와 imageFrontBase64 가 필요합니다' } };

      const D = db();
      const frontPath = saveImage(imageFrontBase64, mediaType, 'front');
      const backPath = imageBackBase64 ? saveImage(imageBackBase64, mediaType, 'back') : null;

      const tx = D.transaction(() => {
        let companyId = null;
        if (p.company_ko) {
          D.prepare(`INSERT INTO companies (name, name_en, address, website, biz_reg_no)
                     VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO NOTHING`)
            .run(p.company_ko, p.company_en ?? null, p.address ?? null, p.website ?? null, p.biz_reg_no ?? null);
          companyId = D.prepare(`SELECT id FROM companies WHERE name = ?`).get(p.company_ko)?.id ?? null;
        }

        let contactId = mergeIntoContactId ?? null;
        if (contactId) {
          // 병합: 변경 필드는 이력 기록 후 갱신 (새 명함 = 최신 정보로 간주)
          const old = D.prepare(`SELECT * FROM contacts WHERE id = ?`).get(contactId);
          if (!old) throw Object.assign(new Error('mergeIntoContactId ' + contactId + ' 가 없습니다'), { status: 404 });
          const updates = { title: p.title, department: p.department, mobile: p.mobile,
                            phone: p.phone, email: p.email, company_id: companyId };
          for (const [field, val] of Object.entries(updates)) {
            if (val != null && String(old[field] ?? '') !== String(val)) {
              D.prepare(`INSERT INTO contact_history (contact_id, field, old_value, new_value, source)
                         VALUES (?, ?, ?, ?, 'card')`).run(contactId, field, old[field] == null ? null : String(old[field]), String(val));
              D.prepare(`UPDATE contacts SET ${field} = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
                .run(val, contactId);
            }
          }
        } else {
          const info = D.prepare(`
            INSERT INTO contacts (name, name_en, company_id, title, department, mobile, phone, fax, email, address, memo, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'card')
          `).run(p.name_ko, p.name_en ?? null, companyId, p.title ?? null, p.department ?? null, p.mobile ?? null,
                 p.phone ?? null, p.fax ?? null, p.email ?? null, p.address ?? null, p.extra ?? null);
          contactId = info.lastInsertRowid;
          D.prepare(`INSERT INTO contacts_fts (rowid, name, name_en, company, title, department, memo, raw_text)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(contactId, p.name_ko, p.name_en ?? null, p.company_ko ?? null, p.title ?? null, p.department ?? null, p.extra ?? null, p.raw_text ?? '');
        }

        D.prepare(`
          INSERT INTO cards (contact_id, image_front, image_back, parsed_json, raw_text, confidence,
                             received_date, event_context, reviewed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(contactId, frontPath, backPath, JSON.stringify(p), p.raw_text ?? null,
               p.confidence ?? null, receivedDate ?? null, eventContext ?? null);
        return contactId;
      });

      let contactId;
      try { contactId = tx(); }
      catch (e) {
        // 트랜잭션이 죽으면 방금 쓴 이미지 파일은 고아 — 지워서 짝을 맞춘다
        try { fs.unlinkSync(frontPath); } catch (_) {}
        if (backPath) { try { fs.unlinkSync(backPath); } catch (_) {} }
        throw e;
      }

      /* appContact — 앱(store.php 축) contacts 필드 모양. 프론트가 기존 저장 동선으로 넣는다 */
      const appContact = {
        id: 'card_' + Date.now().toString(36) + '_' + contactId,
        name: p.name_ko, org: p.company_ko || '', dept: p.department || '', role: p.title || '',
        phone: p.phone || '', mobile: p.mobile || '', fax: p.fax || '', email: (p.email || '').toLowerCase(),
        address: p.address || '', website: p.website || '', memo: p.extra || '',
        tags: [], ocrRaw: p.raw_text || '', createdAt: Date.now(), updatedAt: Date.now(),
      };
      return { status: 200, body: { ok: true, contactId, merged: !!mergeIntoContactId, appContact } };
    },
  };

  return H;
}

/* 라우트 표 — report-api ROUTES 와 같은 계약: match() 가 돌려준 항목의 call(h, ctx, params) 를 서버가 부른다 */
const ROUTES = [
  { method: 'GET',  path: '/cards/status',  handler: 'cardsStatus',  call: (h, ctx) => h.cardsStatus(ctx) },
  { method: 'POST', path: '/cards/parse',   handler: 'cardsParse',   call: (h, ctx) => h.cardsParse(ctx) },
  { method: 'POST', path: '/cards/confirm', handler: 'cardsConfirm', call: (h, ctx) => h.cardsConfirm(ctx) },
];

module.exports = { createHandlers, ROUTES, CARD_PARSE_PROMPT };
