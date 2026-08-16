'use strict';
/**
 * deskappraisal.test.js — 탁상검토 보고서 (등록부 D-57).
 *
 * 이 문서의 위험은 **다른 산출물과 성격이 다르다.**
 *
 * 재무모델이 틀리면 숫자가 틀린다. 이 문서는 **틀리지 않아도 사고가 난다** —
 * 형식이 그럴듯하면 받는 사람이 **정식 감정평가로 읽기 때문이다.** 대한민국에서
 * 감정평가는 감정평가법인등만 할 수 있고, 그 경계를 문서가 스스로 지켜야 한다.
 *
 * 그래서 여기서 못 박는 것은 넷이다.
 *
 *  ① **감정평가서가 아니라는 사실이 여러 곳에 있는가** — 한 곳만 있으면
 *     한 장이 떨어져 나갔을 때 사라진다.
 *  ② **안 본 것을 안 봤다고 적는가** — 「탁상」의 정의다. 이 목록이 빠지면
 *     현장을 본 검토로 읽힌다.
 *  ③ **방식이 갈릴 때 하나로 좁히지 않는가** — 표지에 큰 숫자 하나가 박히면
 *     그것만 읽힌다.
 *  ④ **없는 것을 없다고 하는가** — 「사례 0건」이 「거래가 없었다」가 되면 안 된다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const da = require('../core/deskappraisal');
const outputspec = require('../core/outputspec');

/** 08-appraisal 이 내놓는 모양 그대로 */
function appraisalOf(methods, extra) {
  return Object.assign({
    methods: methods || {},
    concluded: null,
    facts: [], flags: [], comparables: [],
    disclaimer: '참고용 간이 평가',
  }, extra || {});
}

const M_OFFICIAL = { label: '공시지가 기준', valueEok: 100, adjustedPricePerSqm: 1200000, basis: '개별공시지가(2026년 고시)', assumption: '현실화계수 1.6 은 가정이다' };
const M_COMPARE = { label: '거래사례비교법', valueEok: 120, pricePerSqm: 1400000, sampleCount: 47, periodMonths: 6, basis: '실거래 47건 중앙값', assumption: '보정하지 않았다' };
const M_INCOME = { label: '수익환원법', valueEok: 110, basis: 'NOI ÷ Cap Rate', assumption: '건물가치를 공사비로 대체했다' };

/* ── ① 감정평가서가 아니라는 사실 ─────────────────────── */

test('★ 「감정평가서가 아니다」가 **여러 곳**에 들어간다', () => {
  const r = da.build({ projectId: 'P1', projectName: '테스트', appraisal: appraisalOf({ official: M_OFFICIAL, comparison: M_COMPARE }) });
  assert.strictEqual(r.ok, true);

  // 머리말
  assert.match(r.markdown.split('## 01')[0], /감정평가가 아니며/);
  // 본문 1장
  assert.match(r.sections[0].text, /감정평가가 아니며/);
  // 결론
  assert.match(r.sections.find(s => s.title === '결론').text, /감정평가가 아니며/);
  // 꼬리말
  assert.match(r.markdown.trim().split('\n').slice(-1)[0], /감정평가가 아니며/);
});

test('★ 고지에 **누가 안 했는지·무엇을 안 했는지**가 함께 있다', () => {
  // 「법적 효력 없음」만 적으면 왜 없는지 모른다
  assert.match(da.NOT_AN_APPRAISAL, /감정평가법인등이 작성한 것이 아니고/);
  assert.match(da.NOT_AN_APPRAISAL, /현장조사를 수행하지 않은/);
  assert.match(da.NOT_AN_APPRAISAL, /정식 감정평가가 필요하다/);
});

test('★ 문서 사양이 「Appraisal」을 이름에 쓰지 않는다', () => {
  const p = outputspec.PRESETS.desk_appraisal;
  assert.ok(p, '탁상검토 사양이 없다');
  assert.ok(!/appraisal/i.test(p.label), `label 에 Appraisal 이 들어가면 형식만으로 정식 평가처럼 읽힌다: ${p.label}`);
  // 낱장으로 굴러다니기 쉬운 문서라 워터마크를 켠다
  assert.strictEqual(p.watermark, true);
});

/* ── ② 안 본 것을 안 봤다고 적는다 ───────────────────── */

test('★ 확인하지 않은 것이 **결론보다 앞에** 있다', () => {
  const r = da.build({ projectId: 'P1', appraisal: appraisalOf({ official: M_OFFICIAL, comparison: M_COMPARE }) });
  const iNot = r.sections.findIndex(s => s.title === '확인하지 않은 것');
  const iConc = r.sections.findIndex(s => s.title === '결론');
  assert.ok(iNot >= 0 && iNot < iConc, '안 본 것이 결론 뒤에 있으면 아무도 안 읽는다');
});

test('★ 접도·점유·토양처럼 **값을 뒤집는 것**이 목록에 있다', () => {
  const items = da.NOT_CHECKED.map(x => x.item).join(' ');
  ['현장', '접도', '점유', '토양'].forEach((k) => {
    assert.ok(items.includes(k), `${k} 가 빠졌다 — 이 목록이 짧아지면 현장을 본 검토로 읽힌다`);
  });
  // 왜 문제가 되는지도 함께 (항목만 있으면 그냥 넘긴다)
  da.NOT_CHECKED.forEach(x => assert.ok(x.why && x.why.length > 10, `${x.item}: 이유가 없다`));
});

test('★ 「확인하지 않음」이 「문제 없음」이 되지 않는다', () => {
  const r = da.build({ projectId: 'P1', appraisal: appraisalOf({ official: M_OFFICIAL }) });
  assert.match(r.sections.find(s => s.title === '확인하지 않은 것').text, /「문제가 없다」는 뜻이 아니다/);
});

test('★ 걸린 항목이 없어도 「문제 없다」고 하지 않는다', () => {
  const r = da.build({ projectId: 'P1', appraisal: appraisalOf({ official: M_OFFICIAL }, { flags: [] }) });
  const t = r.sections.find(s => s.title === '점검에서 걸린 항목').text;
  assert.match(t, /점검하지 않은 항목/);
});

/* ── ③ 방식이 갈릴 때 좁히지 않는다 ──────────────────── */

test('★ 방식이 하나뿐이면 **결론값을 내지 않는다**', () => {
  const c = da.conclusion(appraisalOf({ income: M_INCOME }));
  assert.strictEqual(c.mode, 'single');
  assert.strictEqual(c.valueEok, null);
  assert.match(c.why, /그 방식의 가정이 곧 결론/);
  // 표지에도 안 올린다
  assert.strictEqual(da.coverValue(c), null);
});

test('★ 편차가 2배 이상이면 **범위로만** 낸다', () => {
  const c = da.conclusion(appraisalOf(
    { official: { label: '공시지가 기준', valueEok: 50 }, comparison: { label: '거래사례비교법', valueEok: 150 } },
    { concluded: { valueEok: 100, weights: {}, pricePerSqm: 1 } },
  ));
  assert.strictEqual(c.mode, 'range');
  assert.strictEqual(c.valueEok, null, '편차가 큰데 점 하나가 나왔다 — 표지에 박히면 그것만 읽힌다');
  assert.deepStrictEqual(c.rangeEok, [50, 150]);
  assert.strictEqual(c.spread, 3);
  assert.match(da.coverValue(c), /~/);
});

test('★ 방식이 모이고 편차가 작으면 점으로 내되 **범위를 함께 적는다**', () => {
  const c = da.conclusion(appraisalOf(
    { official: M_OFFICIAL, comparison: M_COMPARE, income: M_INCOME },
    { concluded: { valueEok: 112, weights: { '거래사례비교법': 0.5 }, pricePerSqm: 1300000 } },
  ));
  assert.strictEqual(c.mode, 'point');
  assert.strictEqual(c.valueEok, 112);
  assert.deepStrictEqual(c.rangeEok, [100, 120]);
});

test('★ 방식이 하나면 편차를 1 로 두지 않는다 — 잰 적이 없다', () => {
  assert.strictEqual(da.spreadOf({ income: M_INCOME }), null,
    '1 은 「완전히 일치했다」는 뜻이라 방식이 하나였다는 사실을 지운다');
  assert.strictEqual(da.spreadOf({ official: M_OFFICIAL, comparison: M_COMPARE }), 1.2);
});

test('★ 산정된 방식이 없으면 값을 제시하지 않는다', () => {
  const c = da.conclusion(appraisalOf({}));
  assert.strictEqual(c.mode, 'none');
  assert.strictEqual(c.valueEok, null);
  assert.strictEqual(da.coverValue(c), null);
});

test('★ 값이 0 이하인 방식은 세지 않는다 — 「산정됐다」로 읽히면 안 된다', () => {
  const rows = da.usableRows({ income: { label: '수익환원법', valueEok: -20 }, official: M_OFFICIAL });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].label, '공시지가 기준');
});

/* ── ④ 없는 것을 없다고 한다 ────────────────────────── */

test('★ 사례 0건이 「거래가 없었다」가 되지 않는다', () => {
  const r = da.build({ projectId: 'P1', appraisal: appraisalOf({ official: M_OFFICIAL }, { comparables: [] }) });
  const t = r.sections.find(s => s.title === '거래사례').text;
  assert.match(t, /거래가 없었다는 뜻이 아니다/);
});

test('★ 표본 수를 적고, 적으면 적다고 말한다 (§4.7)', () => {
  const few = da.build({ projectId: 'P1', appraisal: appraisalOf({ comparison: { ...M_COMPARE, sampleCount: 3 } }) });
  const t = few.sections.find(s => s.title === '평가 방식별 결과').text;
  assert.match(t, /\*\*3건\*\*/);
  assert.match(t, /한두 건에 끌려다닌다/);

  const many = da.build({ projectId: 'P1', appraisal: appraisalOf({ comparison: M_COMPARE }) });
  assert.ok(!/한두 건에 끌려다닌다/.test(many.sections.find(s => s.title === '평가 방식별 결과').text));
});

test('★ 08 이 안 돌았으면 **빈 문서를 만들지 않는다**', () => {
  const r = da.build({ projectId: 'P1', appraisal: null });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /08 Appraisal/);
});

/* ── 가정 ────────────────────────────────────────────── */

test('★ 가정을 방식별로 따로 적는다 (§4.8)', () => {
  const list = da.assumptions({ official: M_OFFICIAL, comparison: M_COMPARE });
  assert.strictEqual(list.length, 2);
  assert.ok(list.some(a => /현실화계수/.test(a.text)), '현실화계수가 가정이라는 사실이 빠졌다');
});

test('★ 가정 절이 「가정이 바뀌면 값이 바뀐다」고 말한다', () => {
  const r = da.build({ projectId: 'P1', appraisal: appraisalOf({ official: M_OFFICIAL }) });
  assert.match(r.sections.find(s => s.title === '적용한 가정').text, /가정이 바뀌면 산정액이 바뀐다/);
});

/* ── 지어내지 않는다 ─────────────────────────────────── */

test('★ LLM 을 쓰지 않는다 — 평가 문서에서 지어낸 문장은 그 자체가 사고다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'deskappraisal.js'), 'utf8');
  assert.ok(!/require\(.*llm/.test(src), 'LLM 을 부르고 있다');
});

test('★ 값이 없으면 [미확인] 로 남는다 — 지어내지 않는다', () => {
  const r = da.build({ projectId: 'P1', appraisal: appraisalOf({ official: M_OFFICIAL }) });
  const t = r.sections.find(s => s.title === '대상 토지').text;
  assert.match(t, /\[미확인\]/);
});

/* ── 표지 ────────────────────────────────────────────── */

test('★ 표지가 IM 문구로 고정되어 있지 않다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'design', 'a4.js'), 'utf8');
  assert.match(src, /docLabel \|\|/, '표지 문구가 고정이면 탁상검토가 IM 처럼 보인다');
  assert.match(src, /doc\.docTitle \|\|/);
});

test('★ 파이프라인이 표지 문구에 「감정평가서가 아님」을 넣는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
  assert.match(src, /감정평가서가 아님/);
  assert.match(src, /desk-review\.md/);
  // 문서를 안 만든 경우도 로그에 남아야 한다
  assert.match(src, /탁상검토: 만들지 않았다/);
});
