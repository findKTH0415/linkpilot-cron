'use strict';
/**
 * scan.test.js — **넣은 자료를 값으로 만드는 한 길** (2026-08-21 사용자 지시).
 *
 * ★★ 왜 생겼나: 셋(앱에서 가져오기 · 폴더 연결 · 파일업로드) 중 무엇으로 넣든
 *   자료는 **넣기만** 되고 읽히지 않았다. 읽는 것은 보고서를 만드는 순간이었다.
 *   그래서 자료를 넣은 사람이 2단계에 가면 **빈 칸만** 봤다 — 값이 없는 것이
 *   아니라 아직 안 읽은 것인데, 화면은 그 둘을 구분해 말하지 못했다.
 *
 * ★ 여기서 검사하는 것은 「읽었는가」가 아니라 **「못 읽은 것을 말하는가」**다.
 *   조용히 0건을 성공으로 돌려주면 화면은 「읽었는데 값이 없다」로 그리고,
 *   사용자는 자기 자료를 탓한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const api = require('../ui/report-api.cjs');
const linked = require('../core/linked');
const storage = require('../connectors/storage');

function bareProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-scan-'));
  const id = 'LP-DC-2026-001';
  fs.mkdirSync(path.join(root, id, '01_Project'), { recursive: true });
  fs.mkdirSync(path.join(root, id, '02_Source_Data'), { recursive: true });
  return { root, id, dir: path.join(root, id) };
}

function h(root, extra) {
  return api.createHandlers(Object.assign({
    agentRoot: root, agentModulePath: path.join(__dirname, '..'),
    authenticate: () => ({ name: '테스트', planId: 'pro', status: 'active' }),
  }, extra || {}));
}

/** 보관 자료 하나를 02_Source_Data 에 놓는다 */
function keep(p, name, body) {
  fs.writeFileSync(path.join(p.dir, '02_Source_Data', name), body || 'x');
}

/* ═════════ ① 읽는 경로가 없으면 성공을 돌려주지 않는다 ═════════ */

test('★★ 스캔: 읽는 경로가 안 붙어 있으면 501 — 0건을 성공으로 주지 않는다', async () => {
  // 0건 성공을 주면 화면은 「읽었는데 값이 없다」로 그린다. 자료는 멀쩡한데
  // 사용자는 자기 자료를 탓하고, 진짜 원인(안 붙은 배선)은 아무도 못 본다
  const p = bareProject();
  keep(p, '계획서.txt', '총사업비 2,846억원');
  const r = await h(p.root).scanSources({}, p.id, {});
  assert.equal(r.status, 501);
  assert.match(r.body.error, /읽는 경로가 붙어 있지 않습니다/);
  // ★ 「자료는 그대로 있다」를 말해야 한다 — 안 말하면 다시 올려야 하는 줄 안다
  assert.match(r.body.error, /자료는 그대로/);
});

/* ═════════ ② 읽을 것이 없으면 없다고 말한다 ═════════ */

test('★ 스캔: 자료가 하나도 없으면 empty 로 말한다 (읽었다고 하지 않는다)', async () => {
  const p = bareProject();
  let called = false;
  const r = await h(p.root, { extractFiles: async () => { called = true; return { facts: [], documents: [] }; } })
    .scanSources({}, p.id, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.empty, true);
  assert.equal(r.body.facts, 0);
  assert.match(r.body.note, /읽을 자료가 없습니다/);
  // 부를 것이 없는데 추출기를 부르면 LLM 비용만 나간다
  assert.equal(called, false, '읽을 파일이 없는데 추출기를 불렀다');
});

/* ═════════ ③ 「OCR 했다」로 뭉뚱그리지 않는다 ═════════ */

test('★★ 스캔: 파일마다 **어떻게 읽었는지** 돌려준다 (이미지만 OCR 이다)', async () => {
  // 글자가 든 PDF·텍스트를 굳이 옮겨 적으면 신뢰도만 깎인다 (core/ocr.js).
  // 그래서 「전부 OCR 한다」고 말하면 그것부터가 사실이 아니다
  const p = bareProject();
  keep(p, '계획서.txt', '총사업비 2,846억원');
  keep(p, '등기부.png', 'PNG');
  keep(p, '스캔.tif', 'TIF');       // 바꿔서 올려야 하는 형식
  keep(p, '도면.dwg', 'DWG');       // 표에 아예 없는 형식

  const r = await h(p.root, {
    extractFiles: async () => ({ facts: [{ key: 'a' }, { key: 'b' }], documents: [{ name: '계획서.txt' }], unsupported: [] }),
  }).scanSources({}, p.id, {});

  assert.equal(r.status, 200);
  const by = {};
  r.body.scanned.forEach((f) => { by[f.name] = f; });
  assert.equal(by['등기부.png'].ocr, true, '이미지를 OCR 로 안 본다');
  assert.equal(by['계획서.txt'].ocr, false, '글자 파일을 OCR 로 옮긴다고 말한다');
  assert.equal(by['스캔.tif'].readable, false, '못 읽는 형식을 읽을 수 있다고 말한다');
  assert.match(by['스캔.tif'].note, /읽지 못합니다/, '왜 못 읽는지 안 말한다');
  // ★ 무엇으로 바꿔 올려야 하는지까지 말한다 — 「안 됩니다」만으로는 다음 수가 없다
  assert.match(by['스캔.tif'].note, /PNG|PDF/, '어떻게 하면 되는지 안 말한다');
  // ★ 표에 아예 없는 형식도 **조용히 넘기지 않는다**
  assert.equal(by['도면.dwg'].readable, false, '모르는 형식을 읽을 수 있다고 말한다');
  assert.match(by['도면.dwg'].note, /처음 보는 형식/, '모르는 형식이라는 말이 없다');
  assert.equal(r.body.facts, 2);
  assert.equal(r.body.empty, false);
});

test('★★ 스캔: 값이 하나도 안 나오면 empty 로 말한다 — 화면이 넘어가면 안 된다', async () => {
  // 값 0 인데 넘어가면 사용자는 2단계에서 빈 칸을 보고 자기가 뭘 잘못한 줄 안다
  const p = bareProject();
  keep(p, '스캔본.png', 'PNG');
  const r = await h(p.root, { extractFiles: async () => ({ facts: [], documents: [], unsupported: [] }) })
    .scanSources({}, p.id, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.empty, true, '값이 0인데 empty 가 아니다');
  assert.equal(r.body.scanned.length, 1, '무엇을 읽으려 했는지는 남아야 한다');
});

/* ═════════ ③-2 한 파일에 답은 **하나** ═════════ */

/**
 * ★★ **실제로 돌려 보고 잡았다** 〈2026-08-21〉. 시험은 다 초록이었는데,
 *   엔진을 띄워 자료를 넣어 보니 같은 파일이 **모순된 두 줄**로 나왔다:
 *
 *     · 등기부.png — OCR — 글자로 옮겨 읽음
 *     · 등기부.png — 못 읽음: GEMINI_API_KEY 가 필요합니다
 *
 *   `scanned` 는 「어떻게 읽을 **작정**인가」를, `unread` 는 「실제로 어떻게
 *   됐나」를 담고 있었고 화면은 **둘 다** 그렸다. 읽을 작정이었던 것과 읽힌
 *   것은 다르다 — 키가 없으면 OCR 은 안 돈다.
 *
 * ★ 사용자는 어느 줄이 사실인지 알 방법이 없다. 그래서 **결과가 작정을 이긴다.**
 */
test('★★ 스캔: OCR 하려다 못 했으면 「읽었다」가 남지 않는다 (한 파일 한 줄)', async () => {
  const p = bareProject();
  keep(p, '등기부.png', 'PNG');
  keep(p, '계획서.txt', '총사업비 2,846억원');

  const r = await h(p.root, {
    extractFiles: async () => ({
      facts: [{ key: 'a' }],
      documents: [{ name: '계획서.txt' }],
      // 실제 추출기가 키 없을 때 내는 모양 그대로
      unsupported: [{ name: '등기부.png', reason: '이미지 파일 — 스캔본을 읽으려면 키가 필요합니다' }],
    }),
  }).scanSources({}, p.id, {});

  assert.equal(r.status, 200);
  const by = {};
  r.body.scanned.forEach((f) => { by[f.name] = f; });

  // ① 못 읽은 파일에 「OCR 로 읽었다」가 남아 있으면 안 된다
  assert.equal(by['등기부.png'].read, false, '못 읽었는데 읽었다고 한다');
  assert.equal(by['등기부.png'].ocr, false, 'OCR 이 안 돌았는데 돌았다고 한다');
  assert.match(by['등기부.png'].why, /키가 필요합니다/, '왜 못 읽었는지 **실제 사유**가 없다');

  // ② 같은 파일이 unread 에 **또** 나오면 화면에 두 줄이 된다
  assert.ok(!(r.body.unread || []).some(u => u.name === '등기부.png'),
    '온 파일의 실패가 unread 에도 들어가 있다 — 화면에 두 줄로 뜬다');

  // ③ 읽힌 파일은 읽혔다고 한다
  assert.equal(by['계획서.txt'].read, true);

  // ④ 「OCR 몇 건」은 **실제로 돈 것**만 센다. 앱이 이 숫자를 그대로 쓴다
  assert.equal(r.body.ocr, 0, 'OCR 이 안 돌았는데 돌았다고 센다');
});

test('★ 스캔: OCR 이 실제로 돌면 그렇게 센다', async () => {
  const p = bareProject();
  keep(p, '등기부.png', 'PNG');
  const r = await h(p.root, {
    extractFiles: async () => ({ facts: [{ key: 'a' }], documents: [{ name: '등기부.png' }], unsupported: [] }),
  }).scanSources({}, p.id, {});
  assert.equal(r.body.ocr, 1, '읽힌 이미지를 OCR 로 안 센다');
  assert.equal(r.body.scanned[0].read, true);
  assert.equal(r.body.scanned[0].ocr, true);
});

/* ═════════ ④ 실패는 격리한다 — 한 소스가 죽어도 나머지는 읽는다 ═════════ */

test('★★ 스캔: 연결 자료를 못 가져와도 보관 자료는 읽고, 못 읽은 것을 이름으로 말한다', async () => {
  const p = bareProject();
  keep(p, '계획서.txt', '총사업비 2,846억원');
  // 앱이 넘긴 첨부(내부 출처)를 장부에 적는다 — 실제 경로와 같은 모양이다
  const put = linked.link(p.dir,
    { provider: storage.INTERNAL_IDS[0], fileId: 'f-1', name: '감정평가서.pdf', rev: 'r1' });
  assert.ok(put.ok, `장부에 못 적었다: ${put.reason}`);

  let sawNames = null;
  const r = await h(p.root, {
    // 원본이 사라졌다 — 흔한 답이다. 이때 **전체가 멈추면 안 된다**
    fetchLinked: async () => ({ ok: false, reason: '원본을 찾을 수 없습니다' }),
    extractFiles: async (id, files) => {
      sawNames = files.map(f => f.name);
      return { facts: [{ key: 'a' }], documents: [{ name: '계획서.txt' }], unsupported: [] };
    },
  }).scanSources({}, p.id, {});

  assert.equal(r.status, 200);
  assert.deepEqual(sawNames, ['계획서.txt'], '보관 자료까지 못 읽었다 — 실패가 격리되지 않았다');
  assert.equal(r.body.facts, 1);
  // ★★ 못 읽은 것을 **이름으로** 말한다. 개수만 주면 무엇이 빠졌는지 못 찾는다
  assert.ok(r.body.unread.some(u => u.name === '감정평가서.pdf'),
    `못 읽은 것을 이름으로 안 말한다: ${JSON.stringify(r.body.unread)}`);
  assert.match(r.body.unread[0].why, /찾을 수 없습니다/, '왜 못 읽었는지 안 말한다');
});

test('★★ 스캔: 추출기가 던져도 연결 사본은 지운다 (「보관하지 않는다」는 실패해도 지킨다)', async () => {
  const p = bareProject();
  const put = linked.link(p.dir,
    { provider: storage.INTERNAL_IDS[0], fileId: 'f-2', name: '사업계획.txt', rev: 'r1' });
  assert.ok(put.ok, `장부에 못 적었다: ${put.reason}`);

  let tmpDir = null;
  const r = await h(p.root, {
    fetchLinked: async () => ({ ok: true, buf: Buffer.from('총사업비 100억원') }),
    extractFiles: async (id, files) => {
      tmpDir = path.dirname(files[0].path);
      throw new Error('OCR 키가 없습니다');
    },
  }).scanSources({}, p.id, {});

  assert.equal(r.status, 500);
  assert.match(r.body.error, /OCR 키가 없습니다/);
  assert.ok(tmpDir, '추출기가 아예 안 불렸다 — 연결 자료를 안 가져왔다');
  // 임시 사본이 남으면 「사본을 만들지 않습니다」가 거짓이 된다
  assert.equal(fs.existsSync(tmpDir), false, `연결 사본이 남았다: ${tmpDir}`);
});

/* ═════════ ⑤ 1회성은 여기 오지 않는다 — 그 사실을 숨기지 않는다 ═════════ */

test('★ 스캔: 1회성은 다시 읽지 않는다는 것을 응답이 말한다', async () => {
  const p = bareProject();
  keep(p, '계획서.txt', '총사업비 2,846억원');
  const r = await h(p.root, { extractFiles: async () => ({ facts: [{ key: 'a' }], documents: [{}], unsupported: [] }) })
    .scanSources({}, p.id, {});
  assert.match(r.body.oneshotNote, /다시 읽지 않습니다/,
    '1회성이 다시 안 읽힌다는 것을 안 말한다 — 「왜 내 자료만 없나」가 된다');
});

/* ═════════ ⑥ 옛 배선 이름도 받는다 ═════════ */

test('★ 스캔: 1회성용으로 붙여 둔 읽기(extractOneshot)도 쓴다 — 같은 함수다', async () => {
  // 본체는 둘 다 `pipeline.extractInto` 를 가리킨다. 이름이 둘인 것은 1회성이
  // 먼저 생겼기 때문이지 하는 일이 달라서가 아니다
  const p = bareProject();
  keep(p, '계획서.txt', 'x');
  const r = await h(p.root, { extractOneshot: async () => ({ facts: [{ key: 'a' }], documents: [{}], unsupported: [] }) })
    .scanSources({}, p.id, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.facts, 1);
});

/* ═════════ ⑦ 없는 프로젝트 · 잘못된 ID ═════════ */

test('★ 스캔: 없는 프로젝트는 404, 형식이 틀린 ID 는 400', async () => {
  const p = bareProject();
  const H = h(p.root, { extractFiles: async () => ({ facts: [], documents: [] }) });
  assert.equal((await H.scanSources({}, 'LP-DC-2026-999', {})).status, 404);
  assert.equal((await H.scanSources({}, '../etc', {})).status, 400);
});

/* ═════════ ⑧ 라우트가 실제로 걸려 있는가 (M-08 — 부르지 않는 것을 만들지 않는다) ═════════ */

test('★★ 스캔: 라우트 표에 실제로 실려 있다', () => {
  const r = api.ROUTES.filter(x => x.path === '/projects/:id/scan');
  assert.equal(r.length, 1, '스캔 길이 라우트 표에 없다 — 화면이 부를 수 없다');
  assert.equal(r[0].method, 'POST');
  assert.equal(r[0].handler, 'scanSources');
});

/* ═════════ ⑨ 한 번에 너무 많이 읽지 않는다 — 대신 **말한다** ═════════ */

/**
 * ★★ 운영 NAS 는 RAM 1.8GB 다 〈2026-08-21 · 본체 인수인계 교차검증〉.
 *   한 프로젝트에 자료가 수십 개면 한 번에 읽다가 서버가 죽을 수 있고,
 *   그때는 **스캔만 실패하는 것이 아니라 엔진이 멈춘다.**
 *
 * ★★ 그렇다고 **조용히 자르면 더 나쁘다.** 화면에는 「읽었다」만 남고 빠진
 *   자료가 무엇인지 아무도 모른다 — 값이 반만 든 보고서가 그대로 나간다.
 *   그래서 자른 것을 **이름으로** 돌려주고 몇 개 남았는지 함께 말한다.
 */
test('★★ 스캔: 양이 넘치면 잘라 읽되, 남은 것을 이름과 개수로 말한다', async () => {
  const p = bareProject();
  for (let i = 0; i < 45; i += 1) keep(p, `자료-${String(i).padStart(2, '0')}.txt`, '총사업비 100억원');

  let sawCount = 0;
  const r = await h(p.root, {
    extractFiles: async (id, files) => {
      sawCount = files.length;
      return { facts: [{ key: 'a' }], documents: files.map(f => ({ name: f.name })), unsupported: [] };
    },
  }).scanSources({}, p.id, {});

  assert.equal(r.status, 200);
  // ① 한 번에 다 읽지 않는다
  assert.ok(sawCount < 45, `45개를 한 번에 다 읽었다 (${sawCount}개) — 상한이 안 걸렸다`);
  assert.ok(sawCount > 0, '아무것도 안 읽었다');
  // ② 남은 것을 **개수로** 말한다
  assert.equal(r.body.remaining, 45 - sawCount,
    `남은 개수가 안 맞는다 (읽은 ${sawCount} · 남았다고 한 ${r.body.remaining})`);
  // ③ 남은 것을 **이름으로도** 말한다. 개수만 주면 무엇이 빠졌는지 못 찾는다
  const left = (r.body.unread || []).filter(u => u.from === 'limit');
  assert.equal(left.length, r.body.remaining, '남은 것을 이름으로 안 말한다');
  assert.match(left[0].why, /다시 누르면 이어서/,
    '어떻게 하면 나머지를 읽는지 안 말한다 — 「안 됩니다」만으로는 다음 수가 없다');
});

test('★ 스캔: 자료가 적으면 자르지 않는다 (남은 것 0)', async () => {
  const p = bareProject();
  keep(p, '계획서.txt', '총사업비 2,846억원');
  const r = await h(p.root, {
    extractFiles: async () => ({ facts: [{ key: 'a' }], documents: [{}], unsupported: [] }),
  }).scanSources({}, p.id, {});
  assert.equal(r.body.remaining, 0, '자를 것이 없는데 잘랐다고 한다');
  assert.equal((r.body.unread || []).filter(u => u.from === 'limit').length, 0);
});
