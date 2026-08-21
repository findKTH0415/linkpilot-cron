'use strict';
/**
 * migrate-contacts.cjs — LinkPilot store.php(백업본) 또는 contacts.json → linkpilot.db 이관
 *
 * 사용법 (NAS):
 *   LP_CARDS_DEPS=/volume1/docker/linkpilot/cards-runtime/node_modules \
 *   node migrate-contacts.cjs /volume1/web/linkpilot_data.before-contacts-reset-20260821.store.php \
 *        /volume1/docker/linkpilot/linkpilot.db [--images /volume1/docker/linkpilot/cards-images]
 *
 * 입력이 .store.php 면 PHP 가드 줄을 벗기고 JSON 을 읽어 contacts + contact_imgs 를 쓴다.
 * 일반 JSON(배열 또는 {contacts:[...]})도 받는다.
 *
 * 검증 원칙: 이관 후 원본 건수 == DB 건수 확인, 매핑 안 된 필드는 전부 로그 출력.
 * ★ 이 이관은 「아카이브 축」이다 — 앱(store.php)의 연락처는 건드리지 않는다.
 *   2026-08-21 초기화로 앱은 빈 상태에서 새로 입력하고, 옛 1190건은 여기서 검색 가능해진다.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [srcPath = './contacts.json', dbPath = './linkpilot.db'] = args;
const imgIdx = process.argv.indexOf('--images');
const imageDir = imgIdx > -1 ? process.argv[imgIdx + 1] : null;

/* ── 원본 필드명 → DB 컬럼 매핑 — 2026-08-21 백업본 실측 필드 기준 ──
   (name/org/dept/role/phone/workPhone/mobile/fax/email/address/website/memo/note/id …) */
const FIELD_MAP = {
  name: ['name', '이름', '성명'],
  name_en: ['name_en', 'englishName'],
  company: ['org', 'company', '회사', '회사명', 'organization'],
  title: ['role', 'title', '직함', '직책', 'position'],
  department: ['dept', 'department', '부서', 'team'],
  mobile: ['mobile', '휴대폰', '핸드폰', 'cell', 'phone_mobile'],
  phone: ['phone', 'workPhone', '전화', '유선', 'tel', 'office_phone'],
  fax: ['fax', '팩스'],
  email: ['email', '이메일', 'mail'],
  address: ['address', '주소'],
  website: ['website'],
  memo: ['memo', 'note', 'networkNote', '메모', 'notes'],
  legacy_id: ['id', '_id', 'uid'],
  industry: ['industry'],       // → companies.industry
  tags: ['tags'],               // → tags/contact_tags
  raw_text: ['ocrRaw'],         // → contacts_fts.raw_text
};

const pick = (obj, keys) => {
  for (const k of keys) if (obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
  return null;
};

// 전화번호 정규화: 숫자만 추출 후 하이픈 재삽입 (백업본에 "031-907-1142-" 류 꼬리 하이픈이 있다)
const normPhone = (v) => {
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('010')) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10 && d.startsWith('02')) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9 && d.startsWith('02')) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return v.trim();
};

/* ── 입력 읽기 — store.php 가드 대응 ── */
let rawText = fs.readFileSync(srcPath, 'utf8');
if (/\.store\.php$/.test(srcPath) || rawText.startsWith('<?php')) rawText = rawText.slice(rawText.indexOf('{'));
const raw = JSON.parse(rawText);
const list = Array.isArray(raw) ? raw : raw.contacts || Object.values(raw);
if (!Array.isArray(list)) throw new Error('contacts 구조를 배열로 해석하지 못했습니다.');
const contactImgs = (!Array.isArray(raw) && raw.contact_imgs && typeof raw.contact_imgs === 'object') ? raw.contact_imgs : {};

/* ── DB — cards-api 와 같은 로더·스키마 적용 ── */
process.env.LINKPILOT_DB = dbPath;
const cardsApi = require('./cards-api.cjs');
const sqlTried = (() => { // loadSqlite 는 내부 함수라 같은 규칙으로 직접 로드
  const cands = [];
  if (process.env.LP_CARDS_DEPS) cands.push(path.join(process.env.LP_CARDS_DEPS, 'better-sqlite3'));
  cands.push('better-sqlite3');
  for (const c of cands) { try { return require(c); } catch (_) {} }
  throw new Error('better-sqlite3 없음 — LP_CARDS_DEPS 를 설정하세요 (cards-api.cjs 상단 설명 참조)');
})();
const db = new sqlTried(dbPath);
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
db.pragma('foreign_keys = ON');

const insCompany = db.prepare(`INSERT INTO companies (name, industry) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`);
const getCompany = db.prepare(`SELECT id FROM companies WHERE name = ?`);
const insContact = db.prepare(`
  INSERT INTO contacts (name, name_en, company_id, title, department,
                        mobile, phone, fax, email, address, website, memo, source, legacy_id)
  VALUES (@name, @name_en, @company_id, @title, @department,
          @mobile, @phone, @fax, @email, @address, @website, @memo, 'import', @legacy_id)
`);
const insFts = db.prepare(`
  INSERT INTO contacts_fts (rowid, name, name_en, company, title, department, memo, raw_text)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insTag = db.prepare(`INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING`);
const getTag = db.prepare(`SELECT id FROM tags WHERE name = ?`);
const insContactTag = db.prepare(`INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)`);
const insCard = db.prepare(`
  INSERT INTO cards (contact_id, image_front, image_back, raw_text, received_date, event_context, reviewed)
  VALUES (?, ?, ?, ?, ?, 'store.php 이관', 1)
`);

const knownKeys = new Set(Object.values(FIELD_MAP).flat());
const unmappedKeys = new Set();
let ok = 0, skipped = 0, imgSaved = 0;

const b64ToBuf = (s) => Buffer.from(String(s).replace(/^data:[^;]+;base64,/, ''), 'base64');
function saveImg(id, side, dataUrl) {
  const m = /^data:image\/(png|webp|jpe?g)/.exec(String(dataUrl));
  const ext = m ? (m[1] === 'png' ? '.png' : m[1] === 'webp' ? '.webp' : '.jpg') : '.jpg';
  const dir = path.join(imageDir, 'import');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, String(id).replace(/[^A-Za-z0-9_-]/g, '_') + '-' + side + ext);
  fs.writeFileSync(f, b64ToBuf(dataUrl));
  return f;
}

const run = db.transaction(() => {
  for (const row of list) {
    Object.keys(row).forEach((k) => { if (!knownKeys.has(k)) unmappedKeys.add(k); });

    const name = pick(row, FIELD_MAP.name);
    if (!name) { skipped++; continue; }        // 이름 없는 레코드는 별도 확인

    const companyName = pick(row, FIELD_MAP.company);
    let company_id = null;
    if (companyName) {
      insCompany.run(companyName, pick(row, FIELD_MAP.industry));
      company_id = getCompany.get(companyName)?.id ?? null;
    }

    // 백업본은 유선(phone) 칸에 010 이 든 항목이 있다 — 숫자 기준으로 자리 재배치
    let mobile = normPhone(pick(row, FIELD_MAP.mobile));
    let phone = normPhone(pick(row, FIELD_MAP.phone));
    if (!mobile && phone && phone.startsWith('010')) { mobile = phone; phone = null; }

    const rec = {
      name,
      name_en: pick(row, FIELD_MAP.name_en),
      company_id,
      title: pick(row, FIELD_MAP.title),
      department: pick(row, FIELD_MAP.department),
      mobile, phone,
      fax: normPhone(pick(row, FIELD_MAP.fax)),
      email: pick(row, FIELD_MAP.email)?.toLowerCase() ?? null,
      address: pick(row, FIELD_MAP.address),
      website: pick(row, FIELD_MAP.website),
      memo: pick(row, FIELD_MAP.memo),
      legacy_id: pick(row, FIELD_MAP.legacy_id),
    };
    const info = insContact.run(rec);
    const cid = info.lastInsertRowid;
    insFts.run(cid, rec.name, rec.name_en, companyName, rec.title, rec.department, rec.memo, pick(row, FIELD_MAP.raw_text) ?? '');

    if (Array.isArray(row.tags)) for (const t of row.tags) {
      const tn = String(t).trim(); if (!tn) continue;
      insTag.run(tn); const tid = getTag.get(tn)?.id;
      if (tid) insContactTag.run(cid, tid);
    }

    // 명함 이미지 — store.php 는 contact_imgs[id]={front,back} 분리 저장이었다
    if (imageDir && rec.legacy_id && contactImgs[rec.legacy_id]) {
      const im = contactImgs[rec.legacy_id];
      const front = im.front ? saveImg(rec.legacy_id, 'front', im.front) : null;
      const back = im.back ? saveImg(rec.legacy_id, 'back', im.back) : null;
      if (front) { insCard.run(cid, front, back, pick(row, FIELD_MAP.raw_text) ?? null, row.createdAt ? new Date(row.createdAt).toISOString().slice(0, 10) : null); imgSaved++; }
    }
    ok++;
  }
});
run();

/* ── 이관 검증 리포트 ── */
const dbCount = db.prepare(`SELECT COUNT(*) c FROM contacts WHERE source='import'`).get().c;
const dupCount = db.prepare(`SELECT COUNT(*) c FROM v_duplicate_candidates`).get().c;
const coCount = db.prepare(`SELECT COUNT(*) c FROM companies`).get().c;

console.log('========== 이관 결과 ==========');
console.log(`원본 레코드      : ${list.length}`);
console.log(`이관 성공        : ${ok}`);
console.log(`스킵(이름 없음)  : ${skipped}`);
console.log(`회사             : ${coCount}`);
console.log(`명함 이미지      : ${imgSaved}건 저장${imageDir ? '' : ' (—images 미지정: 건너뜀)'}`);
console.log(`DB 반영 건수     : ${dbCount}  ${dbCount === ok ? '✅ 일치' : '❌ 불일치 — 확인 필요'}`);
console.log(`중복 후보        : ${dupCount}건 → SELECT * FROM v_duplicate_candidates;`);
if (unmappedKeys.size) {
  console.log(`⚠️  매핑 안 된 원본 필드: ${[...unmappedKeys].join(', ')}`);
  console.log('   → 필요 시 FIELD_MAP에 추가 후 DB 삭제하고 재실행');
}
void cardsApi; // 스키마 공유 확인용 참조
