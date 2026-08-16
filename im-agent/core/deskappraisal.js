'use strict';
/**
 * deskappraisal.js — **탁상검토 보고서**(탁상감정) 생성 (등록부 D-57).
 *
 * `08-appraisal.js` 는 이미 3방식을 계산한다. 그런데 그 결과는 `04_Property/
 * appraisal.json` 과 IM 본문 한 줄로만 남아 있었다 — **문서가 없었다.**
 * 토지가치만 따로 물어보는 자리(대주단 사전검토·내부 투심 전 단계)에서 IM
 * 40쪽을 통째로 돌릴 수는 없다.
 *
 * ★★ **이 문서는 감정평가서가 아니다.** 대한민국에서 감정평가는 「감정평가 및
 *    감정평가사에 관한 법률」에 따라 **감정평가법인등만** 수행할 수 있다.
 *    그래서 이 파일은 **형식이 그럴듯해지는 것을 막는 쪽으로** 짜여 있다 —
 *    표지·고지·꼬리말 세 곳에 같은 사실을 적고, 어느 하나를 지워도 나머지가 남는다.
 *
 * ★ **「탁상」이 무엇을 뜻하는지 문서가 스스로 말한다.** 탁상검토는 현장을 보지
 *   않은 검토다. 그런데 완성된 표를 받아 든 사람은 그 사실을 잊는다 — 숫자가
 *   또렷할수록 더 잊는다. 그래서 **확인하지 않은 것의 목록**을 결론보다 앞에 둔다.
 *
 * ★ **방식이 갈리면 하나로 좁히지 않는다.** 3방식 편차가 2배 이상이면 가중평균
 *   한 점이 나와도 그것은 「가운데 어딘가」일 뿐이다. 표지에 큰 글씨로 한 숫자가
 *   박히면 **그 숫자만 읽힌다.** 그때는 범위로 제시하고 이유를 적는다.
 *
 * ★ **LLM 을 쓰지 않는다.** `core/reports.js` 와 같은 원칙 — 전부 계산 결과에서
 *   기계적으로 만든다. 평가 문서에서 지어낸 문장은 그 자체가 사고다.
 */

const { round, formatEok } = require('./numeric');
const { kstDate, kstStamp } = require('./kst');

/**
 * 이 문서가 **확인하지 않은 것**. 탁상검토의 정의 그 자체다.
 *
 * ★ 목록을 짧게 줄이고 싶은 유혹이 있다 — 문서가 약해 보이기 때문이다. 그런데
 *   이 목록이 빠지면 읽는 사람은 **현장을 본 검토로 읽는다.** 그것이 이 문서가
 *   낼 수 있는 가장 큰 사고다.
 */
const NOT_CHECKED = [
  { item: '현장 조사', why: '방문하지 않았다 — 아래 항목이 전부 여기서 나온다' },
  { item: '접도 조건', why: '도로에 접하는지·너비·진입 가능 여부는 공부에 안 나온다. 맹지면 가치가 통째로 달라진다' },
  { item: '지세·경사·형상', why: '같은 면적이라도 쓸 수 있는 땅의 크기가 다르다' },
  { item: '점유 상태', why: '분묘·무허가 건축물·불법 점유는 등기부에 안 나온다' },
  { item: '임차 현황', why: '명도 비용과 기간이 취득 조건을 바꾼다' },
  { item: '토양·지장물', why: '오염·매설물은 조사해야 나온다. 정화비용이 토지비를 넘는 경우가 있다' },
  { item: '인접 필지 관계', why: '합필·분필 전제 사업은 인접 필지 확보가 성립 조건이다' },
];

/** 문서 어디에나 붙는 한 줄. **세 곳에 같은 말이 들어간다** */
const NOT_AN_APPRAISAL = '본 문서는 「감정평가 및 감정평가사에 관한 법률」상 감정평가가 아니며 법적 효력이 없다. '
  + '감정평가법인등이 작성한 것이 아니고, 현장조사를 수행하지 않은 탁상검토다. '
  + '투자·담보 확정 전 정식 감정평가가 필요하다.';

/** 방식 id → 사람이 읽는 이름. `08-appraisal` 의 키와 같아야 한다 */
const METHOD_ORDER = ['comparison', 'income', 'official'];

function methodRows(methods) {
  const m = methods || {};
  return METHOD_ORDER
    .filter(k => m[k])
    .map(k => ({ id: k, ...m[k] }));
}

/** 값이 있는 방식만 (없는 방식을 0 으로 세지 않는다) */
function usableRows(methods) {
  return methodRows(methods).filter(r => r.valueEok !== null && r.valueEok !== undefined && r.valueEok > 0);
}

/**
 * 방식 간 편차(배수). 하나뿐이면 잴 것이 없다 — `null` 이다.
 *
 * ★ **1 을 돌려주지 않는다.** 1 은 「완전히 일치했다」는 뜻이고, 그건 방식이
 *   하나뿐이었다는 사실을 지운다.
 */
function spreadOf(methods) {
  const vals = usableRows(methods).map(r => r.valueEok);
  if (vals.length < 2) return null;
  return round(Math.max(...vals) / Math.min(...vals), 2);
}

/**
 * 결론을 어떻게 제시할 것인가.
 *
 *   single  방식이 하나뿐 — **결론을 내지 않는다.** 한 방식의 값은 그 방식의
 *           가정에 그대로 끌려다닌다 (수익환원법은 Cap Rate 하나가 값을 정한다)
 *   range   편차가 크다 — **범위로만** 낸다. 점 하나를 크게 박으면 그것만 읽힌다
 *   point   방식이 모이고 편차가 작다 — 점으로 낸다 (그래도 범위를 함께 적는다)
 */
function conclusion(appraisal) {
  const a = appraisal || {};
  const rows = usableRows(a.methods);

  if (!rows.length) {
    return {
      mode: 'none',
      text: '평가 3방식 중 어느 것도 산정되지 않았다 — 값을 제시하지 않는다',
      why: '공시지가·실거래·재무모델 가운데 최소 하나가 있어야 한다',
      valueEok: null, rangeEok: null,
    };
  }

  const values = rows.map(r => r.valueEok);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const spread = spreadOf(a.methods);

  if (rows.length === 1) {
    return {
      mode: 'single',
      valueEok: null,
      rangeEok: null,
      only: { label: rows[0].label, valueEok: rows[0].valueEok },
      text: `${rows[0].label} 단독 ${formatEok(rows[0].valueEok)} — **결론값으로 제시하지 않는다**`,
      why: '한 방식만으로는 그 방식의 가정이 곧 결론이 된다. '
        + '다른 방식과 견주지 못한 값을 대표값으로 쓰면 가정이 사실처럼 남는다',
    };
  }

  if (spread !== null && spread >= 2) {
    return {
      mode: 'range',
      valueEok: null,
      rangeEok: [lo, hi],
      spread,
      text: `${formatEok(lo)} ~ ${formatEok(hi)} (방식 간 ${spread}배) — **단일 값으로 제시하지 않는다**`,
      why: `방식 간 편차가 ${spread}배다. 가중평균을 내면 숫자는 하나로 좁혀지지만 `
        + '그 값은 「가운데 어딘가」일 뿐이고, 표지에 크게 박히면 그것만 읽힌다. '
        + '어느 방식이 이 사업에 맞는지 사람이 정한다',
    };
  }

  const c = a.concluded;
  return {
    mode: 'point',
    valueEok: c ? c.valueEok : null,
    rangeEok: [lo, hi],
    spread,
    weights: c ? c.weights : null,
    pricePerSqm: c ? c.pricePerSqm : null,
    text: c
      ? `${formatEok(c.valueEok)} (범위 ${formatEok(lo)} ~ ${formatEok(hi)})`
      : `${formatEok(lo)} ~ ${formatEok(hi)}`,
    why: null,
  };
}

/**
 * 문서에 실리는 가정 목록.
 *
 * ★ **가정과 공표 통계를 섞지 않는다** (§4.8). 공시지가 시점수정은 한국부동산원
 *   공표 지가지수라 가정이 아니고, 현실화계수는 가정이다 — 둘을 한 줄에 적으면
 *   양쪽 다 근거 있는 값으로 읽힌다.
 */
function assumptions(methods) {
  return methodRows(methods)
    .filter(r => r.assumption)
    .map(r => ({ method: r.label, text: r.assumption }));
}

function fmtNum(n) {
  return n === null || n === undefined ? '—' : Number(n).toLocaleString('ko-KR');
}

/* ───────────── 본문 ───────────── */

function sectionNotice() {
  const rows = NOT_CHECKED.map(x => `| ${x.item} | ${x.why} |`).join('\n');
  return [
    '본 검토는 **현장을 보지 않고** 공부(公簿)와 공공데이터만으로 수행했다.',
    '아래 항목은 **확인하지 않았다.** 확인하지 않은 것은 「문제가 없다」는 뜻이 아니다.',
    '',
    '| 확인하지 않은 것 | 왜 문제가 되는가 |',
    '|---|---|',
    rows,
    '',
    '자료출처: 본 자료 — 탁상검토의 범위 정의.',
  ].join('\n');
}

function sectionSubject(o) {
  const rows = [
    ['소재지', o.location || '[미확인]'],
    ['PNU', o.pnu || '[미확인]'],
    ['대지면적', o.areaSqm !== null && o.areaSqm !== undefined ? `${fmtNum(o.areaSqm)} ㎡` : '[미확인]'],
    ['용도지역', o.zoning || '[미확인]'],
    ['지역·지구', o.useDistricts || '[미확인]'],
    ['검토 기준일', o.asOf],
  ].map(([k, v]) => `| ${k} | ${v} |`).join('\n');

  return ['| 항목 | 내용 |', '|---|---|', rows, '',
    '자료출처: 제출 자료 및 공공데이터(국토교통부·VWorld). 항목별 출처는 4장에 있다.'].join('\n');
}

function sectionMethods(methods) {
  const rows = methodRows(methods);
  if (!rows.length) return '산정된 방식이 없다.';

  const body = rows.map((r) => {
    const val = (r.valueEok === null || r.valueEok === undefined) ? '산정 불가' : formatEok(r.valueEok);
    const unit = r.pricePerSqm ? `${fmtNum(r.pricePerSqm)} 원/㎡` : (r.adjustedPricePerSqm ? `${fmtNum(r.adjustedPricePerSqm)} 원/㎡` : '—');
    return `| ${r.label} | ${unit} | ${val} | ${r.basis || '—'} |`;
  }).join('\n');

  const extra = [];
  const cmp = rows.find(r => r.id === 'comparison');
  // ★ **모수를 적는다** (§4.7). 3건 중앙값과 47건 중앙값은 다른 값이다
  if (cmp && cmp.sampleCount !== undefined) {
    extra.push('', `거래사례비교법은 최근 ${cmp.periodMonths}개월 **${cmp.sampleCount}건**의 중앙값이다.`
      + (cmp.sampleCount < 5 ? ' **표본이 5건 미만이라 중앙값이 한두 건에 끌려다닌다.**' : ''));
  }

  return ['| 방식 | 단가 | 산정액 | 근거 |', '|---|---|---|---|', body, ...extra, '',
    '자료출처: 본 자료 08 Appraisal Agent 산출. 방식별 근거는 위 표에 있다.'].join('\n');
}

function sectionConclusion(c) {
  const out = [];

  if (c.mode === 'none') {
    out.push(`**${c.text}**`, '', c.why);
  } else if (c.mode === 'single') {
    out.push(`**${c.text}**`, '', c.why);
  } else if (c.mode === 'range') {
    out.push(`### 참고 범위: ${formatEok(c.rangeEok[0])} ~ ${formatEok(c.rangeEok[1])}`, '', `**${c.text}**`, '', c.why);
  } else {
    out.push(`### 참고 산정액: ${formatEok(c.valueEok)}`, '');
    out.push(`| 항목 | 값 |`, '|---|---|');
    out.push(`| 참고 산정액 | ${formatEok(c.valueEok)} |`);
    out.push(`| 방식 간 범위 | ${formatEok(c.rangeEok[0])} ~ ${formatEok(c.rangeEok[1])} |`);
    if (c.spread !== null && c.spread !== undefined) out.push(`| 방식 간 편차 | ${c.spread}배 |`);
    if (c.pricePerSqm) out.push(`| 환산 단가 | ${fmtNum(c.pricePerSqm)} 원/㎡ |`);
    if (c.weights) {
      Object.entries(c.weights).forEach(([k, v]) => out.push(`| 가중치 — ${k} | ${v} |`));
    }
  }

  out.push('', `**${NOT_AN_APPRAISAL}**`, '',
    '자료출처: 본 자료 08 Appraisal Agent 산출 및 위 3장의 방식별 결과.');
  return out.join('\n');
}

function sectionAssumptions(methods) {
  const list = assumptions(methods);
  if (!list.length) return '기재된 가정이 없다 — 방식이 산정되지 않았다는 뜻이다.';
  return [
    '아래는 **가정**이다. 가정이 바뀌면 산정액이 바뀐다.',
    '',
    '| 방식 | 가정 |', '|---|---|',
    ...list.map(a => `| ${a.method} | ${a.text} |`),
    '',
    '자료출처: 본 자료 각 방식의 산정 조건.',
  ].join('\n');
}

function sectionFlags(flags) {
  const list = (flags || []).filter(f => f.severity === 'RED' || f.severity === 'YELLOW');
  if (!list.length) {
    // ★ **「없다」를 「문제 없다」로 쓰지 않는다**
    return '자동 점검에서 걸린 항목이 없다. **점검하지 않은 항목(2장)은 여기에 안 나온다.**';
  }
  return [
    '| 등급 | 내용 |', '|---|---|',
    ...list.map(f => `| ${f.severity} | ${f.message} |`),
    '',
    '자료출처: 본 자료 자동 점검 결과.',
  ].join('\n');
}

function sectionComparables(comparables) {
  const list = (comparables || []).slice(0, 15);
  if (!list.length) return '조회된 거래사례가 없다. **거래가 없었다는 뜻이 아니다** — 조회 범위·기간 밖일 수 있다.';
  return [
    `조회된 ${(comparables || []).length}건 중 최근 ${list.length}건이다.`,
    '',
    '| 계약일 | 면적(㎡) | 단가(원/㎡) | 소재 |', '|---|---:|---:|---|',
    ...list.map(t => `| ${t.dealDate || '—'} | ${fmtNum(t.areaSqm)} | ${fmtNum(t.pricePerSqm)} | ${t.address || '—'} |`),
    '',
    '**위치·형상·접도 보정을 하지 않은 원자료다.**',
    '',
    '자료출처: 국토교통부 실거래가 공개시스템.',
  ].join('\n');
}

/**
 * 보고서를 만든다.
 *
 * @param {object} o { projectId, projectName, location, pnu, areaSqm, zoning,
 *                     useDistricts, appraisal, asOf }
 * @returns {{ok, sections, markdown, conclusion, notChecked, reason?}}
 */
function build(o) {
  const opt = o || {};
  const a = opt.appraisal;

  if (!a) {
    // ★ 08 이 안 돌았으면 **빈 문서를 만들지 않는다.** 표지만 있는 평가서가
    //   나가면 그 자체로 오해를 만든다
    return { ok: false, reason: '감정평가 산출 결과가 없다 — 08 Appraisal 이 돌지 않았거나 결과가 비었다' };
  }

  const asOf = opt.asOf || kstDate();
  const c = conclusion(a);

  const sections = [
    { no: '01', title: '검토 개요', subtitle: 'Scope', text: [
      `본 문서는 **${opt.projectName || opt.projectId}** 의 토지가치를 공부와 공공데이터만으로 검토한 자료다.`,
      '',
      `- 검토 기준일: ${asOf} (KST)`,
      '- 방식: 공시지가 기준 · 거래사례비교법 · 수익환원법 (산정 가능한 것만)',
      '- 수행: LinkPilot IM Agent (자동 산출 — 사람이 작성한 문서가 아니다)',
      '',
      `**${NOT_AN_APPRAISAL}**`,
      '',
      '자료출처: 본 자료 — 검토 범위 정의.',
    ].join('\n') },
    { no: '02', title: '확인하지 않은 것', subtitle: 'Not Verified', text: sectionNotice() },
    { no: '03', title: '대상 토지', subtitle: 'Subject', text: sectionSubject({ ...opt, asOf }) },
    { no: '04', title: '평가 방식별 결과', subtitle: 'Methods', text: sectionMethods(a.methods) },
    { no: '05', title: '결론', subtitle: 'Conclusion', text: sectionConclusion(c) },
    { no: '06', title: '적용한 가정', subtitle: 'Assumptions', text: sectionAssumptions(a.methods) },
    { no: '07', title: '점검에서 걸린 항목', subtitle: 'Flags', text: sectionFlags(a.flags) },
    { no: '08', title: '거래사례', subtitle: 'Comparables', text: sectionComparables(a.comparables) },
  ];

  const markdown = [
    'Strictly Private and Confidential',
    '',
    `# 토지가치 탁상검토 보고서`,
    '',
    `> **${NOT_AN_APPRAISAL}**`,
    '',
    `- Project: ${opt.projectName || opt.projectId}`,
    `- Project ID: ${opt.projectId}`,
    `- 검토 기준일: ${asOf} (KST)`,
    `- 생성: ${kstStamp()}`,
    '',
    ...sections.map(s => [`## ${s.no}. ${s.title}`, '', s.text, ''].join('\n')),
    '---',
    '',
    NOT_AN_APPRAISAL,
  ].join('\n');

  return {
    ok: true,
    sections,
    markdown,
    conclusion: c,
    notChecked: NOT_CHECKED.map(x => x.item),
    disclaimers: [NOT_AN_APPRAISAL],
    asOf,
  };
}

/**
 * 표지에 넣을 값 문구. **모드에 따라 다르다** — 점 하나가 나올 수 없는 경우가 있다.
 */
function coverValue(c) {
  if (!c) return null;
  if (c.mode === 'point') return `${formatEok(c.valueEok)}`;
  if (c.mode === 'range') return `${formatEok(c.rangeEok[0])} ~ ${formatEok(c.rangeEok[1])}`;
  // ★ single·none 은 **표지에 숫자를 올리지 않는다.** 표지 숫자는 그것만 읽힌다
  return null;
}

module.exports = {
  build, conclusion, spreadOf, assumptions, coverValue,
  usableRows, methodRows,
  NOT_CHECKED, NOT_AN_APPRAISAL,
};
