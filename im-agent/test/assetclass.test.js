'use strict';
/**
 * assetclass.test.js — 자산군마다 무엇을 받아야 하는가.
 *
 * 이 규칙의 실패는 **조용하다.** 호텔 딜에서 객실 수를 안 물어도 화면은
 * 「필수 다 채웠다」라고 말하고, 생성이 열리고, 매출 가정에 근거가 없는 채로
 * IM 이 나간다. 문서만 봐서는 무엇이 빠졌는지 알 수 없다 — 빠진 것은
 * 화면에도 문서에도 흔적을 안 남기기 때문이다. 그래서 테스트로 고정한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const A = require('../core/assetclass');
const dict = require('../core/dictionary');
const tpl = require('../finance/templates');
const FC = require('../ui/platform/fields-core.js');
const L = require('../ui/platform/live-core.js');
const { createHandlers } = require('../ui/api-router.cjs');

const AGENT = path.join(__dirname, '..');
const PLATFORM = path.join(AGENT, 'ui', 'platform');

/* ───────────── 정의 자체 ───────────── */

test('★ 사용자가 말한 자산군 12종이 전부 있다', () => {
  const want = ['제조', '인프라스트럭처', '물류창고', '호텔', '데이터센터', '오피스텔',
    '주상복합', '아파트', '오피스빌딩', '공장', '산업단지', '리조트'];
  const got = A.CLASSES.map(c => c.label);
  assert.deepStrictEqual(got, want, '자산군 목록이 요구와 다르다');

  const ids = A.CLASSES.map(c => c.id);
  assert.strictEqual(ids.length, new Set(ids).size, 'id 가 겹친다');
  A.CLASSES.forEach((c) => {
    assert.ok(c.en && c.en.trim(), `${c.label}: 영문 이름이 없다`);
    assert.ok(c.requires.length > 0, `${c.label}: 더 받는 값이 하나도 없다 — 그러면 나눌 뜻이 없다`);
  });
});

/**
 * ★ 사전에 없는 키를 적으면 **입력란은 안 생기는데 필수로는 세어진다.**
 *   진행률이 영원히 100% 가 되지 않고, 사용자는 어디를 채워야 하는지 못 찾는다.
 */
test('★ 자산군이 요구하는 키가 사전에 전부 있다', () => {
  A.CLASSES.forEach((c) => {
    c.requires.forEach((r) => {
      assert.ok(dict.FIELDS[r.key], `${c.label}: 사전에 없는 키 ${r.key}`);
      assert.ok(dict.COMPUTED_KEYS.indexOf(r.key) === -1,
        `${c.label}: ${r.key} 는 계산 항목이다 — 사람에게 물어볼 수 없는 것을 필수로 두면 안 된다`);
    });
    const keys = c.requires.map(r => r.key);
    assert.strictEqual(keys.length, new Set(keys).size, `${c.label}: 같은 키를 두 번 적었다`);
  });
});

/** ★ 이유 없이 늘어난 입력란은 대충 채워지고, 대충 채운 값이 IM 에 실린다 */
test('★ 왜 묻는지가 항목마다 적혀 있다', () => {
  A.CLASSES.forEach((c) => {
    c.requires.forEach((r) => {
      assert.ok(r.why && r.why.length >= 10, `${c.label} · ${r.key}: 이유가 없다`);
    });
  });
});

test('★ 자산군이 가리키는 재무 템플릿이 실제로 있다', () => {
  A.CLASSES.forEach((c) => {
    assert.ok(tpl.TEMPLATES[c.template],
      `${c.label}: 없는 재무 템플릿 ${c.template} — 모델이 generic 으로 조용히 떨어진다`);
    assert.strictEqual(A.templateOf(c.id), c.template);
  });
  // 모르는 자산군은 generic 이다 (던지지 않는다 — 생성 전체가 죽으면 안 된다)
  assert.strictEqual(A.templateOf('없는것'), 'generic');
});

/**
 * ★ 자산군 전용 지표에 `requiredFor` 를 붙이면 **모든 딜에서** 묻게 된다.
 *   태양광 딜에서 객실 수를 묻는 화면이 된다.
 */
test('★ 자산군 전용 지표를 사전에서 전역 필수로 만들지 않는다', () => {
  const own = new Set();
  A.CLASSES.forEach(c => c.requires.forEach(r => own.add(r.key)));
  // 공통으로도 쓰이는 키(대지면적·연면적 등)는 원래 필수라 예외다
  const classOnly = ['capacity.rooms', 'capacity.units', 'capacity.dock_doors',
    'capacity.saleable_land_sqm', 'capacity.production', 'building.clear_height_m',
    'building.floor_load_kn', 'revenue.adr', 'revenue.occupancy', 'schedule.concession_years'];
  classOnly.forEach((k) => {
    assert.ok(own.has(k), `${k}: 어느 자산군도 안 쓴다 — 쓰지 않을 항목을 사전에 넣지 않는다`);
    assert.deepStrictEqual((dict.FIELDS[k].requiredFor || []), [],
      `${k}: 전역 필수로 붙어 있다 — 태양광 딜에서도 이걸 묻게 된다`);
  });
});

/* ───────────── 필수 항목 셈 ───────────── */

test('★ 자산군 필수는 더해지기만 한다 — 문서 종류 필수를 빼앗지 않는다', () => {
  const base = FC.requiredKeys(dict.FIELDS, 'im');
  A.CLASSES.forEach((c) => {
    const withClass = FC.requiredKeys(dict.FIELDS, 'im', A.requiredKeys(c.id));
    base.forEach((k) => {
      assert.ok(withClass.indexOf(k) !== -1,
        `${c.label}: 공통 필수 ${k} 가 사라졌다 — 규칙이 자산군마다 갈린다`);
    });
    assert.ok(withClass.length >= base.length, `${c.label}: 필수가 줄었다`);
  });
});

test('★ 자산군마다 필수 개수가 실제로 다르다', () => {
  const n = {};
  A.CLASSES.forEach((c) => {
    n[c.id] = FC.completeness(dict.FIELDS, {}, 'im', A.requiredKeys(c.id)).total;
  });
  const base = FC.completeness(dict.FIELDS, {}, 'im').total;
  A.CLASSES.forEach((c) => {
    assert.ok(n[c.id] > base,
      `${c.label}: 공통과 개수가 같다 — 자산군을 골라도 달라지는 게 없다`);
  });
  // 호텔과 물류창고가 같은 수를 요구하면 나눈 뜻이 옅어진다
  assert.notStrictEqual(n.hotel, n.logistics);
});

/** ★ 사전에 없는 키를 넘겨도 필수에 끼워 넣지 않는다 (진행률이 영원히 안 찬다) */
test('★ 사전에 없는 키는 필수로 세지 않는다', () => {
  const got = FC.requiredKeys(dict.FIELDS, 'im', ['없는.키', 'capacity.rooms']);
  assert.ok(got.indexOf('없는.키') === -1);
  assert.ok(got.indexOf('capacity.rooms') !== -1);
});

test('★ 자산군 전용 항목을 채워야 100% 가 된다', () => {
  const keys = A.requiredKeys('hotel');
  const values = {};
  FC.requiredKeys(dict.FIELDS, 'im').forEach((k) => {
    values[k] = { value: 1, source: '사업계획서 p.1' };
  });
  const before = FC.completeness(dict.FIELDS, values, 'im', keys);
  assert.ok(before.percent < 100, '공통만 채웠는데 100% 가 됐다 — 객실 수 없이 매출을 못 검증한다');
  assert.deepStrictEqual(before.missing.slice().sort(), keys.slice().sort());

  keys.forEach((k) => { values[k] = { value: 1, source: '감정평가서 p.7' }; });
  assert.strictEqual(FC.completeness(dict.FIELDS, values, 'im', keys).percent, 100);
});

/* ───────────── 자동 판정 ───────────── */

/**
 * ★ **못 짚으면 고르지 않는다.** generic 으로 흘려보내면 그 자산군의 전용
 *   필수가 통째로 안 물어봐지고, 화면은 「다 채웠다」고 말한다 (CLAUDE.md §4.9).
 */
test('★ 자산군이 여럿 읽히면 자동으로 하나를 고르지 않는다', () => {
  const mixed = A.detect('주상복합 아파트 신축사업');
  assert.strictEqual(mixed.id, null, '겹치는 말인데 하나를 골랐다');
  assert.ok(mixed.candidates.length > 1);
  assert.ok(mixed.reason, '왜 못 골랐는지 적어야 한다');

  const none = A.detect('신규 사업 검토');
  assert.strictEqual(none.id, null);
  assert.deepStrictEqual(none.candidates, []);
  assert.ok(none.reason);
});

test('★ 한 자산군만 읽히면 그것을 쓴다', () => {
  assert.strictEqual(A.detect('인천 데이터센터 개발 IM').id, 'datacenter');
  assert.strictEqual(A.detect('용인 물류센터 신축').id, 'logistics');
  assert.strictEqual(A.detect('제주 리조트 매각').id, 'resort');
  assert.strictEqual(A.detect('Hotel development in Seoul').id, 'hotel');
});

/* ───────────── 01 Project 가 남기는 것 ───────────── */

test('★ 자산군을 못 정하면 경고를 남긴다 (조용히 넘어가지 않는다)', async () => {
  const { runAgent } = require('../core/runtime');
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ac-'));
  const before = process.env.IM_AGENT_ROOT;
  process.env.IM_AGENT_ROOT = root;
  try {
    const ok = await runAgent('01_project', { request: '부산 호텔 개발 IM' }, { log: () => {} });
    assert.strictEqual(ok.output.assetClass, 'hotel');
    assert.strictEqual(ok.output.templateId, 'realestate');

    const vague = await runAgent('01_project', { request: '신규 사업 검토' }, { log: () => {} });
    assert.strictEqual(vague.output.assetClass, null);
    assert.ok((vague.warnings || []).some(w => /자산군/.test(w)),
      '못 정했는데 아무 말도 안 하면, 전용 필수가 빠진 줄 아무도 모른다');
  } finally {
    if (before === undefined) delete process.env.IM_AGENT_ROOT;
    else process.env.IM_AGENT_ROOT = before;
  }
});

/* ───────────── API · 화면 ───────────── */

test('★ /fields 가 자산군 정의를 함께 준다 (화면이 복사해 두지 않는다)', async () => {
  const h = createHandlers({ agentModulePath: AGENT });
  const b = (await h.fields()).body;
  assert.strictEqual(b.assetClasses.length, A.CLASSES.length);
  b.assetClasses.forEach((c) => {
    const def = A.CLASSES.find(x => x.id === c.id);
    assert.ok(def, `${c.id}: 정의에 없는 자산군`);
    assert.deepStrictEqual(c.requires.map(r => r.key), A.requiredKeys(c.id));
    c.requires.forEach((r) => {
      assert.strictEqual(r.label, dict.FIELDS[r.key].label,
        '표시 이름을 API 가 붙여 준다 — 화면이 raw key 를 보여주면 안 된다');
      assert.ok(r.why, '왜 묻는지가 빠졌다');
    });
    assert.ok(c.own.length > 0);
  });
});

test('★ 접수 화면이 고르는 것은 자산군 12종이다', async () => {
  const h = createHandlers({ agentModulePath: AGENT });
  const b = (await h.intake()).body;
  assert.deepStrictEqual(b.assetTypes.map(a => a.id), A.CLASSES.map(c => c.id));
  // 재무 템플릿은 따로 내린다 — 사람이 둘을 따로 고르면 어긋난다
  assert.deepStrictEqual(b.financeTemplates.map(t => t.id).sort(), Object.keys(tpl.TEMPLATES).sort());
});

test('★ 다른 자산군의 전용 지표는 감춘다 — 공통 필수는 남긴다', () => {
  const commonKeys = Object.values(tpl.COMMON_MAP);
  const hotel = A.classKeys('hotel', dict.FIELDS, commonKeys);
  const logi = A.classKeys('logistics', dict.FIELDS, commonKeys);

  assert.ok(hotel.foreign.includes('building.clear_height_m'), '호텔에 유효층고를 띄우고 있다');
  assert.ok(!logi.foreign.includes('building.clear_height_m'));
  assert.ok(logi.foreign.includes('capacity.rooms'), '물류창고에 객실 수를 띄우고 있다');

  // 공통 필수는 어느 자산군에서도 감추지 않는다 — 감추면 진행률이 안 오르는
  // 이유를 화면에서 찾을 수 없다
  [hotel, logi].forEach((k) => {
    FC.requiredKeys(dict.FIELDS, 'im').forEach((req) => {
      assert.ok(!k.foreign.includes(req), `공통 필수 ${req} 가 감춰졌다`);
    });
  });
});

test('★ 진행률이 자산군 전용 필수를 함께 센다', () => {
  const opt = {
    project: 'P1', fields: dict.FIELDS, values: {}, docType: 'im',
    complete: FC.completeness, spec: null, snapshot: null,
  };
  const plain = L.stepProgress(opt).find(s => s.id === 'fields');
  const hotel = L.stepProgress(Object.assign({}, opt, {
    classKeys: A.requiredKeys('hotel'), classLabel: '호텔',
  })).find(s => s.id === 'fields');

  assert.ok(hotel.units.total > plain.units.total,
    '자산군을 골라도 분모가 그대로면 전용 항목이 안 세어지는 것이다');
  assert.match(hotel.detail, /호텔 전용 3개 포함/,
    '몇 개가 자산군 때문에 늘었는지 화면에 적어야 한다 — 안 적으면 갑자기 늘어난 것으로 보인다');
  assert.ok(!/전용/.test(plain.detail), '자산군을 모를 때는 전용 문구를 붙이지 않는다');
});

/** ★ 목록을 화면에 적어 두면 자산군을 늘리는 날 화면만 옛말을 한다 */
test('★ 화면이 자산군 목록을 베껴 쓰지 않는다', () => {
  const raw = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');
  const html = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  A.CLASSES.forEach((c) => {
    assert.ok(html.indexOf("'" + c.label + "'") === -1,
      `화면이 「${c.label}」 을 직접 적고 있다`);
  });
  assert.match(html, /det\.assetClasses/, '서버가 준 정의를 써야 한다');
});
