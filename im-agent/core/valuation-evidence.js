'use strict';
/**
 * valuation-evidence.js — 가치평가 **근거 대장** 〈2026-09-26 · 부동산 가치평가 지침 v1.0 §2 · D-333〉.
 *
 * 지침 §2 는 가격보다 **먼저** 세 가지를 요구한다 —
 *   ① 한 평가에 asset_id · 필지(PNU) · 주소 · 평가 목적 · 기준시점 · 자료조회일을 고정하고
 *   ② 권리 위험(유치권·법정지상권·선순위·가처분·체납·분묘·오염·무단점유)을 «해당/미해당»으로
 *      문서 확인하며, 못 했으면 `UNVERIFIED` 로 남기고
 *   ③ 수치마다 값·단위·범위·출처·기준일·조회일·수집방식·책임자·상태·갱신필요일을 적는다.
 *
 * ★ 이 대장은 **새 값을 만들지 않는다.** 데이터셋과 08 Appraisal 산출에서 이미 있는 것을
 *   «어떤 상태인지» 한 줄씩 옮겨 적을 뿐이다. 없는 칸은 빈칸(null)이다 — 지어내지 않는다.
 *
 * ★★ **조회 실패를 «없음»으로 읽지 않는다** (지침 §2-3). 데이터셋에 없는 값은 `UNVERIFIED` 이고,
 *    그 줄에 「값 없음 — 조회 실패·미제출을 «해당 없음»으로 읽지 않는다」를 적는다.
 *
 * ★★ **상태 넷을 가르는 잣대** (지침의 VERIFIED/PARTIAL/UNVERIFIED/CONFLICTED):
 *    - CONFLICTED  데이터셋이 그 항목에 «서로 다른 값»을 가졌다 (facts.js 의 VALUE_CONFLICT)
 *    - VERIFIED    그 값이 verified 로 확정됐다 (공공 원자료이거나 독립 출처 둘이 일치)
 *    - PARTIAL     계산값 — 입력이 확인돼도 가정(현실화계수·가중치·Cap Rate)이 섞였다
 *    - UNVERIFIED  그 밖 전부 · 값이 없는 것 · 문서로 확인 안 한 권리 항목
 *   ★ 계산값을 VERIFIED 로 적지 않는다 — 평균은 확인된 사실이 아니라 계산된 참고값이다 (§4.5).
 *
 * ★ LLM 을 쓰지 않는다. 전부 기계적으로 옮긴다 (deskappraisal.js 와 같은 원칙).
 */

const { kstDate } = require('./kst');

/** 대장에 올리는 입력 항목 — 08 Appraisal 이 읽는 것만. 늘리면 대장도 늘어난다 */
const INPUT_KEYS = [
  { key: 'project.location', label: '소재지', scope: '대상 토지 전체' },
  { key: 'geo.pnu', label: '필지고유번호(PNU)', scope: '대표 필지 1개' },
  { key: 'land.area_sqm', label: '대지면적', scope: '대상 토지 전체' },
  { key: 'land.ownership', label: '소유·확보 상태', scope: '대상 토지 전체' },
  { key: 'land.zoning', label: '용도지역', scope: '대표 필지' },
  { key: 'land.official_price', label: '개별공시지가', scope: '대표 필지' },
  { key: 'land.price_change_rate', label: '지가변동률(시점수정)', scope: '시군구' },
  { key: 'exit.cap_rate', label: 'Cap Rate', scope: '사업계획 가정' },
  { key: 'investment.construction', label: '공사비(건물가치 대용)', scope: '사업계획' },
  { key: 'investment.land', label: '사업계획상 토지비', scope: '사업계획' },
];

/**
 * 권리·점유 위험 — 지침 §2-2 가 «해당/미해당을 문서로 확인»하라는 여덟.
 * 이 엔진에는 등기부·신탁원부·현장 자료를 읽는 길이 없다 → **전부 UNVERIFIED 로 시작한다.**
 * ★ 목록을 줄이지 않는다 — 빠지면 읽는 사람이 «확인한 것»으로 읽는다 (deskappraisal 의 NOT_CHECKED 와 같은 결).
 */
const RIGHTS = [
  { item: '유치권 주장', doc: '현장·공사대금 자료' },
  { item: '법정지상권 가능성', doc: '등기사항증명서·건축물대장' },
  { item: '선순위 권리(근저당·전세권 등)', doc: '등기사항증명서' },
  { item: '가처분·소송', doc: '등기사항증명서·법원 사건 조회' },
  { item: '체납(국세·지방세)', doc: '납세증명·체납 조회' },
  { item: '분묘', doc: '현장 조사' },
  { item: '토양 오염', doc: '토양오염도 조사' },
  { item: '무단 점유', doc: '현장 조사·임대차 자료' },
];

const ORIGIN_METHOD = {
  document: '제출 문서',
  public: '공공 API',
  request: '사용자 입력',
  derived: '계산',
};

const STATUSES = ['VERIFIED', 'PARTIAL', 'UNVERIFIED', 'CONFLICTED'];

/** 데이터셋의 충돌 목록에서 «값이 갈린» 항목만 (REJECTED 는 값 충돌이 아니다) */
function conflictKeys(dataset) {
  const list = (dataset && Array.isArray(dataset.conflicts)) ? dataset.conflicts : [];
  return new Set(list.filter(c => c && c.type === 'VALUE_CONFLICT').map(c => c.key));
}

function statusOf(fact, conflicted, computed) {
  if (conflicted) return 'CONFLICTED';
  if (!fact) return 'UNVERIFIED';
  if (computed) return 'PARTIAL';
  return fact.verified ? 'VERIFIED' : 'UNVERIFIED';
}

/** 날짜 앞 10자리만 (`2026-09-26 17:12` → `2026-09-26`). 모르면 null */
function day(s) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || ''));
  return m ? m[1] : null;
}

function rowFromFact(spec, fact, conflicts) {
  const conflicted = conflicts.has(spec.key);
  const status = statusOf(fact, conflicted, false);
  if (!fact) {
    return {
      key: spec.key, label: spec.label, value: null, unit: null, scope: spec.scope,
      source: null, url: null, docVersion: null, asOf: null, retrievedAt: null,
      method: null, owner: null, status, renewBy: null,
      note: '값 없음 — 조회 실패·미제출을 «해당 없음»으로 읽지 않는다',
    };
  }
  return {
    key: spec.key, label: spec.label, value: fact.value, unit: fact.unit || null, scope: spec.scope,
    source: fact.source || null,
    url: null,          // 원문 주소를 담는 자리 — 지금 커넥터가 싣지 않는다(지어내지 않는다)
    docVersion: null,   // 문서 판·해시 — 제출 문서 판 관리가 들어오면 채운다
    asOf: day(fact.sourceDate),
    retrievedAt: day(fact.lastUpdated),
    method: ORIGIN_METHOD[fact.origin] || null,
    owner: null,        // 책임자 — 지정 전
    status,
    renewBy: null,      // 갱신 주기 미정 (D-333)
    note: conflicted ? '같은 항목에 서로 다른 값이 있다 — 하나로 고르지 않는다' : (fact.note || null),
  };
}

/** 08 Appraisal 의 방식별 값과 결론 — 전부 계산값(PARTIAL) */
function rowsFromAppraisal(appraisal, asOf) {
  const a = appraisal || {};
  const out = [];
  for (const [id, m] of Object.entries(a.methods || {})) {
    if (!m || m.valueEok === null || m.valueEok === undefined) continue;
    out.push({
      key: `appraisal.method.${id}`, label: m.label + (m.valueType === 'residual' ? ' (개발 완료 전제 · 조건부)' : ''),
      value: m.valueEok, unit: '억원', scope: m.valueType === 'residual' ? '개발 완료 전제' : '현 상태 토지',
      source: '08 Appraisal Agent', url: null, docVersion: null, asOf, retrievedAt: asOf,
      method: '계산', owner: null, status: 'PARTIAL', renewBy: null,
      note: m.assumption || null,
    });
  }
  if (a.concluded && a.concluded.valueEok !== undefined && a.concluded.valueEok !== null) {
    out.push({
      key: 'appraisal.concluded', label: '현 상태 참고가치(잠정)', value: a.concluded.valueEok, unit: '억원',
      scope: '현 상태 토지', source: '08 Appraisal Agent', url: null, docVersion: null, asOf, retrievedAt: asOf,
      method: '계산', owner: null, status: 'PARTIAL', renewBy: null,
      note: '고정 가중평균 — 최종가가 아니다',
    });
  }
  return out;
}

/**
 * G0(대상·권리) 게이트 — 지침 §3 표의 첫 칸. «통과» 조건을 하나라도 못 채우면 `HOLD`.
 * ★ 가격을 지우지는 않는다 — 가릴지는 사장님 판단이다 (D-333). 여기서는 **이유를 센다.**
 */
function gateG0(subject, items, rights) {
  const reasons = [];
  if (!subject.assetId) reasons.push('asset_id 없음');
  if (!subject.pnus.length) reasons.push('필지(PNU) 미확인');
  if (!subject.address) reasons.push('소재지 미확인');
  const own = items.find(r => r.key === 'land.ownership');
  if (!own || own.status !== 'VERIFIED') reasons.push('소유·지분 문서 확인 전');
  const area = items.find(r => r.key === 'land.area_sqm');
  if (!area || area.status === 'CONFLICTED' || area.value === null) reasons.push('대지면적 미확정');
  const openRights = rights.filter(r => r.status !== 'VERIFIED').length;
  if (openRights) reasons.push(`권리·점유 ${openRights}건 문서 확인 전`);
  return { id: 'G0', label: '대상·권리', status: reasons.length ? 'HOLD' : 'PASS', reasons };
}

/**
 * 대장을 만든다.
 * @param {object} o { assetId, dataset, appraisal, purpose?, asOf? }
 */
function build(o) {
  const opt = o || {};
  const ds = opt.dataset || null;
  const asOf = opt.asOf || kstDate();
  const get = k => (ds && typeof ds.get === 'function') ? ds.get(k) : null;
  const conflicts = conflictKeys(ds);

  const pnuFact = get('geo.pnu');
  const locFact = get('project.location');
  const subject = {
    assetId: opt.assetId || null,
    pnus: pnuFact && pnuFact.value ? [String(pnuFact.value)] : [],
    address: locFact && locFact.value ? String(locFact.value) : null,
    purpose: opt.purpose || '내부 검토(탁상)',
    asOf,
    retrievedAt: asOf,
    // ★ 여러 필지 사업이면 PNU 가 하나만 잡힌다 — 그 사실을 적는다(1개 누락도 확정 보류 · 지침 §2-1)
    parcelNote: '대표 필지 1개만 잡혔다 — 편입 필지 전체 목록은 아직 받지 않았다',
  };

  const items = [
    ...INPUT_KEYS.map(spec => rowFromFact(spec, get(spec.key), conflicts)),
    ...rowsFromAppraisal(opt.appraisal, asOf),
  ];

  const rights = RIGHTS.map(r => ({
    item: r.item, doc: r.doc, status: 'UNVERIFIED', finding: null,
    note: '문서로 확인 전 — 법률 판단은 담당 변호사 검토 대상',
  }));

  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const r of [...items, ...rights]) counts[r.status] += 1;

  return { subject, items, rights, gate: gateG0(subject, items, rights), counts };
}

/** 보고서 절 — 마크다운 */
function section(ev) {
  if (!ev) return '근거 대장을 만들지 못했다.';
  const s = ev.subject;
  const v = x => (x === null || x === undefined || x === '') ? '—' : String(x);
  const head = [
    `- asset_id: ${v(s.assetId)} · 필지(PNU): ${s.pnus.length ? s.pnus.join(', ') : '[미확인]'} · 소재지: ${v(s.address)}`,
    `- 평가 목적: ${s.purpose} · 기준시점: ${s.asOf} · 자료조회일: ${s.retrievedAt}`,
    `- ${s.parcelNote}`,
    '',
    `**G0 대상·권리 게이트: ${ev.gate.status === 'PASS' ? '통과' : '보류'}**`
      + (ev.gate.reasons.length ? ` — ${ev.gate.reasons.join(' · ')}` : ''),
    '',
    `상태: VERIFIED ${ev.counts.VERIFIED} · PARTIAL ${ev.counts.PARTIAL} · UNVERIFIED ${ev.counts.UNVERIFIED} · CONFLICTED ${ev.counts.CONFLICTED}`,
    '',
  ];
  const rows = ev.items.map(r =>
    `| ${r.label} | ${r.value === null ? '—' : `${r.value}${r.unit ? ` ${r.unit}` : ''}`} | ${v(r.scope)} | ${v(r.source)} | ${v(r.asOf)} | ${v(r.method)} | ${r.status} | ${v(r.note)} |`);
  const rrows = ev.rights.map(r => `| ${r.item} | ${r.doc} | ${r.status} | ${r.note} |`);
  return [
    ...head,
    '| 항목 | 값 | 범위 | 출처 | 기준일 | 수집 | 상태 | 비고 |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    '| 권리·점유 | 확인할 문서 | 상태 | 비고 |',
    '|---|---|---|---|',
    ...rrows,
    '',
    '책임자·원문 주소·문서 판·갱신필요일은 아직 비어 있다 — 지어내지 않고 빈칸(—)으로 둔다.',
    '',
    '자료출처: 본 자료 데이터셋 및 08 Appraisal Agent 산출 — 새 값을 만들지 않고 상태만 옮겨 적었다.',
  ].join('\n');
}

module.exports = { build, section, RIGHTS, INPUT_KEYS, STATUSES };
