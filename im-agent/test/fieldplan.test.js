'use strict';
/**
 * fieldplan.test.js — '사람이 직접 넣어야 하는 항목' 판정.
 *
 * 이 판정이 틀리면 두 방향 모두 위험하다:
 *   ① 자동으로 채워지는 것을 manual 로 잡으면 → 입력란이 다시 불어난다
 *   ② 자동으로 못 채우는 것을 auto 로 잡으면 → 화면이 안 물어보고, 값이 빈 채로
 *      "자동으로 채워집니다" 라고 거짓말한다. 이쪽이 훨씬 나쁘다
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dict = require('../core/dictionary');
const templates = require('../finance/templates');
const fieldplan = require('../core/fieldplan');
const F = require('../ui/platform/fields-core.js');

const TEMPLATE_IDS = Object.keys(templates.TEMPLATES);

/**
 * 공공데이터 인증키가 **있는** 환경을 흉내 낸다.
 * 키가 없으면 07 Geo 가 통째로 건너뛰어지므로 public 경로가 죽는다 —
 * 그 두 상태를 같은 테스트에서 섞으면 어느 쪽을 검사한 건지 알 수 없다.
 */
function withPublicKeys(fn) {
  const before = { v: process.env.VWORLD_KEY, d: process.env.DATA_GO_KR_KEY };
  process.env.VWORLD_KEY = 'test-key';
  process.env.DATA_GO_KR_KEY = 'test-key';
  try { return fn(); } finally {
    if (before.v === undefined) delete process.env.VWORLD_KEY; else process.env.VWORLD_KEY = before.v;
    if (before.d === undefined) delete process.env.DATA_GO_KR_KEY; else process.env.DATA_GO_KR_KEY = before.d;
  }
}

test('사전의 모든 항목이 채움 경로를 하나씩 갖는다', () => {
  const p = fieldplan.plan('generic');
  const keys = Object.keys(dict.FIELDS);
  assert.strictEqual(Object.keys(p).length, keys.length);
  keys.forEach((k) => {
    assert.ok(p[k], `${k}: 채움 경로가 없다`);
    assert.ok(fieldplan.LABEL[p[k].fill], `${k}: 모르는 경로 ${p[k].fill}`);
    assert.strictEqual(p[k].label, fieldplan.LABEL[p[k].fill]);
    assert.ok(p[k].why && p[k].why.length > 5, `${k}: 근거 문구가 없다`);
  });
});

test('경로별 합계가 사전 전체와 같다 — 세다가 빠지는 항목이 없다', () => {
  const s = fieldplan.summary('generic');
  const sum = Object.keys(s).reduce((a, k) => a + s[k], 0);
  assert.strictEqual(sum, Object.keys(dict.FIELDS).length);
});

test('요청문·공공데이터 목록을 여기서 새로 적지 않는다 — Agent 의 FILLS 가 출처다', () => {
  const req = require('../agents/01-project').FILLS;
  const pub = require('../agents/07-geo').FILLS;
  assert.ok(req.length > 0 && pub.length > 0, 'Agent 가 FILLS 를 선언하지 않았다');

  const p = fieldplan.plan('generic');
  req.forEach((k) => {
    if (!dict.FIELDS[k]) return;              // 사전에 없는 key 는 화면 대상이 아니다
    assert.strictEqual(p[k].fill, 'request', `${k}: 01-project 가 채우는데 request 가 아니다`);
  });

  // 공공데이터 경로는 **키가 있을 때만** 산다 (아래 전용 테스트 참조)
  withPublicKeys(() => {
    const pk = fieldplan.plan('generic');
    pub.forEach((k) => {
      if (!dict.FIELDS[k]) return;
      if (req.indexOf(k) !== -1) return;      // 요청문이 먼저 채우면 그쪽이 이긴다
      assert.strictEqual(pk[k].fill, 'public', `${k}: 07-geo 가 채우는데 public 이 아니다`);
    });
  });

  // 손으로 적은 목록이 아닌지 — 파일에 dictionary key 를 나열해 두지 않았는가
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'fieldplan.js'), 'utf8');
  ['project.name', 'geo.pnu', 'land.zoning'].forEach((k) => {
    assert.ok(src.indexOf(k) === -1, `fieldplan.js 가 ${k} 를 직접 적어 두고 있다`);
  });
});

/**
 * ★ FILLS 는 선언일 뿐이다. 선언과 실제 코드가 갈리면 화면이 조용히 거짓말한다 —
 *   07 Geo 의 FILLS 에 개별공시지가가 적혀 있었지만 07 은 그 값을 한 번도
 *   push 하지 않았다 (실제로는 08 Appraisal 이 채운다). 그런 항목은 화면이
 *   "공공데이터가 채웁니다"라고 말해 놓고 아무도 안 채운다.
 */
test('FILLS 에 적힌 key 를 그 Agent 가 실제로 push 한다', () => {
  const AGENTS = ['01-project', '07-geo', '08-appraisal'];
  AGENTS.forEach((name) => {
    const mod = require(`../agents/${name}`);
    const src = fs.readFileSync(path.join(__dirname, '..', 'agents', `${name}.js`), 'utf8');
    (mod.FILLS || []).forEach((key) => {
      // facts.push({ key: 'x' ... }) 또는 push('x', ...) 두 형태를 모두 본다
      const written = src.includes(`key: '${key}'`) || src.includes(`push('${key}'`)
        || src.includes(`'${key}':`);
      assert.ok(written,
        `${name}: FILLS 에 ${key} 가 있는데 이 파일이 그 값을 만들지 않는다 — ` +
        '화면은 자동으로 채워진다고 믿고 안 물어본다');
    });
  });
});

/**
 * ★ 반대 방향 검사. 위 테스트는 "선언한 것을 실제로 채우는가"를 본다.
 *   여기서는 **"채우면서 선언하지 않은 것이 없는가"** 를 본다.
 *
 *   07 Geo 는 건축물대장에서 연면적·층수 등을 push 하지만 FILLS 에 넣지 않았다.
 *   대장은 **건물이 이미 있을 때만** 있고, 개발사업은 대개 나대지에서 시작한다.
 *   FILLS 에 넣으면 화면이 연면적을 안 물어보고 값은 빈 채로 남는다 (B-18).
 *
 *   그래서 조건부 채움은 CONDITIONAL_FILLS 에 따로 적는다 — 선언 없이 두면
 *   나중에 누군가 "빠졌네" 하고 FILLS 로 옮긴다.
 */
test('채우면서 선언하지 않은 key 가 없다 (조건부는 CONDITIONAL_FILLS 에)', () => {
  const AGENTS = ['01-project', '07-geo', '08-appraisal'];
  AGENTS.forEach((name) => {
    const mod = require(`../agents/${name}`);
    const src = fs.readFileSync(path.join(__dirname, '..', 'agents', `${name}.js`), 'utf8');

    const pushed = new Set();
    [...src.matchAll(/key: '([a-z_.]+)'/g)].forEach(m => pushed.add(m[1]));
    [...src.matchAll(/push\('([a-z_.]+)'/g)].forEach(m => pushed.add(m[1]));

    const declared = new Set(mod.FILLS || []);
    const conditional = new Set(
      Object.values(mod.CONDITIONAL_FILLS || {}).flat());

    [...pushed].forEach((k) => {
      if (!dict.FIELDS[k]) return;                 // 계산 전용 key 는 입력 대상이 아니다
      assert.ok(declared.has(k) || conditional.has(k),
        `${name}: ${k} 를 채우면서 어디에도 선언하지 않았다 — ` +
        '조건 없이 채우면 FILLS, 조건이 붙으면 CONDITIONAL_FILLS 에 적는다');
    });
  });
});

/** 조건부 채움은 화면 계획에 들어가면 안 된다 — 들어가면 안 물어본다 */
test('조건부 채움은 자동으로 잡히지 않는다', () => {
  const conditional = Object.values(
    require('../agents/07-geo').CONDITIONAL_FILLS || {}).flat();
  assert.ok(conditional.length > 0, '조건부 목록이 비었다 — 검사가 의미를 잃는다');

  withPublicKeys(() => {
    const p = fieldplan.plan('generic');
    conditional.forEach((k) => {
      if (!dict.FIELDS[k]) return;
      assert.notStrictEqual(p[k].fill, 'public',
        `${k}: 건물이 있을 때만 나오는 값인데 항상 채워지는 것으로 잡혔다 — ` +
        '나대지 딜에서 화면이 안 물어보고 빈 채로 남는다');
    });
  });
});

test('공공데이터로 채워지는 항목은 그 경로를 부르는 Agent 가 전부 반영된다', () => {
  const declared = new Set([].concat(
    require('../agents/07-geo').FILLS || [],
    require('../agents/08-appraisal').FILLS || [],
  ));
  withPublicKeys(() => {
    const p = fieldplan.plan('generic');
    Object.keys(p).forEach((k) => {
      if (p[k].fill === 'public') {
        assert.ok(declared.has(k), `${k}: 어느 Agent 도 채운다고 선언하지 않았는데 공공데이터로 잡혔다`);
      }
    });
    declared.forEach((k) => {
      if (!dict.FIELDS[k]) return;
      assert.strictEqual(p[k].fill, 'public',
        `${k}: Agent 가 채운다고 선언했는데 계획이 모른다 — fieldplan 이 그 Agent 를 안 읽는다`);
    });
  });
});

test('계산 항목(DERIVED)은 사전에 있는 입력 항목이고, 근거가 되는 key 도 사전에 있다', () => {
  Object.keys(fieldplan.DERIVED).forEach((k) => {
    assert.ok(dict.FIELDS[k], `${k}: 사전에 없다`);
    assert.ok(dict.COMPUTED_KEYS.indexOf(k) === -1, `${k}: 계산 전용 항목은 여기 올 수 없다`);
    fieldplan.DERIVED[k].from.forEach((src) => {
      assert.ok(dict.FIELDS[src], `${k} 의 근거 ${src} 가 사전에 없다`);
    });
    assert.ok(fieldplan.DERIVED[k].how, `${k}: 계산 방법이 적혀 있지 않다`);
  });
});

test('DERIVED 가 재무모델의 실제 계산과 같다 — 모델이 바뀌면 여기서 걸린다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'finance', 'model.js'), 'utf8');
  // 차입금 = 총사업비 × LTC (debtAmount 가 없을 때)
  assert.ok(/debtAmount\)\s*>\s*0\s*\?[^:]*:\s*totalCost\s*\*\s*pctToRate\(inp\.ltc\)/.test(src),
    'model.js 가 더 이상 총사업비×LTC 로 차입금을 만들지 않는다');
  // 운영비 = 매출 × 운영비율 (opexRatio 우선)
  assert.ok(src.indexOf('revenue * pctToRate(inp.opexRatio)') !== -1,
    'model.js 가 더 이상 매출×운영비율로 운영비를 만들지 않는다');
  // 기타사업비 기본 0
  assert.ok(/otherCost:\s*0/.test(src), 'model.js 의 기타사업비 기본값이 0 이 아니다');
});

test('산업 통상치(default)는 템플릿 defaults 에서만 나온다', () => {
  TEMPLATE_IDS.forEach((id) => {
    const t = templates.getTemplate(id);
    const p = fieldplan.plan(id);
    const allowed = new Set();
    Object.keys(t.defaults || {}).forEach((field) => {
      const key = (t.map || {})[field];
      if (key) allowed.add(key);
    });
    Object.keys(p).forEach((k) => {
      if (p[k].fill === 'default') assert.ok(allowed.has(k), `${id}/${k}: defaults 에 없는데 통상치로 잡혔다`);
    });
  });
});

/**
 * ★ 이 검사가 깨지면 `GET /fields` 의 응답 구조를 바꿔야 한다.
 *   지금은 plan 을 산업 밖(top-level)에 한 번만 내리고 있다 — 산업을 고르기
 *   전에도 입력란을 줄이려고 그렇게 했다. 템플릿마다 달라지는 날부터는
 *   그 응답이 조용히 거짓말을 하게 된다.
 */
test('채움 계획은 템플릿마다 다르지 않다 — GET /fields 가 top-level 로 내리는 근거', () => {
  const base = JSON.stringify(fieldplan.plan(TEMPLATE_IDS[0]));
  TEMPLATE_IDS.forEach((id) => {
    assert.strictEqual(JSON.stringify(fieldplan.plan(id)), base,
      `${id}: 채움 계획이 ${TEMPLATE_IDS[0]} 와 다르다 — api-router 의 fields() 를 산업별로 바꿔야 한다`);
  });
});

test('모르는 템플릿 id 는 generic 으로 떨어진다', () => {
  assert.strictEqual(JSON.stringify(fieldplan.plan('없는산업')),
    JSON.stringify(fieldplan.plan('generic')));
});

/* ───────────── 화면 판정 (fields-core) ───────────── */

/** 키가 있을 때 직접 넣어야 하는 것 — 전부 extract 경로다 */
const MANUAL_WITH_KEYS = [
  'building.gfa_sqm',
  'investment.construction',
  'investment.land',
  'investment.total',
  'land.ownership',
  'legal.permit_status',
  'project.sponsor',
  'revenue.annual',
];

test('IM 필수 17개 중 직접 넣을 것은 8개다 (공공데이터 키가 있을 때)', () => {
  withPublicKeys(() => {
    const b = F.autoBreakdown(dict.FIELDS, fieldplan.plan('generic'), 'im');
    assert.strictEqual(b.total, 17);
    assert.deepStrictEqual(b.manual.slice().sort(), MANUAL_WITH_KEYS);
    const auto = b.groups.reduce((a, g) => a + g.keys.length, 0);
    assert.strictEqual(auto + b.manual.length, b.total, '자동 + 직접이 필수 개수와 다르다');
  });
});

/**
 * ★ 이것이 이 파일에서 가장 중요한 검사다.
 *   키가 없으면 07 Geo 는 통째로 건너뛴다. 그런데도 화면이 "공공데이터가
 *   채웁니다"라고 말하면 **안 물어보고 빈 채로 남는다** — 사람은 물어보지
 *   않았으니 그 항목이 있는 줄도 모른다. 많이 묻는 것보다 훨씬 나쁘다.
 */
test('공공데이터 키가 없으면 그 경로가 죽고 직접 입력으로 내려온다', () => {
  assert.strictEqual(fieldplan.publicDataAvailable(), false,
    '테스트 환경에 공공데이터 키가 들어 있다 — 이 검사가 의미를 잃는다');

  const p = fieldplan.plan('generic');
  Object.keys(p).forEach((k) => {
    assert.notStrictEqual(p[k].fill, 'public', `${k}: 키가 없는데 공공데이터가 채운다고 한다`);
  });

  const b = F.autoBreakdown(dict.FIELDS, p, 'im');
  assert.deepStrictEqual(b.manual.slice().sort(),
    MANUAL_WITH_KEYS.concat(['land.area_sqm']).sort(),
    '키 없이도 대지면적을 안 물어보면 빈 채로 보고서에 들어간다');

  // 키가 생기면 다시 자동으로 돌아간다 (한 방향으로만 굳지 않는다)
  withPublicKeys(() => {
    assert.strictEqual(fieldplan.plan('generic')['land.area_sqm'].fill, 'public');
  });
});

test('자동 내역은 경로별로 묶이고 근거가 함께 나온다', () => {
  withPublicKeys(() => {
    const b = F.autoBreakdown(dict.FIELDS, fieldplan.plan('generic'), 'im');
    assert.deepStrictEqual(b.groups.map(g => g.fill), ['request', 'public', 'default'],
      '경로 순서가 바뀌었다');
    b.groups.forEach((g) => {
      assert.ok(g.label && g.why, `${g.fill}: 이름·근거가 비어 있다`);
      assert.ok(g.keys.length > 0);
    });
  });
});

test('직접 입력 판은 필수 항목 중 자동으로 못 채우는 것만 보여준다', () => {
  const plan = withPublicKeys(() => fieldplan.plan('generic'));
  const o = { level: 'manual', docType: 'im', plan };
  const shown = Object.keys(dict.FIELDS).filter(k => F.inScope(k, dict.FIELDS, o));
  assert.strictEqual(shown.length, 8);
  // 요청문에서 뽑히는 사업명은 안 물어본다
  assert.ok(!F.inScope('project.name', dict.FIELDS, o));
  // 자동으로 못 채우는 총사업비는 물어본다
  assert.ok(F.inScope('investment.total', dict.FIELDS, o));
  // 필수가 아닌 항목은 직접 입력 판에 없다
  assert.ok(!F.inScope('opex.escalation', dict.FIELDS, o));
});

/**
 * ★ 자동으로 채워지는 줄에 출처를 물으면, 사람은 **자기가 모르는 것을 적어 넣는다.**
 *   출처 강제가 거짓 출처를 만드는 순간이다 — 이 저장소가 막으려던 바로 그 일.
 */
test('자동으로 채워지는 줄에는 출처를 묻지 않는다', () => {
  const plan = fieldplan.plan('generic');

  // 요청문이 채우는 사업명 — 빈 줄에는 출처 칸을 만들지 않는다
  assert.strictEqual(plan['project.name'].fill, 'request');
  assert.strictEqual(F.asksSource('project.name', {}, plan), false);

  // 산업 통상치가 채우는 차입금리도 마찬가지
  assert.strictEqual(plan['debt.rate'].fill, 'default');
  assert.strictEqual(F.asksSource('debt.rate', { value: '', source: '' }, plan), false);

  // 사람이 채워야 하는 줄은 처음부터 묻는다
  assert.strictEqual(F.asksSource('investment.total', {}, plan), true);

  // 계획을 못 받으면 전부 묻는다 — 안 묻고 넘어가는 쪽이 위험하다
  assert.strictEqual(F.asksSource('debt.rate', {}, null), true);
});

test('자동값을 덮어쓰기 시작하면 그때 출처를 묻는다', () => {
  const plan = fieldplan.plan('generic');
  // 한 글자만 쳐도 근거가 필요해진다 — 자동값을 이기는 값이기 때문이다
  assert.strictEqual(F.asksSource('debt.rate', { value: '5' }, plan), true);
  // 값을 지워도 출처를 이미 적어 뒀으면 칸이 남는다 (감추면 고칠 방법이 없다)
  assert.strictEqual(F.asksSource('debt.rate', { value: '', source: 'ECOS' }, plan), true);

  // 그리고 출처 없이 덮어쓴 값은 저장되지 않는다 — 화면·서버 규칙이 같다
  const v = F.validateAll(dict.FIELDS, { 'debt.rate': { value: 5.8, source: '' } }, dict.COMPUTED_KEYS);
  assert.strictEqual(v.canSave, false);
  assert.match(v.errors[0], /출처/);
});

test('★ 화면이 출처 노출 판정을 자기가 하지 않는다', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'fields.html'), 'utf8');
  assert.match(html, /F\.asksSource/, '판정은 fields-core 하나에 있어야 한다');
});

test('판이 올라갈수록 항목이 줄지 않는다 (직접 입력 ⊆ 일반용 ⊆ 전문가용)', () => {
  const plan = fieldplan.plan('generic');
  const at = (level) => Object.keys(dict.FIELDS)
    .filter(k => F.inScope(k, dict.FIELDS, { level, docType: 'im', plan }));
  const m = at('manual'), b = at('basic'), e = at('expert');
  m.forEach(k => assert.ok(b.indexOf(k) !== -1, `${k}: 직접 입력에 있는데 일반용에 없다`));
  b.forEach(k => assert.ok(e.indexOf(k) !== -1, `${k}: 일반용에 있는데 전문가용에 없다`));
  assert.ok(m.length < b.length && b.length < e.length,
    `판별 개수가 늘지 않는다 (${m.length}/${b.length}/${e.length})`);
});

test('계획을 못 받으면 아무것도 감추지 않는다 — 안 물어보고 비워 두는 쪽이 더 나쁘다', () => {
  const o = { level: 'manual', docType: 'im', plan: null };
  const shown = Object.keys(dict.FIELDS).filter(k => F.inScope(k, dict.FIELDS, o));
  assert.strictEqual(shown.length, F.requiredKeys(dict.FIELDS, 'im').length);
  assert.strictEqual(F.isAuto('project.name', null), false);
});

test('자동으로 채워지는 항목도 값이 들어 있으면 화면에서 보인다', () => {
  const plan = fieldplan.plan('generic');
  const values = { 'project.name': { value: '평택 데이터센터', source: '사업계획서 p.1' } };
  const o = { level: 'manual', docType: 'im', plan, filter: 'all' };
  assert.ok(!F.inScope('project.name', dict.FIELDS, o), '기본 노출 대상이면 이 검사가 의미 없다');
  assert.ok(F.isVisible('project.name', dict.FIELDS, values, dict.COMPUTED_KEYS, o),
    '값이 있는데 직접 입력 판에서 감춰졌다 — 고칠 방법이 없어진다');
});

test('자동으로 채워지는 항목이라도 값이 틀리면 보인다', () => {
  const plan = fieldplan.plan('generic');
  const values = { 'land.area_sqm': { value: '숫자아님', source: '토지대장' } };
  const o = { level: 'manual', docType: 'im', plan, filter: 'all' };
  assert.ok(F.isVisible('land.area_sqm', dict.FIELDS, values, dict.COMPUTED_KEYS, o));
});

test('GET /fields 가 채움 계획을 산업 밖에 한 번만 내린다', async () => {
  const { createHandlers } = require('../ui/api-router.cjs');
  const h = createHandlers({ agentModulePath: path.join(__dirname, '..') });
  const body = (await h.fields()).body;

  assert.ok(body.plan, 'plan 이 없다');
  assert.deepStrictEqual(body.planSummary, fieldplan.summary('generic'));
  // 화면이 '왜 물어보는 게 늘었는지' 말할 수 있어야 한다
  assert.strictEqual(body.publicData, fieldplan.publicDataAvailable());
  assert.deepStrictEqual(Object.keys(body.plan).sort(), Object.keys(dict.FIELDS).sort());
  // 산업 안에 복사본을 두지 않는다 — 두 곳이 갈리면 화면이 어느 쪽을 믿을지 모른다
  body.industries.forEach((ind) => {
    assert.ok(!ind.plan, `${ind.id}: 산업 안에 plan 복사본이 있다`);
  });
});

test('화면은 채움 경로 이름을 자기가 적지 않는다', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'fields.html'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  Object.keys(fieldplan.LABEL).forEach((fill) => {
    const label = fieldplan.LABEL[fill];
    if (label === '직접 입력') return;    // 판 이름과 같은 문자열이라 fields-core 의 LEVELS 에서 온다
    assert.ok(html.indexOf("'" + label + "'") === -1 && html.indexOf('"' + label + '"') === -1,
      `fields.html 이 채움 경로 이름 '${label}' 을 직접 적어 두고 있다 — 서버가 준 label 을 써야 한다`);
  });
});

/* ───────────── 이미 받아 오면서 버리던 값 (2026-08-16) ───────────── */

test('★ 실적치와 법정 상한을 다른 항목으로 둔다', () => {
  // 한 칸에 섞으면 "용적률 320%" 가 지어도 되는 한도인지 이미 지은 결과인지 모른다
  ['building.bcr', 'building.far'].forEach((k) => {
    assert.ok(dict.FIELDS[k], `${k} 가 사전에 없다`);
  });
  assert.notStrictEqual(dict.FIELDS['building.far'].label, dict.FIELDS['land.far_limit'].label);
  assert.match(dict.FIELDS['building.far'].label, /실적/);
  assert.match(dict.FIELDS['land.far_limit'].label, /상한/);
});

test('★ 새 값이 호출을 늘리지 않는다 (이미 받던 응답에서 꺼낸다)', () => {
  const fs = require('fs');
  const path = require('path');
  const geo = fs.readFileSync(path.join(__dirname, '..', 'agents', '07-geo.js'), 'utf8');

  // 07 Geo 가 부르는 커넥터 호출 횟수 — 늘어나면 쿼터가 는다
  const calls = (geo.match(/await (vworld|nsdi|molit)\.\w+\(/g) || []);
  assert.strictEqual(calls.length, 5,
    `공공데이터 호출이 ${calls.length}회다 — 값을 더 등록하되 호출은 그대로여야 한다`);
});

test('★ 대장이 있으면 허가 연면적을 겹쳐 넣지 않는다', () => {
  const fs = require('fs');
  const path = require('path');
  const geo = fs.readFileSync(path.join(__dirname, '..', 'agents', '07-geo.js'), 'utf8');
  assert.match(geo, /const noRegister = !out\.building/,
    '허가(계획)와 대장(준공 실적)은 정상적으로도 다르다 — 둘 다 넣으면 매 딜마다 값 충돌이 뜬다');
});

/**
 * ★ 채움 개수는 **켜져 있는 키에 따라 달라진다.** withPublicKeys 는 VWORLD 와
 *   DATA_GO_KR 만 켠다 (ECOS 는 안 켠다) — 그래서 여기 숫자는 9 이고, ECOS 까지
 *   넣으면 `debt.benchmark_rate` 가 붙어 10 이 된다. 키 하나를 기준으로 굳혀 두면
 *   나중에 "왜 9 냐"로 다시 헤맨다.
 */
test('공공데이터가 채우는 항목이 늘었다', () => {
  withPublicKeys(() => {
    const p = fieldplan.plan('datacenter');
    const pub = Object.keys(p).filter(k => p[k].fill === 'public');
    assert.ok(pub.includes('land.jibun'), '지번은 지적도 응답에 항상 들어 있다');
    assert.ok(pub.length >= 9, `공공데이터 채움이 ${pub.length}개 — 줄었다면 무엇이 빠졌는지 봐야 한다`);

    const beforeEcos = process.env.ECOS_API_KEY;
    process.env.ECOS_API_KEY = 'test-key';
    try {
      const withRate = fieldplan.plan('datacenter');
      assert.strictEqual(withRate['debt.benchmark_rate'].fill, 'public',
        'ECOS 키가 있으면 기준금리는 물어보지 않는다');
    } finally {
      if (beforeEcos === undefined) delete process.env.ECOS_API_KEY;
      else process.env.ECOS_API_KEY = beforeEcos;
    }
  });
});
