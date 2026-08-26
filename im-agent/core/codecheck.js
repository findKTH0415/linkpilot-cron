'use strict';
/**
 * codecheck.js — **법규 검토**를 코드로 옮긴 것.
 *
 * 〈2026-08-25 사장님 지시: 「③ 법규 검토가 해줘」 → 판정을 손으로 한 번 하고 나니
 *  그 판정이 **내 손에만** 있었다. 딜이 바뀌면 처음부터 다시 해야 하고, 다시 할 때
 *  같은 결과가 나온다는 보장이 없다. 그래서 규칙을 코드로 내린다.〉
 *
 * ★★★ **이 파일은 값을 지어내지 않는다.** 하는 일은 셋뿐이다.
 *   ① 건축 개요를 받아 **어느 조문이 걸리는지** 고른다
 *   ② 그 조문의 기준과 딜의 수치를 **비교해 판정**한다
 *   ③ 판정마다 **조문 참조**를 붙인다 (LAW_OC 가 있으면 원문까지)
 *
 * ★★ **판정과 근거는 다른 것이다.** 여기 박힌 기준값(예: 방화구획 1,500㎡)은
 *   **사람이 읽고 옮겨 적은 것**이라 그 자체로는 출처가 아니다. 그래서 항목마다
 *   `ref` (법령명 + 조 + 항)를 함께 두고, `attachSources()` 가 LAW_OC 로
 *   **원문을 붙여 준다.** 원문이 붙기 전 판정은 `sourced:false` 로 나간다 —
 *   문서에는 그 사실이 그대로 실린다 (§4.7).
 *
 * ★ **조례 한도는 여기 없다.** 용적률·건폐율의 실제 한도는 조례가 정하고,
 *   조례는 지자체마다 다르다. 시행령 상한을 조례 한도로 쓰면 그 문서는 틀린다.
 *   그래서 용적률 항목은 `verdict:'ordinance'` — 「조례 확인」으로만 나간다 (§4.9).
 *
 * ★ 판정은 넷이다: `ok`(적합) · `fail`(부적합) · `review`(보완) · `na`(적용 제외) ·
 *   `ordinance`(조례 확인). 모르는 것은 `unknown` 이고, **적합으로 세지 않는다** —
 *   「확인되지 않음」을 통과로 세는 것이 이 저장소가 가장 경계하는 실수다.
 */

/** 고층 구분 — 건축법 시행령 제2조 */
const HIGHRISE = { floors: 30, height: 120 };
const SUPER = { floors: 50, height: 200 };

/** 판정 한 건 */
function item(id, label, ref, standard, actual, verdict, note) {
  return { id, label, ref, standard, actual, verdict, note: note || null, sourced: false, text: null };
}

/**
 * 건축 개요로 법규를 판정한다.
 *
 * @param {object} b 건축 개요
 * @param {number} b.floors        지상 층수
 * @param {number} b.heightM       최고높이 (m, 옥탑 포함)
 * @param {string} b.zone          용도지역 (예: '일반상업지역')
 * @param {number} b.typicalFloorSqm 기준층 바닥면적 (㎡)
 * @param {number} [b.residentialFloors] 주거 층수 (승강기 산정용)
 * @param {number} [b.netPerFloorSqm]    층당 전용 합 (㎡)
 * @param {number} [b.elevators]         계획 승용승강기 대수 (동당)
 * @param {number} [b.stairs]            직통계단 개소 (동당)
 * @param {boolean} [b.sprinkler]        스프링클러 설치 전제
 * @param {boolean} [b.nonCombustible]   내장 불연재료 전제
 * @param {boolean} [b.refugeArea]       피난안전구역 반영 여부
 * @param {number} [b.buildingSeparationM] 인동거리 (m)
 */
function review(b = {}) {
  const out = [];
  const f = Number(b.floors) || 0;
  const h = Number(b.heightM) || 0;
  const zone = String(b.zone || '');
  const gfaFloor = Number(b.typicalFloorSqm) || 0;

  // ── 고층 구분 ──────────────────────────────────────────
  const isSuper = f >= SUPER.floors || h >= SUPER.height;
  const isHigh = f >= HIGHRISE.floors || h >= HIGHRISE.height;
  const grade = isSuper ? '초고층' : (isHigh ? '준초고층' : '일반');
  out.push(item('grade', '고층 구분', { law: '건축법 시행령', jo: 2 },
    `${HIGHRISE.floors}층↑ 또는 ${HIGHRISE.height}m↑ = 고층 / ${SUPER.floors}층↑ ${SUPER.height}m↑ = 초고층`,
    `${f}층 · ${h.toFixed(2)}m`, 'na', `판정: ${grade}`));

  // ── 피난안전구역 (준초고층) ─────────────────────────────
  if (isHigh && !isSuper) {
    // 전체 층수의 1/2 층으로부터 상하 5개층 이내 1개소 이상
    const mid = Math.round(f / 2);
    out.push(item('refuge', '피난안전구역', { law: '건축법 시행령', jo: 34, hang: 4 },
      '전체 층수 1/2 층에서 상하 5개층 이내 1개소 이상',
      b.refugeArea ? '반영됨' : '미반영',
      b.refugeArea ? 'ok' : 'fail',
      `${Math.max(1, mid - 5)}~${mid + 5}F 구간 · 단서(국토부령 기준 직통계단) 적용 시 면제`));
  } else if (isSuper) {
    out.push(item('refuge', '피난안전구역', { law: '건축법 시행령', jo: 34, hang: 3 },
      '지상층으로부터 최대 30개 층마다 1개소 이상',
      b.refugeArea ? '반영됨' : '미반영', b.refugeArea ? 'ok' : 'fail', '초고층 기준'));
  }

  // ── 직통계단 ───────────────────────────────────────────
  const stairs = Number(b.stairs) || 0;
  out.push(item('stairs', '직통계단', { law: '건축법 시행령', jo: 34, hang: 2 },
    '2개소 이상', `${stairs}개소`,
    stairs >= 2 ? 'ok' : (stairs ? 'fail' : 'unknown')));

  // ── 특별피난계단 ───────────────────────────────────────
  if (f >= 16 && gfaFloor >= 400) {
    out.push(item('specialStair', '특별피난계단', { law: '건축법 시행령', jo: 35 },
      '공동주택 16층 이상 층(바닥면적 400㎡ 이상)의 직통계단',
      `기준층 ${gfaFloor.toLocaleString()}㎡`, 'review',
      '부속실(급기가압 제연) 면적이 코어에 더해진다'));
  }

  // ── 방화구획 ───────────────────────────────────────────
  if (f >= 11) {
    // 11층 이상: 200 / SP 600 / 불연 500 / 불연+SP 1,500
    const limit = b.nonCombustible
      ? (b.sprinkler ? 1500 : 500)
      : (b.sprinkler ? 600 : 200);
    out.push(item('fireCompart', '방화구획', { law: '건축법 시행령', jo: 46 },
      `11층↑ ${limit.toLocaleString()}㎡ 이내마다 (${b.nonCombustible ? '불연' : '일반'}${b.sprinkler ? '+SP' : ''})`,
      `기준층 ${gfaFloor.toLocaleString()}㎡`,
      gfaFloor ? (gfaFloor <= limit ? 'ok' : 'fail') : 'unknown'));
  }

  // ── 비상용승강기 ───────────────────────────────────────
  if (h > 31) {
    // 31m 초과 층의 최대 바닥면적 1,500㎡ 이하 1대, 초과분 3,000㎡마다 1대 가산
    const need = gfaFloor <= 1500 ? 1 : 1 + Math.ceil((gfaFloor - 1500) / 3000);
    out.push(item('emergencyLift', '비상용승강기', { law: '건축법 시행령', jo: 90 },
      '31m 초과 · 최대 바닥면적 1,500㎡ 이하 1대 (초과 3,000㎡마다 가산)',
      `31m↑ 최대 ${gfaFloor.toLocaleString()}㎡ → ${need}대`, 'ok',
      '승용승강기와 겸용 가능 — 그 경우 대수에 포함해 센다'));
  }

  // ── 승용승강기 ─────────────────────────────────────────
  const resFloors = Number(b.residentialFloors) || 0;
  const netFloor = Number(b.netPerFloorSqm) || 0;
  if (resFloors && netFloor) {
    // 공동주택: 6층 이상 거실면적 합계 3,000㎡ 이하 1대 + 3,000㎡마다 1대
    const habitable = resFloors * netFloor;
    const need = habitable <= 3000 ? 1 : 1 + Math.ceil((habitable - 3000) / 3000);
    const have = Number(b.elevators) || 0;
    out.push(item('passengerLift', '승용승강기', { law: '건축물의 설비기준 등에 관한 규칙', byeol: '별표 1의2' },
      '공동주택 6층↑ 거실 3,000㎡ 이하 1대 + 초과 3,000㎡마다 1대',
      `6층↑ 거실 약 ${Math.round(habitable).toLocaleString()}㎡ → ${need}대 필요 · 계획 ${have || '?'}대`,
      have ? (have >= need ? 'ok' : 'fail') : 'unknown',
      have && have < need ? `${need - have}대 부족 — 코어가 커지고 전용률이 내려간다` : null));
  }

  // ── 정북 일조 ──────────────────────────────────────────
  const northApplies = /전용주거|일반주거/.test(zone);
  out.push(item('northLight', '정북 일조', { law: '건축법 시행령', jo: 86, hang: 1 },
    '전용주거지역·일반주거지역에만 적용',
    zone || '(용도지역 미상)',
    zone ? (northApplies ? 'review' : 'na') : 'unknown',
    northApplies ? '높이 10m 초과분은 인접 대지경계선에서 높이의 1/2 이상' : null));

  // ── 채광·인동거리 ──────────────────────────────────────
  // ★ 건축법 §61② — 일반상업지역·중심상업지역에 건축하는 공동주택은 **제외**
  const sepExempt = /일반상업|중심상업/.test(zone);
  const sep = Number(b.buildingSeparationM) || 0;
  if (sepExempt) {
    out.push(item('separation', '채광·인동거리', { law: '건축법', jo: 61, hang: 2 },
      '공동주택 (일반상업·중심상업지역 제외) · 마주보는 동 높이의 0.5배 이상',
      `${zone} → 적용 제외 · 인동 ${sep ? sep.toLocaleString() + 'm' : '미상'}`, 'na',
      `★ 용도지역이 바뀌면 즉시 부적합 — 주거지역이면 0.5 × ${h.toFixed(0)}m = ${(h * 0.5).toFixed(0)}m 필요`));
  } else if (sep && h) {
    const need = h * 0.5;
    out.push(item('separation', '채광·인동거리', { law: '건축법', jo: 61, hang: 2 },
      '마주보는 동 높이의 0.5배 이상 (조례가 정하는 거리)',
      `인동 ${sep}m · 필요 ${need.toFixed(0)}m`,
      sep >= need ? 'ok' : 'fail'));
  }

  // ── 용적률 한도 ────────────────────────────────────────
  // ★ 상한은 시행령, **한도는 조례**다. 여기서 판정하지 않는다.
  out.push(item('far', '용적률 한도', { law: '국토의 계획 및 이용에 관한 법률 시행령', jo: 85 },
    '용도지역별 상한 범위에서 **조례**가 정한다',
    b.farPct ? `${b.farPct}%` : '(미상)', 'ordinance',
    '조례를 확인하기 전에는 적합으로 세지 않는다 (law.ordinance() 로 찾는다)'));

  return { grade, items: out, summary: summarize(out) };
}

/** 판정 집계 — **unknown 을 적합으로 세지 않는다** */
function summarize(items) {
  const c = { ok: 0, fail: 0, review: 0, na: 0, ordinance: 0, unknown: 0 };
  items.forEach(i => { c[i.verdict] = (c[i.verdict] || 0) + 1; });
  return {
    ...c,
    blocking: items.filter(i => i.verdict === 'fail').map(i => i.label),
    // ★ 「검토 끝」은 fail·unknown 이 0 일 때만이다. review·ordinance 는 남은 일이다
    clear: c.fail === 0 && c.unknown === 0,
  };
}

/**
 * 판정에 **조문 원문**을 붙인다. LAW_OC 가 없으면 조문 번호만 남는다.
 *
 * ★ 원문이 붙은 것만 `sourced:true` 다. 붙지 않은 판정도 그대로 내보내되
 *   **출처 없음이 문서에 보이게** 한다 — 조용히 근거 있는 척하지 않는다.
 *
 * @param {object} r review() 결과
 * @param {object} [deps] { law } — 시험에서 갈아끼운다
 */
async function attachSources(r, deps = {}) {
  const law = deps.law || require('../connectors/law');
  if (!law.isAvailable()) return { ...r, sourcesAttached: false, reason: 'LAW_OC 미설정' };

  const cacheByLaw = new Map();
  for (const it of r.items) {
    if (!it.ref || !it.ref.jo) continue;                    // 별표는 조문 조회로 못 온다
    let mst = cacheByLaw.get(it.ref.law);
    if (mst === undefined) {
      const found = await law.findLaw(it.ref.law);
      mst = found.ok && found.value[0] ? found.value[0].mst : null;
      cacheByLaw.set(it.ref.law, mst);
    }
    if (!mst) continue;
    const a = await law.article({ mst, jo: it.ref.jo, hang: it.ref.hang || 0 });
    if (a.ok) { it.sourced = true; it.text = a.value.text; it.enforcedAt = a.value.enforcedAt; }
  }
  return { ...r, sourcesAttached: true };
}

module.exports = { review, attachSources, summarize, HIGHRISE, SUPER };
