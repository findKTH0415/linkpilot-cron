'use strict';
/**
 * 05 Cross Validation Agent
 *
 * ★ 전부 결정적 규칙이다. LLM 미사용. 검증을 LLM에 맡기면 검증 자체를 신뢰할 수 없다.
 *
 * 검사 항목:
 *   ① 값 충돌      — 같은 항목에 서로 다른 값 (예: 연면적 54,822 vs 52,822)
 *   ② 범위 이탈    — Data Dictionary 허용범위 밖 (예: PUE 0.8)
 *   ③ 내부 정합성  — 총사업비 = 구성비 합, 차입+자본 = 총사업비, 용적률, 거치≤만기 등
 *   ④ 미검증 사용  — 독립출처 1개뿐인 값이 IM/재무모델에 쓰임
 *   ⑤ 가정치 비중  — 재무모델 입력 중 문서 미확인 비율
 *   ⑥ 자료 신선도  — 출처 일자가 1년 이상 경과
 *   ⑦ 필수 누락    — IM 필수 항목 결측
 *   ⑧ 시행사 실체  — 사람이 적은 시행사명을 법인 등록정보와 대조 (금융위)
 *   ⑨ 인허가 대조  — 공부상 인허가 이력과 대조 (건축법·주택법 두 트랙)
 *   ⑩ 짝 용량      — 태양광 DC/AC · ESS MWh/MW · ESS 열화 (등록부 D-62)
 *
 * ⑧⑨ 는 외부 조회라 다른 검사와 달리 비동기다. **판정만 하고 값을 Dataset 에
 * 넣지 않는다** — 조회 결과를 사실로 등록하면 출처 계보가 검증 Agent 로 뒤엉킨다.
 *
 * 출력: RED / YELLOW / GREEN / INFO 플래그 + QC Score + PASS/CONDITIONAL/REJECT
 */

const { FIELDS, labelFor, rangeViolation, requiredFor } = require('../core/dictionary');
const fsc = require('../connectors/fsc');
const g2b = require('../connectors/g2b');
const molit = require('../connectors/molit');
const pnuUtil = require('../connectors/pnu');
const solar = require('../core/solar');
const ess = require('../core/ess');
const { round, formatEok, fmt } = require('../core/numeric');
const { kstDate, daysBetween } = require('../core/kst');

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    financial: { type: 'object', nullable: true },
    research: { type: 'object', nullable: true },
    geo: { type: 'object', nullable: true },
    appraisal: { type: 'object', nullable: true },
    massing: { type: 'object', nullable: true },
    sketchup: { type: 'object', nullable: true },
    sketchupPlan: { type: 'object', nullable: true },
    // ★ 18_legal 의 판정 (D-113). 없으면 「못 들었다」로 적는다 — 통과가 아니다
    legal: { type: 'object', nullable: true },
  },
};

const outputSchema = {
  type: 'object',
  required: ['flags', 'score', 'verdict'],
  properties: {
    flags: { type: 'array' },
    score: { type: 'object' },
    verdict: { type: 'string', enum: ['PASS', 'CONDITIONAL PASS', 'REJECT'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const REL_TOL = 0.02; // 합계 정합성 허용오차 2%

function flag(severity, type, message, detail = {}) {
  return { severity, type, message, ...detail };
}

/** a ≈ b ? */
function close(a, b, tol = REL_TOL) {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return true;
  return Math.abs(a - b) / scale <= tol;
}

function checkConsistency(ds) {
  const flags = [];
  const n = k => ds.num(k);

  // ① 총사업비 = 토지비 + 공사비 + 기타
  const total = n('investment.total');
  const parts = ['investment.land', 'investment.construction', 'investment.other'].map(n).filter(v => v !== null);
  if (total !== null && parts.length >= 2) {
    const sum = parts.reduce((a, b) => a + b, 0);
    if (!close(total, sum)) {
      flags.push(flag('RED', 'SUM_MISMATCH',
        `총사업비(${formatEok(total)})와 구성비 합계(${formatEok(sum)})가 ${round(Math.abs(total - sum) / total * 100, 1)}% 차이난다`,
        { keys: ['investment.total', 'investment.land', 'investment.construction', 'investment.other'], expected: round(sum, 2), actual: total }));
    }
  }

  // ② 차입금 + 자기자본 = 총사업비
  const debt = n('debt.amount');
  const equity = n('equity.amount');
  if (total !== null && debt !== null && equity !== null && !close(total, debt + equity)) {
    flags.push(flag('RED', 'FUNDING_MISMATCH',
      `자금조달 합계(차입 ${formatEok(debt)} + 자본 ${formatEok(equity)} = ${formatEok(debt + equity)})가 총사업비 ${formatEok(total)}와 불일치한다`,
      { keys: ['debt.amount', 'equity.amount', 'investment.total'] }));
  }

  // ③ LTC 표기 vs 실제
  const ltc = n('debt.ltc');
  if (ltc !== null && total !== null && debt !== null) {
    const actual = (debt / total) * 100;
    if (!close(ltc, actual, 0.05)) {
      flags.push(flag('YELLOW', 'RATIO_MISMATCH',
        `문서상 LTC ${ltc}% 와 실제 차입비율 ${round(actual, 1)}% 가 다르다`,
        { keys: ['debt.ltc', 'debt.amount', 'investment.total'] }));
    }
  }

  // ④ 운영비율 상식 범위
  const rev = n('revenue.annual');
  const opex = n('opex.annual');
  if (rev !== null && opex !== null) {
    const ratio = (opex / rev) * 100;
    if (ratio >= 90) {
      flags.push(flag('RED', 'MARGIN', `연간 운영비가 매출의 ${round(ratio, 1)}% — 수익구조 재확인 필요`, { keys: ['opex.annual', 'revenue.annual'] }));
    } else if (ratio > 60) {
      flags.push(flag('YELLOW', 'MARGIN', `연간 운영비 비중이 매출의 ${round(ratio, 1)}%로 높다`, { keys: ['opex.annual', 'revenue.annual'] }));
    }
  }

  // ⑤ 용적률 상식 범위
  const land = n('land.area_sqm');
  const gfa = n('building.gfa_sqm');
  if (land !== null && gfa !== null && land > 0) {
    const far = gfa / land;
    if (far < 0.2 || far > 20) {
      flags.push(flag('YELLOW', 'RATIO_OUTLIER',
        `연면적/대지면적 = ${round(far * 100, 0)}% — 용적률이 통상 범위를 벗어난다`,
        { keys: ['building.gfa_sqm', 'land.area_sqm'] }));
    }
  }

  // ⑥ 거치기간 ≤ 대출기간, Exit ≤ 운영기간
  const grace = n('debt.grace_years');
  const tenor = n('debt.tenor_years');
  if (grace !== null && tenor !== null && grace > tenor) {
    flags.push(flag('RED', 'TERM_CONFLICT', `거치기간(${grace}년)이 대출기간(${tenor}년)보다 길다`, { keys: ['debt.grace_years', 'debt.tenor_years'] }));
  }
  const exitY = n('exit.year');
  const ops = n('schedule.ops_years');
  if (exitY !== null && ops !== null && exitY > ops) {
    flags.push(flag('YELLOW', 'TERM_CONFLICT', `Exit 시점(${exitY}년차)이 운영기간(${ops}년)을 초과한다`, { keys: ['exit.year', 'schedule.ops_years'] }));
  }

  // ⑦ IT Load vs 수전용량 (PUE 정합)
  const it = n('capacity.it_load_mw');
  const power = n('capacity.power_mw');
  const pue = n('capacity.pue');
  if (it !== null && power !== null && it > power) {
    flags.push(flag('RED', 'CAPACITY_CONFLICT', `IT Load(${it}MW)가 수전용량(${power}MW)보다 크다`, { keys: ['capacity.it_load_mw', 'capacity.power_mw'] }));
  }
  if (it !== null && power !== null && pue !== null) {
    const implied = power / it;
    if (!close(implied, pue, 0.15)) {
      flags.push(flag('YELLOW', 'CAPACITY_CONFLICT',
        `수전용량/IT Load = ${round(implied, 2)} 인데 문서상 PUE는 ${pue} 다`,
        { keys: ['capacity.pue', 'capacity.power_mw', 'capacity.it_load_mw'] }));
    }
  }

  // ⑧ 발전·저장 자산의 **짝 용량** (등록부 D-62)
  //
  // ★ 위 ⑦(IT Load vs 수전용량)과 **같은 종류의 검사**다. 태양광은 DC/AC 가,
  //   ESS 는 MWh/MW 가 짝이고, **한쪽만 있으면 사업이 특정되지 않는다.**
  //   `core/solar.js` · `core/ess.js` 가 그 판단을 갖고 있는데 **파이프라인에서
  //   한 번도 부르지 않고 있었다** — D-48 과 같은 실패라 여기서 잇는다.
  flags.push(...checkCapacityPairs(ds));

  return flags;
}

/**
 * 태양광 DC/AC · ESS MWh/MW 의 짝 검사.
 *
 * ★ **값을 만들지 않는다.** 과적률·지속시간·열화 곡선은 전부 출처값끼리의
 *   계산이고, 여기서 하는 일은 **그 결과가 매출 가정과 어긋나는지 말하는 것**뿐이다.
 * ★ **「적정/부적정」을 판정하지 않는다** — 과적은 설계 선택이다. 낼 수 있는
 *   말은 「DC 로 곱하면 부풀려진다」·「초기 용량으로 깔면 후반이 부풀려진다」까지다.
 */
function checkCapacityPairs(ds) {
  const flags = [];
  const n = k => ds.num(k);

  // ── 태양광 ──
  const dc = n('capacity.dc_kw');
  const ac = n('capacity.ac_kw');
  if (dc !== null || ac !== null) {
    const r = solar.overloadRatio(dc, ac);
    if (!r.ok) {
      // ★ 짝이 안 맞는 것 자체가 결함이다 — 나머지를 가정으로 메우게 된다
      flags.push(flag('YELLOW', 'CAPACITY_PAIR', r.error, { keys: ['capacity.dc_kw', 'capacity.ac_kw'] }));
    } else if (r.value.clipping) {
      flags.push(flag('YELLOW', 'CAPACITY_PAIR', r.value.text,
        { keys: ['capacity.dc_kw', 'capacity.ac_kw'] }));
    } else {
      flags.push(flag('GREEN', 'CAPACITY_PAIR', r.value.text, { keys: ['capacity.dc_kw', 'capacity.ac_kw'] }));
    }
  }

  // ── ESS ──
  const mwh = n('capacity.ess_mwh');
  const mw = n('capacity.ess_mw');
  if (mwh !== null || mw !== null) {
    const d = ess.duration(mwh, mw);
    if (!d.ok) {
      flags.push(flag('YELLOW', 'CAPACITY_PAIR', d.error, { keys: ['capacity.ess_mwh', 'capacity.ess_mw'] }));
    } else {
      flags.push(flag('GREEN', 'CAPACITY_PAIR', d.value.text, { keys: ['capacity.ess_mwh', 'capacity.ess_mw'] }));
    }

    // ★ **열화가 ESS 고유의 함정이다.** 초기 용량으로 전 기간 매출을 깔면
    //   후반이 통째로 부풀려지는데 **매출표는 매년 같은 숫자라 멀쩡해 보인다**
    const deg = n('capacity.ess_degradation');
    const ops = n('schedule.ops_years');
    if (deg === null) {
      flags.push(flag('YELLOW', 'ESS_DEGRADATION',
        '연간 열화율이 없다 — **0 으로 두면 운영기간 내내 새 배터리가 된다**',
        { keys: ['capacity.ess_degradation'] }));
    } else if (mwh !== null && ops !== null) {
      const c = ess.degradationCurve(mwh, deg, ops);
      if (c.ok) {
        const last = c.value.rows[c.value.rows.length - 1];
        flags.push(flag(last.ratio < 80 ? 'YELLOW' : 'GREEN', 'ESS_DEGRADATION', c.value.text,
          { keys: ['capacity.ess_degradation', 'capacity.ess_mwh', 'schedule.ops_years'] }));
      }
    }
  }

  return flags;
}

function checkLegal(ds, legal) {
  const flags = [];
  const permit = ds.get('legal.permit_status');
  const ownership = ds.get('land.ownership');

  /* ★★ **18_legal 이 든 깃발을 여기서 받는다** 〈2026-08-26 · D-113〉.
   *   용적률·건폐율 한도를 **시행령 값**으로 쓰고 있으면 그것은 확정이 아니다
   *   (CLAUDE.md §4.1 — 실제 한도는 조례가 정한다). 그 사실이 값 검증까지
   *   와야 「확인된 한도로 판정했다」와 「확인 안 된 한도로 판정했다」가 갈린다.
   *
   * ★ 판정이 아예 안 왔으면 **「통과」가 아니라 「못 들었다」**다. 조용히
   *   넘기면 18_legal 이 죽어도 아무도 모른다 (D-48 과 같은 결). */
  if (!legal) {
    flags.push(flag('YELLOW', 'LEGAL', '인허가·법률 판정이 오지 않았다 — 통과가 아니라 못 들은 것이다 (18_legal 이 돌았는지 본다)'));
  } else {
    for (const f of (legal.flags || [])) {
      flags.push(flag(f.severity || 'YELLOW', 'LEGAL', f.message, { from: '18_legal', type: f.type }));
    }
  }

  if (!permit) {
    flags.push(flag('RED', 'LEGAL', '인허가 현황 미확인 — 투자자료에 인허가 상태 없이 배포 불가', { keys: ['legal.permit_status'] }));
  } else if (/미|불가|반려|예정|검토중|협의중/.test(String(permit.value))) {
    flags.push(flag('RED', 'LEGAL', `인허가 미완료 상태: "${permit.value}" (${permit.citation()})`, { keys: ['legal.permit_status'] }));
  } else {
    flags.push(flag('GREEN', 'LEGAL', `인허가 확인: ${permit.value} (${permit.citation()})`, { keys: ['legal.permit_status'] }));
  }

  if (!ownership) {
    flags.push(flag('RED', 'LEGAL', '토지 확보상태 미확인 — 토지사용권 없이 사업성 판단 불가', { keys: ['land.ownership'] }));
  } else if (/미확보|협의|가계약|LOI|예정/i.test(String(ownership.value))) {
    flags.push(flag('YELLOW', 'LEGAL', `토지 미확보 상태: "${ownership.value}" (${ownership.citation()})`, { keys: ['land.ownership'] }));
  } else {
    flags.push(flag('GREEN', 'LEGAL', `토지 확보 확인: ${ownership.value} (${ownership.citation()})`, { keys: ['land.ownership'] }));
  }

  return flags;
}

/**
 * 시행사 실체 확인 — 금융위원회 기업기본정보와 대조한다.
 *
 * ★ `project.sponsor` 는 사람이 손으로 적는 8칸 중 하나다. 오타든 실재하지 않는
 *   이름이든 지금까지는 그대로 IM 에 실렸다. 독립된 출처로 대조한다.
 *
 * ★ **판정만 하고 값을 Dataset 에 넣지는 않는다.** 이 Agent 의 역할은 검증이다.
 *   조회 결과를 사실로 등록하면 출처 계보가 검증 Agent 로 뒤엉킨다.
 *
 * ★ 동명 법인이 있으면 **고르지 않고 YELLOW** 로 올린다. '삼성물산' 은 실제로
 *   법인이 둘이다(1952년·1963년 설립). 하나를 자동으로 집으면 틀렸을 때
 *   문서만 보고는 못 잡는다.
 *
 * ★ 대표자 성명은 Connector 가 아예 가져오지 않는다 (개인정보 — CLAUDE.md §6).
 */
/**
 * ★★★ **공사비를 두 번째 출처와 대 본다** 〈2026-08-25 사장님 지시:
 *   「부르는곳을 만들어 · 공사비 대조해」〉.
 *
 *   `connectors/g2b.js`(조달청 낙찰)를 **아무 Agent 도 안 부르고 있었다.**
 *   스모크에서만 돌았다 — 이 저장소에서 세 번째로 나온 같은 결이다
 *   (D-48 · D-62). 만들어 두고 안 부르면 **없는 것과 같고**, 더 나쁜 것은
 *   「붙였다」고 적혀 있어서 **아무도 없는 줄 모른다**는 점이다.
 *
 * ★★ **총액끼리 견주지 않는다.** 관급 낙찰 중앙값은 몇십억이고 개발사업
 *   공사비는 몇천억이다 — 나누면 수십 배가 나오는데 그건 **규모가 다르다**는
 *   뜻이지 공사비가 틀렸다는 뜻이 아니다. 그걸로 깃발을 세우면 **늘 노란색**이
 *   되고, 늘 노란 검사는 아무도 안 본다.
 *
 * ★★★ 대신 **낙찰률**을 낸다. 낙찰금액 ÷ 기초금액은 **규모와 무관하고**
 *   가정계수가 하나도 안 들어간다 (§4.8). 「예정가 대비 실제로 얼마에
 *   떨어지는가」가 공사비 가정의 현실성을 재는 가장 곧은 잣대다.
 *
 * ★ **판정하지 않는다.** GREEN(정보)으로만 낸다 — 관급과 민간은 발주 조건·
 *   설계 수준이 달라 어떤 문턱을 잡아도 자의적이다. 숫자와 모수를 적어 두고
 *   **사람이 본다.**
 * ★ **Dataset 에 넣지 않는다** (D-48 과 같은 이유). 업종 평균이 이 딜의 값으로
 *   실리면 안 된다.
 * ★ **건너뛰면 건너뛴 사실을 남긴다.** 조용히 빠지면 「대조했는데 문제
 *   없었다」로 읽힌다 — D-48 이 그 이야기다.
 */

/** 시·도 17개. 행정구역 이름이라 짐작이 아니다 */
const SIDO = [
  ['서울', /서울/], ['부산', /부산/], ['대구', /대구/], ['인천', /인천/],
  ['광주', /광주(광역시|시)?/], ['대전', /대전/], ['울산', /울산/], ['세종', /세종/],
  ['경기', /경기/], ['강원', /강원/], ['충북', /충청북도|충북/], ['충남', /충청남도|충남/],
  ['전북', /전(라)?북(도)?/], ['전남', /전(라)?남(도)?/],
  ['경북', /경상북도|경북/], ['경남', /경상남도|경남/], ['제주', /제주/],
];

function sidoOf(address) {
  const a = String(address || '');
  for (const [name, re] of SIDO) if (re.test(a)) return name;
  return null;
}

async function checkConstructionCost(ds, ctx) {
  const flags = [];
  const cost = ds.get('investment.construction');
  if (!cost) return flags;                       // 공사비가 없으면 대 볼 것이 없다

  const warn = (m) => { if (ctx && typeof ctx.warn === 'function') ctx.warn(m); };

  if (!g2b.isAvailable()) {
    warn('공사비 대조 생략 — DATA_GO_KR_KEY 미설정 (조달청 낙찰가를 못 받는다)');
    return flags;
  }

  const loc = ds.get('project.location');
  const region = loc ? sidoOf(loc.value) : null;
  if (!region) {
    /* ★ **전국 값으로 대체하지 않는다** (§4.9). 대체하면 문서에는 「대조함」만
     *   남고 무엇이 빠졌는지 사라진다 */
    warn(`공사비 대조 생략 — 소재지에서 시·도를 특정하지 못했다${loc ? `: ${loc.value}` : ' (소재지 없음)'}. 전국 값으로 대체하지 않는다`);
    return flags;
  }

  let r;
  try {
    r = await g2b.benchmark({ region, months: 12, minEok: 10 });
  } catch (e) {
    warn(`공사비 대조 실패: ${e.message}`);
    return flags;
  }
  if (!r.ok) {
    if (!r.unavailable) warn(`공사비 대조 실패 (${region}): ${r.error}`);
    return flags;
  }

  const parts = [
    `${region} 지역 관급 공사 낙찰 ${r.count}건 (${r.period})`,
    `낙찰금액 중앙값 ${fmt(r.medianAwardEok, 1)}억원`,
  ];
  if (r.medianRate !== null) {
    parts.push(`**낙찰률 중앙값 ${r.medianRate}%** (${r.rateCount}건 기준)`);
  } else if (r.rateReason) {
    parts.push(`낙찰률은 내지 않았다 — ${r.rateReason}`);
  }

  flags.push(flag('GREEN', 'CONSTRUCTION_BENCHMARK',
    `공사비 대조(참고): 사업계획서 ${fmt(cost.value, 1)}억원 · ${parts.join(' · ')}. `
    + '관급 낙찰 실적이라 민간 공사비와 발주 조건·설계 수준이 다르다 — '
    + '총액을 그대로 견주지 않고 낙찰 수준만 참고한다',
    { keys: ['investment.construction'], benchmark: r.source }));

  return flags;
}

async function checkSponsor(ds, ctx, today) {
  const flags = [];
  const sponsor = ds.get('project.sponsor');
  if (!sponsor || !fsc.isAvailable()) return flags;

  const r = await fsc.corpOutline(String(sponsor.value));

  if (!r.ok) {
    if (r.unavailable) return flags;
    flags.push(flag('YELLOW', 'SPONSOR',
      `시행사 '${sponsor.value}' 를 법인 등록정보에서 확인하지 못했다 — ${r.error}`,
      { keys: ['project.sponsor'] }));
    return flags;
  }

  if (r.ambiguous) {
    const list = r.candidates.slice(0, 3)
      .map(c => `${c.name}(${c.corpRegNo}, ${String(c.establishedOn).slice(0, 4)}년 설립)`).join(' / ');
    flags.push(flag('YELLOW', 'SPONSOR',
      `시행사 '${sponsor.value}' 와 같은 이름의 법인이 여럿이다 — 어느 곳인지 특정해야 한다: ${list}`,
      { keys: ['project.sponsor'] }));
    return flags;
  }

  const c = r.value;
  const years = fsc.yearsSince(c.establishedOn, today);
  const parts = [
    c.name,
    `법인등록번호 ${c.corpRegNo}`,
    years !== null ? `업력 ${years}년` : null,
    c.market ? `${c.market} 상장` : '비상장',
    c.auditOpinion ? `감사의견 ${c.auditOpinion}` : null,
  ].filter(Boolean);

  // 감사의견이 적정이 아니면 그 자체가 투자 검토 대상이다
  const badOpinion = c.auditOpinion && !/적정/.test(c.auditOpinion);
  flags.push(flag(badOpinion ? 'YELLOW' : 'GREEN', 'SPONSOR',
    `시행사 확인: ${parts.join(' · ')}`
    + (badOpinion ? ' — 감사의견이 적정이 아니다' : ''),
    { keys: ['project.sponsor'] }));

  return flags;
}

/**
 * 인허가 현황 대조 — 건축HUB 인허가 이력과 사람이 적은 값을 맞춰 본다.
 *
 * ★ **자동으로 채우지 않는다.** 한 필지에 인허가가 여러 건 쌓인다(표본 11건).
 *   과거 건물 이력이 섞이므로 "최신 건 = 이 딜의 인허가" 라고 단정할 수 없다.
 *   개발 예정지라면 아직 인허가가 없는 것이 정상이고, 그때 공부에는 옛 건물의
 *   허가만 남아 있다. 그걸 집어 채우면 없는 인허가를 있다고 적는 셈이다.
 *
 * ★ 대신 **근거를 옆에 놓는다.** 사람이 판단할 수 있게 공부상 이력을 보여 주고,
 *   적힌 값과 어긋나는 경우에만 경고한다.
 */
async function checkPermitRecord(ds, ctx) {
  const flags = [];
  const pnu = ds.get('geo.pnu');
  if (!pnu || !molit.isAvailable()) return flags;

  const parsed = pnuUtil.parse(pnu.value);
  if (!parsed) return flags;

  // ★ **두 트랙을 다 본다.** 30세대 이상 공동주택은 건축허가가 아니라 주택법
  //   사업계획승인을 받으므로 건축인허가에는 나오지 않는다. 한쪽만 보면 주택
  //   개발 딜에서 "인허가 기록 없음" 으로 오판한다.
  const [arch, house] = await Promise.all([
    molit.buildingPermits(parsed),
    molit.housingPermits(parsed),
  ]);
  if (!arch.ok && !house.ok) return flags;   // 이력이 없는 필지는 정상이다

  const parts = [];
  if (arch.ok) {
    const a = arch.latest;
    parts.push(`건축법 ${a.stage} ${a.date}` + (a.archType ? `(${a.archType})` : '') + ` · ${arch.count}건`);
  }
  if (house.ok) {
    const h = house.latest;
    parts.push(`주택법 ${h.stage} ${h.date}`
      + (h.households ? `(${h.households}세대)` : '') + ` · ${house.count}건`);
  }

  const claimed = ds.get('legal.permit_status');
  const record = `공부상 인허가 — ${parts.join(' / ')}`;

  if (!claimed) {
    // checkLegal 이 이미 RED 를 올렸다. 여기서는 채울 근거만 옆에 놓는다.
    flags.push(flag('INFO', 'PERMIT_RECORD',
      `인허가 현황이 비어 있다 — ${record}. 이 딜의 인허가인지 확인해 입력해야 한다`,
      { keys: ['legal.permit_status'] }));
    return flags;
  }

  // 사람이 '준공' 이라 적었는데 공부에 그 기록이 없으면 어긋난다.
  // 건축법은 사용승인, 주택법은 사용검사다 — 둘 중 하나라도 있으면 준공이다.
  const saysDone = /준공|사용승인|사용검사|완료/.test(String(claimed.value));
  const hasApproval = (arch.ok && arch.value.some(p => p.useAprDay))
    || (house.ok && house.value.some(p => p.useInsptDay));

  if (saysDone && !hasApproval) {
    flags.push(flag('YELLOW', 'PERMIT_RECORD',
      `인허가를 "${claimed.value}" 로 적었으나 공부에 사용승인 기록이 없다 — ${record}`,
      { keys: ['legal.permit_status'] }));
  } else {
    flags.push(flag('INFO', 'PERMIT_RECORD', record, { keys: ['legal.permit_status'] }));
  }
  return flags;
}

async function run(input, ctx) {
  const ds = ctx.dataset;
  if (!ds) throw new Error('ctx.dataset 필요');

  const flags = [];

  // ① 값 충돌 (Dataset이 resolve 시점에 이미 수집)
  for (const c of ds.conflicts) {
    const label = labelFor(c.key);
    if (c.type === 'VALUE_CONFLICT') {
      const detail = c.values.map(v => `${v.value}${v.unit || ''} (${v.sources.join('; ')})`).join(' vs ');
      // 숫자 충돌 = RED(치명적), 문자열 표기 차이 = YELLOW(검토 대상)
      flags.push(flag(c.severity || 'RED', 'VALUE_CONFLICT',
        `${label}: 서로 다른 값이 존재한다 — ${detail}`, { keys: [c.key], values: c.values }));
    } else {
      flags.push(flag('RED', c.type, `${label}: ${c.message}`, { keys: [c.key] }));
    }
  }

  // ② 범위 이탈
  for (const key of ds.keys()) {
    const f = ds.get(key);
    const v = rangeViolation(key, f.value);
    if (v) flags.push(flag('RED', 'RANGE', `${v} (${f.citation()})`, { keys: [key] }));
  }

  // ③ 내부 정합성 + 법률
  flags.push(...checkConsistency(ds));
  flags.push(...checkLegal(ds, input.legal || null));
  flags.push(...await checkSponsor(ds, ctx, kstDate()));
  flags.push(...await checkConstructionCost(ds, ctx));
  flags.push(...await checkPermitRecord(ds, ctx));

  // ④ 미검증 값 (독립출처 1개)
  const single = ds.keys().filter(k => {
    const f = ds.get(k);
    return !f.verified && f.source !== 'financial_model (04_financial)' && (f.corroboration || 1) < 2;
  });
  if (single.length) {
    flags.push(flag('YELLOW', 'SINGLE_SOURCE',
      `단일 출처로만 확인된 항목 ${single.length}건 — 교차확인 전까지 '미검증'으로 표기된다`,
      { keys: single.slice(0, 15) }));
  }

  // ⑤ 재무모델 가정치 비중
  const fin = input.financial;
  if (fin) {
    const assumedCount = (fin.assumed || []).length;
    const sourcedCount = (fin.sourcedFields || []).length;
    const totalIn = assumedCount + sourcedCount;
    const ratio = totalIn ? assumedCount / totalIn : 1;
    if (ratio >= 0.5) {
      flags.push(flag('RED', 'ASSUMPTION_HEAVY',
        `재무모델 입력의 ${Math.round(ratio * 100)}%(${assumedCount}/${totalIn})가 문서 미확인 가정치다`,
        { keys: (fin.assumed || []).map(a => a.dictKey).filter(Boolean).slice(0, 15) }));
    } else if (assumedCount) {
      flags.push(flag('YELLOW', 'ASSUMPTION',
        `가정치 ${assumedCount}건이 재무모델에 사용됐다 — IM 가정표에 명시된다`,
        { keys: (fin.assumed || []).map(a => a.dictKey).filter(Boolean).slice(0, 15) }));
    }

    const base = fin.scenarios && fin.scenarios.base && fin.scenarios.base.metrics;
    if (base) {
      // 모델 총사업비 vs 문서 총사업비 (건설이자·수수료 자본화로 벌어질 수 있다)
      const docTotal = ds.num('investment.total');
      if (docTotal !== null && !close(docTotal, base.totalProjectCost, 0.03)) {
        flags.push(flag('YELLOW', 'TPC_GAP',
          `모델 총사업비 ${formatEok(base.totalProjectCost)} ≠ 문서 총사업비 ${formatEok(docTotal)} — 건설이자 ${formatEok(base.idc)} · 수수료 ${formatEok(base.arrangementFee)} 자본화 차이. 문서 수치에 이미 포함되어 있다면 중복 계상이다`,
          { keys: ['investment.total'] }));
      }
      if (base.minDSCR !== null && base.minDSCR < 1.0) {
        flags.push(flag('RED', 'DSCR', `Base 시나리오 최소 DSCR ${base.minDSCR} < 1.0 — 원리금 상환 불가 구간이 존재한다`));
      } else if (base.minDSCR !== null && base.minDSCR < 1.2) {
        flags.push(flag('YELLOW', 'DSCR', `Base 최소 DSCR ${base.minDSCR} — 통상 금융조건(1.2x) 미달`));
      } else if (base.minDSCR !== null) {
        flags.push(flag('GREEN', 'DSCR', `Base 최소 DSCR ${base.minDSCR}`));
      }
      // Exit Value 가 총사업비의 2배를 넘으면 Cap Rate 가정이 과도할 가능성이 크다
      if (base.exitValue && base.totalProjectCost && base.exitValue / base.totalProjectCost > 2) {
        flags.push(flag('YELLOW', 'EXIT_OUTLIER',
          `Exit Value ${formatEok(base.exitValue)} 가 총사업비 ${formatEok(base.totalProjectCost)} 의 ${round(base.exitValue / base.totalProjectCost, 1)}배 — Exit Cap Rate ${fin.scenarios.base.assumptions.exitCapRate}% 가정의 근거 확인 필요`,
          { keys: ['exit.cap_rate'] }));
      }

      const down = fin.scenarios.downside && fin.scenarios.downside.metrics;
      if (down && down.equityIRR !== null && down.equityIRR < 0) {
        flags.push(flag('YELLOW', 'DOWNSIDE', `Downside 시나리오 Equity IRR ${down.equityIRR}% — 원금 손실 구간`));
      }
    }
  }

  // ⑥ 자료 신선도
  const today = kstDate();
  for (const key of ds.keys()) {
    const f = ds.get(key);
    if (!f.sourceDate) continue;
    const age = daysBetween(f.sourceDate, today);
    if (age > 365) {
      flags.push(flag('YELLOW', 'STALE', `${labelFor(key)}: 출처 자료가 ${Math.floor(age / 365)}년 경과 (${f.citation()})`, { keys: [key] }));
    }
  }

  // ⑦ IM 필수 항목 누락
  const missingIm = ds.missing(requiredFor('im'));
  if (missingIm.length) {
    flags.push(flag('YELLOW', 'MISSING', `IM 필수 항목 ${missingIm.length}건 미확인: ${missingIm.map(k => FIELDS[k].label).join(', ')}`, { keys: missingIm }));
  }

  // ⑧ 입지 / 감정평가 / 매스 검토 Agent가 올린 플래그 병합
  //    (판정은 각 Agent가 하고, 승인 게이트에 노출하는 책임은 여기에 모은다)
  for (const [agent, out] of [['07_geo', input.geo], ['08_appraisal', input.appraisal], ['09_massing', input.massing], ['12_sketchup_plan', input.sketchupPlan], ['13_sketchup_intake', input.sketchup]]) {
    for (const f of (out && out.flags) || []) {
      flags.push({ ...f, agent });
    }
  }
  // 법적 고지는 점수를 깎는 결함이 아니라 항상 따라다녀야 하는 안내다 → INFO
  // (RED/YELLOW 집계와 승인 게이트에 영향을 주지 않으면서 IM 위험표에는 노출된다)
  if (input.appraisal && input.appraisal.concluded) {
    flags.push(flag('INFO', 'APPRAISAL_DISCLAIMER', input.appraisal.disclaimer, { keys: ['appraisal.land_value_concluded'] }));
  }

  // ⑨ 시장조사 근거
  const research = input.research;
  if (research && !research.offline) {
    const noSrc = (research.sections || []).filter(s => !s.sources.length).length;
    if (noSrc) flags.push(flag('YELLOW', 'MARKET_EVIDENCE', `시장분석 ${noSrc}개 항목에 인용 출처가 없다`));
  } else if (research && research.offline) {
    flags.push(flag('YELLOW', 'MARKET_EVIDENCE', '시장조사 미실행 (LLM 오프라인)'));
  }

  // ── QC Score ──
  const red = flags.filter(f => f.severity === 'RED').length;
  const yellow = flags.filter(f => f.severity === 'YELLOW').length;

  const dataAccuracy = clamp(100 - red * 20 - yellow * 4);
  const financialAccuracy = clamp(100 - (fin ? Math.round((1 - (fin.confidence ?? 0)) * 60) : 60)
    - flags.filter(f => ['DSCR', 'SUM_MISMATCH', 'FUNDING_MISMATCH', 'ASSUMPTION_HEAVY'].includes(f.type) && f.severity === 'RED').length * 15);
  const legalCompleteness = clamp(100 - flags.filter(f => f.type === 'LEGAL' && f.severity === 'RED').length * 35
    - flags.filter(f => f.type === 'LEGAL' && f.severity === 'YELLOW').length * 12);
  const marketEvidence = clamp(research ? Math.round((research.confidence ?? 0) * 100) : 0);
  const consistency = clamp(100 - flags.filter(f => ['VALUE_CONFLICT', 'RATIO_MISMATCH', 'CAPACITY_CONFLICT', 'TERM_CONFLICT'].includes(f.type)).length * 18);
  const sourceCoverage = clamp(Math.round((ds.keys().filter(k => ds.get(k).verified).length / Math.max(1, ds.keys().length)) * 100));

  const score = {
    dataAccuracy, financialAccuracy, legalCompleteness,
    marketEvidence, consistency, sourceCoverage,
    total: Math.round((dataAccuracy + financialAccuracy + legalCompleteness + marketEvidence + consistency + sourceCoverage) / 6),
  };

  const verdict = red > 0 ? 'REJECT' : (yellow > 3 || score.total < 80 ? 'CONDITIONAL PASS' : 'PASS');

  if (red) ctx.warn(`RED FLAG ${red}건 — 승인 게이트가 차단된다`);

  return {
    flags, score, verdict,
    summary: { red, yellow, green: flags.filter(f => f.severity === 'GREEN').length },
    confidence: round(score.total / 100, 3),
  };
}

function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

module.exports = { id: '05_validation', label: 'Cross Validation Agent', inputSchema, outputSchema, run, checkConsistency, checkCapacityPairs, checkLegal, checkSponsor, checkPermitRecord, checkConstructionCost, sidoOf };
