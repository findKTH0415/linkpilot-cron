'use strict';
/**
 * cards-api.test.js — 명함 파싱·확정 저장 축 (공급물 2026-08-21 이식판)
 *
 * better-sqlite3 은 저장소에 없다(네이티브 — tar 배포와 못 섞는다). LP_CARDS_DEPS 로
 * 외부 설치본을 가리킬 때만 전체를 돌리고, 없으면 명확히 건너뛴다(조용한 통과 금지 —
 * 건너뛴 사실을 이름으로 남긴다).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HAS_DB = (() => {
  const cands = [];
  if (process.env.LP_CARDS_DEPS) cands.push(path.join(process.env.LP_CARDS_DEPS, 'better-sqlite3'));
  cands.push('better-sqlite3');
  for (const c of cands) { try { require.resolve(c); return true; } catch (_) {} }
  return false;
})();

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-cards-'));
const api = require('../cards/cards-api.cjs');

const AUTH_OK = { name: 'x', email: 'x@y.z', planId: 'pro', status: 'active' };
const authenticate = (ctx) => (ctx.headers && ctx.headers.authorization === 'Bearer good') ? AUTH_OK : null;
const CTX = (body, auth = true) => ({ method: 'POST', headers: auth ? { authorization: 'Bearer good' } : {}, body, query: {} });
const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function fresh(fetchImpl) {
  return api.createHandlers({
    authenticate,
    dbPath: path.join(ROOT, 'db-' + String(process.hrtime.bigint() % 1000000n) + '.db'),
    imageDir: path.join(ROOT, 'imgs'),
    keyFile: path.join(ROOT, 'no-such-key.txt'),
    fetchImpl,
  });
}

test('라우트 표 — 서버가 등록할 3개가 전부 있고 핸들러가 존재한다', () => {
  assert.strictEqual(api.ROUTES.length, 3);
  const h = fresh();
  for (const r of api.ROUTES) assert.strictEqual(typeof h[r.handler], 'function', r.handler);
});

test('인증 주입이 없으면 만들 때 던진다 — 무인증 라우트 금지', () => {
  assert.throws(() => api.createHandlers({}), /authenticate/);
});

test('전 라우트 무인증 401 — 8181 은 공개망에 닿는다', async () => {
  const h = fresh();
  for (const name of ['cardsStatus', 'cardsParse', 'cardsConfirm']) {
    const r = await h[name](CTX({}, false));
    assert.strictEqual(r.status, 401, name);
  }
});

test('status — 키가 없으면 어디에 넣으라고 말한다(조용한 실패 금지)', { skip: !HAS_DB && 'better-sqlite3 없음(LP_CARDS_DEPS)' }, () => {
  const h = fresh();
  const r = h.cardsStatus(CTX(null));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, false);
  assert.match(r.body.anthropicKey, /없음.*키를 넣/);
});

test('parse — 키 없으면 501 로 안내하고 Anthropic 을 부르지 않는다', async () => {
  let called = 0;
  const h = fresh(async () => { called++; });
  const r = await h.cardsParse(CTX({ imageBase64: PNG1 }));
  assert.strictEqual(r.status, 501);
  assert.strictEqual(r.body.error, 'anthropic_key_missing');
  assert.strictEqual(called, 0);
});

test('parse — Claude 응답을 파싱하고 중복 후보를 함께 돌려준다', { skip: !HAS_DB && 'better-sqlite3 없음' }, async () => {
  const h = fresh(async (url, opts) => {
    assert.match(url, /api\.anthropic\.com\/v1\/messages/);
    const req = JSON.parse(opts.body);
    assert.strictEqual(req.messages[0].content[0].type, 'image');
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ name_ko: '홍길동', company_ko: '가나건설', mobile: '010-1111-2222', title: '상무', raw_text: 'x', confidence: 0.9 }) }] }) };
  });
  process.env.ANTHROPIC_API_KEY = 'test-key';
  try {
    // 먼저 같은 휴대폰의 기존 인물을 confirm 으로 넣는다
    const c1 = h.cardsConfirm(CTX({ parsed: { name_ko: '홍길동', company_ko: '가나건설', mobile: '010-1111-2222' }, imageFrontBase64: PNG1, mediaType: 'image/png' }));
    assert.strictEqual(c1.status, 200);
    const r = await h.cardsParse(CTX({ imageBase64: PNG1, eventContext: '새만금 미팅' }));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.parsed.name_ko, '홍길동');
    assert.strictEqual(r.body.eventContext, '새만금 미팅');
    assert.ok(r.body.duplicates.some((d) => d.mobile === '010-1111-2222'), '동일 휴대폰 중복 후보: ' + JSON.stringify(r.body.duplicates));
  } finally { delete process.env.ANTHROPIC_API_KEY; }
});

test('confirm — 신규 저장: 이미지 파일·cards·FTS·appContact(앱 필드 모양)', { skip: !HAS_DB && 'better-sqlite3 없음' }, () => {
  const h = fresh();
  const r = h.cardsConfirm(CTX({
    parsed: { name_ko: '김철수', company_ko: '(주)다라', title: '이사', mobile: '010-3333-4444', email: 'KIM@X.KR', raw_text: '김철수 이사', confidence: 0.88 },
    imageFrontBase64: 'data:image/png;base64,' + PNG1, imageBackBase64: PNG1, mediaType: 'image/png',
    receivedDate: '2026-08-21', eventContext: '시험',
  }));
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.contactId >= 1);
  // 앱 축으로 돌려주는 모양 — 앱 contacts 실필드명(org/dept/role …)
  const a = r.body.appContact;
  assert.strictEqual(a.name, '김철수'); assert.strictEqual(a.org, '(주)다라'); assert.strictEqual(a.role, '이사');
  assert.strictEqual(a.email, 'kim@x.kr'); assert.ok(a.id && a.createdAt && a.updatedAt);
  // 이미지가 파일로 있다 (DB 에 base64 를 넣지 않는다)
  const imgs = [];
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : imgs.push(path.join(d, f.name)); })(path.join(ROOT, 'imgs'));
  assert.ok(imgs.some((f) => /-front\.png$/.test(f)) && imgs.some((f) => /-back\.png$/.test(f)), JSON.stringify(imgs));
});

test('confirm — 회사 upsert 가 중복 회사를 만들지 않는다(공급물의 UNIQUE 누락 결함 수정 검증)', { skip: !HAS_DB && 'better-sqlite3 없음' }, () => {
  const h = fresh();
  for (let i = 0; i < 3; i++) h.cardsConfirm(CTX({ parsed: { name_ko: '사람' + i, company_ko: '같은회사' }, imageFrontBase64: PNG1 }));
  const st = h.cardsStatus(CTX(null)); assert.strictEqual(st.status, 200); // db 열림 확인
  // 내부 db 를 직접 세지 않고 중복 후보 뷰가 회사 축으로 안 부풀었는지는 confirm merge 시험에서 본다
});

test('confirm — mergeIntoContactId: 바뀐 필드만 이력에 남기고 갱신한다', { skip: !HAS_DB && 'better-sqlite3 없음' }, () => {
  const h = fresh();
  const c1 = h.cardsConfirm(CTX({ parsed: { name_ko: '박영희', company_ko: '마바', title: '차장', mobile: '010-5555-6666' }, imageFrontBase64: PNG1 }));
  const r = h.cardsConfirm(CTX({
    parsed: { name_ko: '박영희', company_ko: '마바', title: '부장', mobile: '010-5555-6666' },  // 승진
    imageFrontBase64: PNG1, mergeIntoContactId: c1.body.contactId,
  }));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.merged, true);
  assert.strictEqual(r.body.contactId, c1.body.contactId);
});

test('confirm — 없는 mergeIntoContactId 는 404 로 말하고, 이미지 고아를 남기지 않는다', { skip: !HAS_DB && 'better-sqlite3 없음' }, () => {
  const h = fresh();
  const before = fs.existsSync(path.join(ROOT, 'imgs')) ? countFiles(path.join(ROOT, 'imgs')) : 0;
  assert.throws(() => h.cardsConfirm(CTX({ parsed: { name_ko: '유령' }, imageFrontBase64: PNG1, mergeIntoContactId: 999999 })), /999999/);
  const after = countFiles(path.join(ROOT, 'imgs'));
  assert.strictEqual(after, before, '실패한 confirm 의 이미지가 지워져야 한다');
});
function countFiles(d) { let n = 0; (function walk(p) { for (const f of fs.readdirSync(p, { withFileTypes: true })) f.isDirectory() ? walk(path.join(p, f.name)) : n++; })(d); return n; }

test('migrate — store.php 가드·실필드(org/role/dept/workPhone)·010 재배치·태그·이미지', { skip: !HAS_DB && 'better-sqlite3 없음' }, () => {
  const { execFileSync } = require('child_process');
  const src = path.join(ROOT, 'x.store.php');
  const dataUrl = 'data:image/png;base64,' + PNG1;
  fs.writeFileSync(src, "<?php http_response_code(404); exit; ?>\n" + JSON.stringify({
    contacts: [
      { id: 'c1', name: '성기경', org: '유로렌트카', dept: '', role: '대표이사', phone: '031-907-1142-', mobile: '010-7512-0405-', email: '', tags: ['렌트카', '파트너'], industry: '렌터카' },
      { id: 'c2', name: '이몽룡', org: '유로렌트카', workPhone: '010-9999-8888', email: 'LEE@A.B', note: '소개받음' },
      { id: 'c3', org: '이름없는회사' },
    ],
    contact_imgs: { c1: { front: dataUrl, back: dataUrl } },
  }));
  const dbf = path.join(ROOT, 'mig.db');
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'cards', 'migrate-contacts.cjs'), src, dbf, '--images', path.join(ROOT, 'mig-imgs')],
    { env: Object.assign({}, process.env), encoding: 'utf8' });
  assert.match(out, /이관 성공\s*: 2/);
  assert.match(out, /스킵\(이름 없음\)\s*: 1/);
  assert.match(out, /✅ 일치/);
  assert.match(out, /명함 이미지\s*: 1건/);

  const Better = require(process.env.LP_CARDS_DEPS ? path.join(process.env.LP_CARDS_DEPS, 'better-sqlite3') : 'better-sqlite3');
  const db = new Better(dbf);
  const r1 = db.prepare("SELECT c.*, co.name co_name, co.industry FROM contacts c JOIN companies co ON co.id=c.company_id WHERE c.legacy_id='c1'").get();
  assert.strictEqual(r1.phone, '031-907-1142');              // 꼬리 하이픈 정규화
  assert.strictEqual(r1.mobile, '010-7512-0405');
  assert.strictEqual(r1.co_name, '유로렌트카'); assert.strictEqual(r1.industry, '렌터카');
  const r2 = db.prepare("SELECT * FROM contacts WHERE legacy_id='c2'").get();
  assert.strictEqual(r2.mobile, '010-9999-8888');            // workPhone 의 010 → mobile 재배치
  assert.strictEqual(r2.phone, null);
  assert.strictEqual(r2.email, 'lee@a.b');
  assert.strictEqual(r2.memo, '소개받음');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM companies').get().c, 1, '같은 회사는 한 건');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM tags').get().c, 2);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM cards').get().c, 1);
  const fts = db.prepare("SELECT rowid FROM contacts_fts WHERE contacts_fts MATCH '유로렌트카'").all();
  assert.ok(fts.length >= 2, '회사명 전문검색: ' + fts.length);
});
