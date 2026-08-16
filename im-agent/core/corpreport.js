'use strict';
/**
 * corpreport.js — **법인평가 보고서** 생성 (등록부 D-59).
 *
 * `core/deskappraisal.js` 와 같은 구조다. 토지에서 했던 것을 법인에 대해 한다 —
 * 그리고 **위험도 같다.** 틀리지 않아도 사고가 난다: 형식이 그럴듯하면 받는
 * 사람이 **평가의견서로 읽기 때문이다.**
 *
 * ★★ **평가의견서가 아니다.** 「자본시장과 금융투자업에 관한 법률」상 합병·
 *    영업양수도 등의 외부평가는 **외부평가기관(회계법인·신용평가회사·채권평가
 *    회사)만** 할 수 있고, 세무 목적 평가는 세무대리인의 영역이다. 그래서
 *    「감정평가서가 아니다」와 같은 방식으로 **다섯 곳에** 그 사실을 적는다.
 *
 * ★ **적용한 법령 산식을 그대로 인쇄한다.** 법령은 개정된다 — REC 가중치에서
 *   배운 것과 같은 자리다. 결과만 적으면 개정된 날부터 조용히 틀리고 문서에는
 *   「보충적 평가방법 적용」만 남는다. **산식을 적어 두면 사람이 대조할 수 있다.**
 *
 * ★ **LLM 을 쓰지 않는다.** 평가 문서에서 지어낸 문장은 그 자체가 사고다.
 */

const { round } = require('./numeric');
const { kstDate, kstStamp } = require('./kst');
const corpvalue = require('./corpvalue');

/**
 * 이 보고서가 **확인하지 않은 것.** 탁상검토의 목록과 성격이 같다.
 *
 * ★ 법인평가에서 이 목록이 더 중요한 이유가 있다 — 토지는 공부(公簿)라도 있지만
 *   **비상장 법인은 공적 자료가 거의 없다.** 재무제표조차 제출받은 것이고,
 *   그 숫자가 맞는지 우리가 확인할 방법이 없다.
 */
const NOT_CHECKED = [
  { item: '재무제표 감사 여부', why: '감사받지 않은 재무제표는 회사가 만든 숫자다. 우리가 검증하지 않았다' },
  { item: '자산의 시가 평가', why: '법령상 순자산가액은 **시가**인데, 제출된 것은 대개 장부가다. 토지·건물 평가차액이 통째로 빠진다' },
  { item: '우발채무·소송', why: '보증·계류 소송은 재무상태표에 안 나온다. 하나가 순자산을 뒤집는다' },
  { item: '특수관계자 거래', why: '매출·이익이 관계사와의 거래로 만들어졌는지는 주석을 봐야 한다' },
  { item: '주식 종류·약정', why: '우선주·전환권·주주간 약정이 있으면 1주당 가치가 균등하지 않다' },
  { item: '지분 구조', why: '누가 얼마를 가졌는지에 따라 할증·할인이 갈린다 — 우리는 적용하지 않았다' },
];

/** 문서 어디에나 붙는 한 줄. **다섯 곳에 같은 말이 들어간다** */
const NOT_AN_OPINION = '본 문서는 「자본시장과 금융투자업에 관한 법률」상 외부평가기관의 평가의견서가 아니며, '
  + '세무 목적의 주식가치 평가서도 아니다. 외부평가기관·세무대리인이 작성한 것이 아니고, '
  + '제출된 재무자료를 법령이 정한 산식에 넣어 계산한 내부 검토용 참고 수치다. '
  + '거래·신고 확정 전 자격을 갖춘 평가기관의 평가가 필요하다.';

/** 절 제목은 한 곳에서만 만든다 — 본문이 절 번호를 손으로 가리키면 갈린다 */
const STATUTE_SECTION = '적용한 법령 산식';

function fmtEok(v) {
  return v === null || v === undefined ? '—' : `${Number(v).toLocaleString('ko-KR')}억원`;
}

function fmtNum(v) {
  return v === null || v === undefined ? '—' : Number(v).toLocaleString('ko-KR');
}

/**
 * 결론을 어떻게 제시할 것인가. `deskappraisal.conclusion` 과 같은 규칙이다.
 *
 *   none      계산이 안 된다 — 값을 내지 않는다
 *   blocked   가중치가 안 정해졌다 — **한쪽을 골라 놓지 않는다**
 *   negative  순손익가치가 음수다 — 값은 나오지만 **그 사실을 앞에 세운다**
 *   point     계산됐다
 */
function conclusion(v) {
  if (!v || !v.ok) {
    const unknownWeights = v && v.unknownWeights;
    return {
      mode: unknownWeights ? 'blocked' : 'none',
      valueEok: null,
      text: (v && v.error) || '계산에 필요한 자료가 없다',
      why: unknownWeights
        ? '부동산과다보유 여부가 안 정해지면 **어느 산식을 쓸지 정해지지 않는다.** '
          + '한쪽을 골라 놓고 「적용됨」으로 남기면 무엇이 빠졌는지 사라진다'
        : '제출 자료로는 법령이 정한 산식을 채울 수 없다',
    };
  }

  const negative = v.value.income && v.value.income.negative;
  return {
    mode: negative ? 'negative' : 'point',
    valueEok: v.value.valueEok,
    perShare: v.value.perShare || null,
    text: negative
      ? `${fmtEok(v.value.valueEok)} — **순손익가치가 음수다** (최근 3년 가중평균이 손실이다). `
        + '하한 규정으로 값이 남았을 뿐 수익성이 확인된 것이 아니다'
      : fmtEok(v.value.valueEok),
    why: null,
  };
}

/* ───────────── 본문 ───────────── */

function sectionNotChecked() {
  return [
    '본 평가는 **제출된 재무자료**와 법령이 정한 산식만으로 수행했다.',
    '아래 항목은 **확인하지 않았다.** 확인하지 않은 것은 「문제가 없다」는 뜻이 아니다.',
    '',
    '| 확인하지 않은 것 | 왜 문제가 되는가 |', '|---|---|',
    ...NOT_CHECKED.map(x => `| ${x.item} | ${x.why} |`),
    '',
    '자료출처: 본 자료 — 검토 범위 정의.',
  ].join('\n');
}

function sectionSubject(o) {
  return [
    '| 항목 | 내용 |', '|---|---|',
    `| 평가대상 법인 | ${o.corpName || '[미확인]'} |`,
    `| 법인등록번호 | ${o.jurirNo || '[미확인]'} |`,
    `| 공시 구분 | ${o.corpClass || '[미확인]'} |`,
    `| 발행주식총수 | ${o.shares ? `${fmtNum(o.shares)} 주` : '[미확인]'} |`,
    `| 평가 기준일 | ${o.asOf} |`,
    '',
    // ★ **DART 에 없는 것이 정상이다.** 그걸 안 적으면 「미확인」이 결함으로 읽힌다
    'DART 는 **공시대상회사만** 수록한다 — 일반 SPC·비상장 중소법인은 원래 없다. '
      + '「[미확인]」은 법인이 없다는 뜻이 아니다.',
    '',
    '자료출처: 제출 자료 및 금융감독원 전자공시(DART).',
  ].join('\n');
}

function sectionMethods(v) {
  if (!v || !v.ok) {
    return ['계산된 방식이 없다.', '', `사유: ${(v && v.error) || '자료 부족'}`].join('\n');
  }
  const val = v.value;
  const rows = [
    `| 순손익가치 | ${fmtEok(val.income.valueEok)} | 순손익 가중평균 ${val.income.weighted.avg}억원 ÷ 환원율 ${val.income.rate}% |`,
    `| 순자산가치 | ${fmtEok(val.asset.valueEok)} | 재무상태표 자본총계 |`,
  ].join('\n');

  const years = val.income.weighted;
  return [
    '| 방식 | 산정액 | 근거 |', '|---|---|---|', rows,
    '',
    `순손익 가중평균은 직전 1·2·3년 **${years.years.map(y => `${y}억원`).join(' / ')}** 에 `
      + `가중치 **${years.weights.join(':')}** 를 적용한 값이다.`,
    '',
    // ★ 장부가/시가 구분을 빼면 장부가가 그대로 평가액으로 실린다
    `**${val.asset.caution}**`,
    '',
    // ★ 절 번호를 **손으로 적지 않는다.** 실재 점검이 6장으로 들어오면서
    //   이 줄이 옛 번호를 가리키고 있었다 — 화면만 옛말을 하는 자리다
    `자료출처: 제출 재무자료 및 「${STATUTE_SECTION}」 절의 법령 산식.`,
  ].join('\n');
}

function sectionConclusion(c, v) {
  const out = [];

  if (c.mode === 'none' || c.mode === 'blocked') {
    out.push(`**값을 제시하지 않는다.**`, '', c.text, '', c.why);
  } else {
    out.push(`### 참고 산정액: ${fmtEok(c.valueEok)}`, '');
    if (c.mode === 'negative') out.push(`**${c.text}**`, '');
    out.push('| 항목 | 값 |', '|---|---|');
    out.push(`| 보충적 평가액 | ${fmtEok(v.value.valueEok)} |`);
    out.push(`| 산식값 | ${fmtEok(v.value.rawEok)} |`);
    out.push(`| 순자산 ${corpvalue.STATUTE.floorOfNetAssetPct}% 하한 | ${fmtEok(v.value.floorEok)} |`);
    out.push(`| 하한 적용 여부 | ${v.value.floorApplied ? '**적용됨**' : '해당 없음'} |`);
    out.push(`| 적용 가중치 | 순손익 ${v.value.weights.income} : 순자산 ${v.value.weights.asset} |`);
    if (v.value.perShare) out.push(`| 1주당 | ${fmtNum(v.value.perShare)} 원 |`);
  }

  out.push('', `**${NOT_AN_OPINION}**`, '', '자료출처: 본 자료 산출 및 위 4장의 방식별 결과.');
  return out.join('\n');
}

function sectionStatute(v) {
  const S = corpvalue.STATUTE;
  const lines = [
    '**적용한 산식을 그대로 적는다.** 법령은 개정된다 — 결과만 적으면 개정된 날부터',
    '조용히 틀리고 문서에는 「보충적 평가방법 적용」만 남는다.',
    '',
    '| 항목 | 적용값 |', '|---|---|',
    `| 근거 | ${S.basis} |`,
    `| 일반 법인 가중치 | 순손익 ${S.weightsNormal.income} : 순자산 ${S.weightsNormal.asset} |`,
    `| 부동산과다보유법인 가중치 | 순손익 ${S.weightsRealEstate.income} : 순자산 ${S.weightsRealEstate.asset} |`,
    `| 부동산과다보유 판정 기준 | 자산총액 중 부동산 ${S.realEstateThresholdPct}% 이상 |`,
    `| 순손익가치 환원율 | ${S.capitalizationRate}% |`,
    `| 순손익 연도별 가중치 | 직전 1·2·3년 ${S.incomeWeights.join(':')} |`,
    `| 순자산가치 하한 | ${S.floorOfNetAssetPct}% |`,
  ];
  if (v && v.ok) {
    lines.push(`| **이 건에 적용된 산식** | ${v.value.basis} |`);
    lines.push(`| 부동산 비율 | ${v.value.realEstate.pct}% → ${v.value.realEstate.heavy ? '부동산과다보유법인' : '일반 법인'} |`);
  }
  lines.push('', `⚠️ ${S.asOf}`, '',
    '자료출처: 상속세 및 증여세법 시행령 (조문 기준).');
  return lines.join('\n');
}

function sectionNotDone() {
  const market = corpvalue.marketMultipleValue();
  const premium = corpvalue.controlPremium();
  const nts = require('../connectors/nts');
  const nps = require('../connectors/nps');
  return [
    '아래는 **하지 않은 계산·조회**다. 못 해서가 아니라 **해서는 안 되거나**',
    '**법이 막고 있기 때문**이다.',
    '',
    '| 하지 않은 것 | 왜 |', '|---|---|',
    `| 유사기업 배수법 | ${market.error} |`,
    `| 최대주주 할증 | ${premium.error} |`,
    `| 납세증명·체납 조회 | ${nts.taxClearance().error} |`,
    `| 4대보험 완납 조회 | ${nps.insuranceClearance().error} |`,
    '',
    '자료출처: 본 자료 — 산출 범위 정의.',
  ].join('\n');
}

/**
 * 실재 점검 — **재무제표와 무관한 두 번째 출처** (등록부 D-60).
 *
 * ★ 재무제표는 회사가 만든 숫자고 등기는 껍데기만 말한다. 휴폐업은 국세청만
 *   알고, 인원·고지금액은 공단이 부과한 값이다.
 * ★ **판정하지 않는다.** 인원이 적은 것은 결함이 아니다 — SPC 는 직원이 없는
 *   것이 정상이다. 낼 수 있는 말은 사실과 그 사실의 뜻까지다.
 */
function sectionExistence(e) {
  if (!e || (!e.status && !e.workplace && !e.clearance)) {
    return [
      '실재 점검을 수행하지 않았다.',
      '',
      '사업자등록번호(`corp.biz_no`)를 넣으면 **휴폐업 상태**를 국세청에서 확인한다. '
        + '**법인등록번호(13자리)가 아니라 사업자등록번호(10자리)** 다.',
      '',
      '자료출처: 본 자료 — 점검 범위 정의.',
    ].join('\n');
  }

  const rows = [];
  if (e.status) {
    rows.push(`| 사업자등록 상태 | ${e.status.text} |`);
  }
  if (e.workplace) {
    rows.push(`| 국민연금 사업장 | ${e.workplace.text} |`);
  }
  rows.push(`| 납세·완납증명 | ${e.clearance || '**미제출** — API 로 조회할 수 없다. 당사자 발급분을 받아야 한다'} |`);

  return [
    '재무자료와 **무관한 출처**로 회사의 실재를 본다.',
    '',
    '| 항목 | 결과 |', '|---|---|',
    ...rows,
    '',
    '**인원이 적은 것은 결함이 아니다** — SPC 는 직원이 없는 것이 정상이고, '
      + '국민연금 자료는 **가입자 3인 이상 법인사업장**부터 수록한다.',
    '',
    '자료출처: 국세청 사업자등록 상태조회 · 국민연금공단 가입 사업장 내역.',
  ].join('\n');
}

/**
 * 보고서를 만든다.
 *
 * @param {object} o { projectId, corpName, jurirNo, corpClass, shares,
 *                     netAsset, income1, income2, income3, realEstatePct, asOf }
 */
function build(o) {
  const opt = o || {};
  const asOf = opt.asOf || kstDate();

  // ★ **대상 법인이 없으면 문서를 만들지 않는다.** 표지만 있는 평가서가 나가면
  //   그 자체로 오해를 만든다 (deskappraisal 과 같은 규칙)
  if (!opt.corpName) {
    return { ok: false, reason: '평가대상 법인이 지정되지 않았다 (corp.name)' };
  }
  // 순자산도 순손익도 없으면 **법령 산식을 채울 방법이 아예 없다**
  const hasAny = [opt.netAsset, opt.income1, opt.income2, opt.income3]
    .some(v => v !== null && v !== undefined && String(v).trim() !== '');
  if (!hasAny) {
    return {
      ok: false,
      reason: '재무자료가 하나도 없다 — DART 는 공시대상회사만 수록하므로 '
        + 'SPC·비상장 중소법인은 재무제표를 제출받아야 한다',
    };
  }

  const v = corpvalue.statutoryValue({
    netAsset: opt.netAsset,
    income1: opt.income1, income2: opt.income2, income3: opt.income3,
    realEstatePct: opt.realEstatePct,
  });

  // 1주당 — 주식수가 있을 때만. **없으면 만들지 않는다**
  if (v.ok && opt.shares) {
    const sh = Number(String(opt.shares).replace(/,/g, ''));
    if (Number.isFinite(sh) && sh > 0) {
      v.value.perShare = Math.round((v.value.valueEok * 1e8) / sh);
    }
  }

  const c = conclusion(v);

  const sections = [
    { no: '01', title: '검토 개요', subtitle: 'Scope', text: [
      `본 문서는 **${opt.corpName}** 의 주식가치를 제출된 재무자료와 법령이 정한 산식으로 검토한 자료다.`,
      '',
      `- 평가 기준일: ${asOf} (KST)`,
      `- 방식: ${corpvalue.STATUTE.basis}`,
      '- 수행: LinkPilot IM Agent (자동 산출 — 사람이 작성한 문서가 아니다)',
      '',
      `**${NOT_AN_OPINION}**`,
      '',
      '자료출처: 본 자료 — 검토 범위 정의.',
    ].join('\n') },
    { no: '02', title: '확인하지 않은 것', subtitle: 'Not Verified', text: sectionNotChecked() },
    { no: '03', title: '평가대상', subtitle: 'Subject', text: sectionSubject({ ...opt, asOf }) },
    { no: '04', title: '가치별 산정', subtitle: 'Methods', text: sectionMethods(v) },
    { no: '05', title: '결론', subtitle: 'Conclusion', text: sectionConclusion(c, v) },
    { no: '06', title: '실재 점검', subtitle: 'Existence', text: sectionExistence(opt.existence) },
    { no: '07', title: STATUTE_SECTION, subtitle: 'Statute', text: sectionStatute(v) },
    { no: '08', title: '하지 않은 계산·조회', subtitle: 'Out of Scope', text: sectionNotDone() },
  ];

  const markdown = [
    'Strictly Private and Confidential',
    '',
    '# 법인가치 검토 보고서',
    '',
    `> **${NOT_AN_OPINION}**`,
    '',
    `- 평가대상: ${opt.corpName}`,
    `- Project ID: ${opt.projectId || '—'}`,
    `- 평가 기준일: ${asOf} (KST)`,
    `- 생성: ${kstStamp()}`,
    '',
    ...sections.map(s => [`## ${s.no}. ${s.title}`, '', s.text, ''].join('\n')),
    '---',
    '',
    NOT_AN_OPINION,
  ].join('\n');

  return {
    ok: true,
    sections, markdown,
    conclusion: c,
    valuation: v,
    notChecked: NOT_CHECKED.map(x => x.item),
    disclaimers: [NOT_AN_OPINION],
    asOf,
  };
}

/**
 * 표지에 올릴 값. **계산이 막혔거나 손실이면 올리지 않는다** — 표지 숫자는
 * 그것만 읽힌다 (`deskappraisal.coverValue` 와 같은 규칙).
 */
function coverValue(c) {
  if (!c || c.mode !== 'point') return null;
  return fmtEok(c.valueEok);
}

module.exports = { build, conclusion, coverValue, sectionExistence, NOT_CHECKED, NOT_AN_OPINION };
