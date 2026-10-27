'use strict';
/**
 * arch-engine.js — AI 건축설계·법규·인허가·3D 시각화 통합엔진 (시범판)
 * 〈2026-10-27 사장님: 「첨부한 이미지가 반영된 AI_건축설계_법규_인허가_통합엔진을 만들어줘」 · 「제미나이 나노바나나와 연결하여」〉
 *
 * 원문: docs/운영지침-AI건축설계-법규-인허가-통합엔진-v1.0.md (여기 옮겨 적지 않는다 — CLAUDE.md §8-1)
 *
 * ★ 이 모듈이 하는 일 — 지침서 §16 의 아홉 모듈 중 «계산·대조·보고»를 맡는다:
 *   ① 도구 연결 점검(§3) ② 자료대장(§5) ③ 기준 설계 데이터(§10) ④ 수치·공간·도서 대조(§10·§14)
 *   ⑤ 현행/변경 전제 시나리오 분리(§7) ⑥ 인허가 경로 «적용 여부 판정 필요» 목록(§13)
 *   ⑦ 실사 시각화 지시문(§12 · 제미나이 나노바나나로 넘긴다) ⑧ 결론·근거·설계·실행·결정 보고(§15)
 * ★ 이 모듈이 하지 않는 일 — 자동배치·CAD/BIM 도면·일조 계산·법정 한도 값 짓기.
 *   연결된 도구가 없으면 «미연결»로 적고 그 결론을 보류한다(§3). 없는 값은 null · 상태는 UNVERIFIED (§2-5).
 * ★ LLM 을 부르지 않는다 — 결정적 계산만 한다(§2-3). 조감도 그림만 scripts/gemini-figure.mjs 가 짓는다.
 * ★ 판정 낱말은 지침서 §6 의 넷 — PASS(검증범위 내 적합) · FAIL(부적합) · UNVERIFIED(미확인) · NA(비적용).
 *   ‘100% 법규 준수’·‘허가 보장’ 같은 말을 만들지 않는다(§17).
 */

const STATUS = { PASS: '검증범위 내 적합', FAIL: '부적합', UNVERIFIED: '미확인', NA: '비적용' };

/* §3 실행 환경 — 이 저장소에서 «실제로» 무엇이 이어져 있는가. 프로그램 이름만 보고 단정하지 않는다. */
const TOOLS = [
  { id: 'law', label: '법규 조사', need: '현행 법령·조례·고시 원문', via: 'connectors/law.js (법제처 · LAW_OC)', env: ['LAW_OC', 'LAW_OPEN_DATA'], miss: '확보 자료에 한정하여 분석하고 최신성 미확인 표시' },
  { id: 'site', label: '대지 분석', need: '지적·지형·좌표·도시계획', via: 'connectors/vworld.js (VWORLD_KEY)', env: ['VWORLD_KEY', 'LINKPILOT_VWORLD_REPORT_KEY', 'LINKPILOT_VWORLD_WEB_KEY'], miss: '실측 기반 배치 확정을 보류하고 개념검토만 수행' },
  { id: 'layout', label: '자동배치', need: '치수·좌표 기반 기하 계산·최적화', via: null, env: [], miss: '배치 조건서와 알고리즘 명세만 작성' },
  { id: 'cad', label: '도면 생성', need: 'CAD/BIM 또는 치수 보존 벡터', via: null, env: [], miss: '실제 설계도면 생성 완료로 표시 금지' },
  { id: 'model3d', label: '3D 모델', need: '건물 객체·높이·지형 모델링', via: 'agents/09-massing.js (개념 매스 OBJ·glTF · 설계 모델 아님)', env: [], partial: true, miss: '모델 생성 지시서만 작성' },
  { id: 'render', label: '실사 시각화', need: '렌더러 또는 이미지 생성·편집', via: 'scripts/gemini-figure.mjs (제미나이 나노바나나 · 기준 그림 입력)', env: ['GEMINI_API_KEY'], miss: '렌더링 프롬프트만 작성하고 생성 상태와 구분' },
  { id: 'sun', label: '일조·환경 분석', need: '위치·시간·태양·인접 건물 계산', via: null, env: [], miss: '법정 일조 검토 완료로 표시 금지' },
];

function toolCheck(env = process.env) {
  return TOOLS.map((t) => {
    let state;
    if (!t.via) state = '미연결';
    else if (t.partial) state = '부분 연결';
    else if (!t.env.length) state = '연결';
    else state = t.env.some((k) => env[k] && String(env[k]).trim()) ? '연결(열쇠 있음)' : '열쇠 없음 — 열쇠가 있는 자리(Actions·NAS)에서만 돈다';
    return { id: t.id, label: t.label, need: t.need, via: t.via, state, miss: t.miss };
  });
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const chk = (id, item, status, value, why, src) => ({ id, item, status, statusKo: STATUS[status], value: value == null ? null : value, why, src: src || null });

/* §10 기준 설계 데이터 — 사례 입력을 지침서의 최소 구조로 옮긴다. 값을 만들지 않는다. */
function designModel(c) {
  return {
    project_id: c.project_id || null,
    design_version: c.design_version || 'D001',
    analysis_date: c.analysis_date || null,
    jurisdiction: (c.site && c.site.jurisdiction) || null,
    coordinate_system: (c.site && c.site.coordinate_system) || null,
    length_unit: 'm', area_unit: 'm2',
    site_boundary: (c.site && c.site.boundary) || [],
    site_area: num(c.site && c.site.area_m2),
    scenario: 'current_conditions',
    buildings: (c.plan && c.plan.buildings) || [],
    unit_mix: (c.plan && c.plan.unit_mix) || [],
    households: num(c.plan && c.plan.households),
    parking: num(c.plan && c.plan.parking),
    sources: c.sources || [],
    status: 'UNVERIFIED',
  };
}

/* 같은 단지를 그린 그림끼리 «동번호·층수»를 대 본다 — 한 그림에만 있는 동 · 두 번 적힌 동 · 층수가 다른 동 */
function compareViews(base, view) {
  const out = { view: view.id, missing: [], extra: [], dup: [], floorDiff: [] };
  const seen = {};
  for (const l of view.labels || []) { seen[l.id] = (seen[l.id] || 0) + 1; }
  for (const [id, n] of Object.entries(seen)) if (n > 1) out.dup.push(id);
  const ids = new Set(base.map((b) => b.id));
  for (const b of base) {
    if (!seen[b.id]) out.missing.push(b.id);
    else {
      const l = (view.labels || []).find((x) => x.id === b.id);
      if (l && num(l.floors) != null && l.floors !== b.floors) out.floorDiff.push(`${b.id} ${b.floors}F↔${l.floors}F`);
    }
  }
  for (const id of Object.keys(seen)) if (!ids.has(id)) out.extra.push(id);
  return out;
}

function checks(c) {
  const m = designModel(c);
  const out = [];
  const B = m.buildings;
  const src = (k) => (c.sources || []).find((s) => s.id === k) ? k : null;

  /* A1 동·층 구성 — 기준 배치도 대 지침서 사례 구상(북 25×3 · 중앙 21×4 · 남 17×5) */
  const grp = {};
  for (const b of B) grp[b.floors] = (grp[b.floors] || 0) + 1;
  const want = (c.plan && c.plan.concept_groups) || {};
  const okGrp = Object.keys(want).length && Object.entries(want).every(([f, n]) => grp[f] === n) && Object.keys(grp).length === Object.keys(want).length;
  out.push(chk('A1', '동·층 구성 (배치도 ↔ 구상)', okGrp ? 'PASS' : 'FAIL',
    Object.entries(grp).map(([f, n]) => `${f}층 ${n}개 동`).join(' · '),
    okGrp ? '기준 배치도의 12개 동 층수가 구상(25층 3 · 21층 4 · 17층 5)과 같다' : '구상과 배치도의 동·층 구성이 다르다', 'img5'));

  /* A2 세대 유형 합계 */
  const mixSum = m.unit_mix.reduce((s, u) => s + (num(u.count) || 0), 0);
  out.push(chk('A2', '세대 유형 합계', m.households == null ? 'UNVERIFIED' : (mixSum === m.households ? 'PASS' : 'FAIL'),
    m.unit_mix.map((u) => `${u.type}㎡ ${u.count}`).join(' + ') + ` = ${mixSum} (목표 ${m.households})`,
    '유형별 합과 전체 세대수가 같은지만 본다 — 동별·층별 세대표가 없어 배치 수용은 못 잰다', 'doc'));

  /* A3 층수 × 세대 정합 — 세대표가 없으니 «층당 몇 세대여야 하는가»만 계산해 보인다 */
  const floors = B.reduce((s, b) => s + (num(b.floors) || 0), 0);
  const per = floors ? m.households / floors : null;
  const pil = num(c.plan && c.plan.pilotis_floors_per_building);
  const resFloors = pil == null ? null : floors - pil * B.length;
  const why3 = [`지상 층 합 ${floors}개 층(동별 층수 합) · 목표 ${m.households}세대 → 층당 평균 ${per == null ? '—' : per.toFixed(2)}세대`];
  if (floors) why3.push(`층당 4세대면 ${floors * 4}세대 — 목표와 ${floors * 4 - m.households}세대 차. 필로티 층이 있으면 그만큼 모자란다`);
  why3.push(pil == null ? '필로티 층수·동별 세대 배치가 자료에 없다 → 동별·층별 세대표를 받아 다시 잰다' : `필로티 ${pil}개 층/동 제외 시 주거 층 ${resFloors}개 → 층당 ${(m.households / resFloors).toFixed(2)}세대`);
  out.push(chk('A3', '층수 × 세대 정합', 'UNVERIFIED', per == null ? null : +per.toFixed(2), why3.join(' · '), 'img5'));

  /* A4 대지면적 · 건폐율 · 용적률 — 대지면적이 없으면 계산하지 않는다(이미지 축척으로 추정하지 않는다 · §5) */
  const far = num(c.plan && c.plan.far_target_pct);
  out.push(chk('A4', '건폐율 · 용적률', 'UNVERIFIED', far == null ? null : `목표 ${far}%`,
    m.site_area == null ? '대지면적·용적률 산정용 연면적이 자료에 없다 — 토지이용계획확인서·측량성과로 대지면적을 확정한 뒤 계산한다. 이미지 축척으로 면적을 추정하지 않는다(지침 §5)' : '대지면적은 있으나 용적률 산정용 연면적이 없다'));

  /* A5 주차 — 계획값 비율만 계산, 법정 대수는 조례가 정한다 */
  const ratio = m.parking != null && m.households ? m.parking / m.households : null;
  const exclusive = m.unit_mix.reduce((s, u) => s + (num(u.type) || 0) * (num(u.count) || 0), 0);
  out.push(chk('A5', '주차 대수', 'UNVERIFIED', ratio == null ? null : `계획 ${m.parking}대 · 세대당 ${ratio.toFixed(2)}대`,
    `전용면적 합 ${exclusive.toLocaleString('ko-KR')}㎡ — 법정 대수는 「주택건설기준 등에 관한 규정」과 관할 지자체 조례로 산정한다(조례 미확인). 배치 수용대수는 주차 계획도가 없어 못 잰다`));

  /* B 그림끼리 대조 — 같은 단지를 나타내는 배치도·조감도의 동번호·층수 */
  for (const v of (c.views || [])) {
    const d = compareViews(B, v);
    const bad = d.missing.length || d.extra.length || d.dup.length || d.floorDiff.length;
    const parts = [];
    if (d.dup.length) parts.push(`두 번 적힌 동 ${d.dup.join(' · ')}`);
    if (d.missing.length) parts.push(`빠진 동 ${d.missing.join(' · ')}`);
    if (d.extra.length) parts.push(`기준에 없는 동 ${d.extra.join(' · ')}`);
    if (d.floorDiff.length) parts.push(`층수 다름 ${d.floorDiff.join(' · ')}`);
    out.push(chk('B-' + v.id, `동번호 대조 (${v.label} ↔ 기준 배치도)`, bad ? 'FAIL' : 'PASS', `라벨 ${(v.labels || []).length}개`, bad ? parts.join(' · ') : '12개 동 번호·층수가 기준 배치도와 같다', v.id));
  }

  /* C 평면 유형 대조 — 평면도에 적힌 면적과 세대 구성의 유형 */
  const types = new Set(m.unit_mix.map((u) => num(u.type)));
  for (const p of (c.plans || [])) {
    const issues = [];
    if (!types.has(num(p.area_m2))) issues.push(`평면 ${p.area_m2}㎡ 는 세대 구성(${[...types].join('㎡ · ')}㎡)에 없는 유형`);
    const names = {};
    for (const r of p.rooms || []) names[r] = (names[r] || 0) + 1;
    /* 번호가 붙은 실명(침실1)만 겹치면 오류다 — 발코니·욕실이 둘인 것은 정상이다 */
    const dup = Object.entries(names).filter(([r, n]) => n > 1 && /\d$/.test(r)).map(([r, n]) => `${r} ×${n}`);
    if (dup.length) issues.push(`실명 중복 ${dup.join(' · ')}`);
    if (p.brand) issues.push(`타사 상표 «${p.brand}» 표기 — 이 사업 자료에 쓰지 않는다`);
    if (p.scale_bar_bad) issues.push('축척 막대 눈금이 맞지 않는다 — 치수 근거로 쓰지 않는다');
    out.push(chk('C-' + p.id, `평면도 대조 (${p.label})`, issues.length ? 'FAIL' : 'UNVERIFIED', `${p.area_m2}㎡`,
      (issues.length ? issues.join(' · ') + ' · ' : '') + '벽체·코어·계단·승강기·피난 성립은 치수 도면이 없어 못 잰다', p.id));
  }

  /* D 시각화 이미지 — 형상 대조 전에는 «AI 디자인 참고 이미지» */
  for (const v of (c.renders || [])) {
    const issues = (v.flags || []).slice();
    out.push(chk('D-' + v.id, `${v.kind === '도식' ? '도식 대조' : '시각화 이미지'} (${v.label})`, issues.length ? 'FAIL' : 'UNVERIFIED', v.kind,
      (issues.length ? issues.join(' · ') + (v.kind === '도식' ? '' : ' · ') : '') + (v.kind === '도식' ? '' : '기준 3D 모델과 동수·층수·위치를 대조하기 전에는 «AI 디자인 참고 이미지»로 둔다(지침 §12)'), v.id));
  }
  return { model: m, checks: out };
}

/* §7 현행 조건 / 변경 전제 — 변경 검토 중인 조건을 승인된 조건으로 쓰지 않는다 */
function scenarios(c) {
  const z = (c.site && c.site.zoning) || null;
  return [
    { id: 'A', name: '현행 확인 조건', zoning: z, basis: z ? '토지이용계획확인서' : null, far: null,
      status: z ? 'UNVERIFIED' : 'UNVERIFIED', note: z ? '조례 한도 확인 필요' : '현행 용도지역이 자료에 없다 — 토지이용계획확인서가 먼저다. 이 시나리오의 규모는 계산하지 않는다' },
    { id: 'B', name: '변경 전제 (조건부)', zoning: (c.plan && c.plan.zoning_assumed) || null, basis: '사업자 구상(전환 전제)', far: num(c.plan && c.plan.far_target_pct),
      status: 'UNVERIFIED', note: '용도지역 변경(도시관리계획 결정·지구단위계획)이 성립했을 때만의 범위 — 관할기관 재량·심의에 좌우되어 확정값으로 쓰지 않는다' },
  ];
}

/* §13 인허가 — 모든 절차를 나열하지 않는다. 자료가 가리키는 것만 «적용 여부 판정 필요»로 올린다 */
function permits(c) {
  const f = (c.site && c.site.flags) || {};
  const hh = num(c.plan && c.plan.households) || 0;
  const rows = [];
  const add = (step, why, agency, lead) => rows.push({ step, applies: '판정 필요', why, agency: agency || '관할 시·군·구', lead: lead || null, statutory: null, expected: null, status: 'UNVERIFIED' });
  if (c.plan && c.plan.zoning_assumed) add('도시관리계획(용도지역) 결정·변경 · 지구단위계획', `구상이 «${c.plan.zoning_assumed}» 전환을 전제한다`, null, '사업 규모 확정의 선행 절차');
  if (hh >= 30) add('주택건설사업계획승인 (주택법)', `${hh}세대 — 공동주택 사업계획승인 대상 여부를 세대수 기준으로 판정`, null, '건축허가 의제 범위 확인');
  if (f.forest) add('산지전용 허가·협의', '대지 대부분이 수림지로 보인다(항공사진 판독 · 지목 미확인)', '산림청·지자체', '지목·보전산지 여부부터 확인');
  if (f.farmland) add('농지전용 허가·협의', '둘레에 경작지·비닐하우스가 보인다 — 사업지 편입 여부 미확인', null, null);
  if (f.existing_buildings) add('기존 건축물 해체 허가·신고', '사업지 안에 공장형 지붕 건물이 보인다(항공사진)', null, '소유·권원·해체 범위 확인');
  if (f.slope) add('개발행위·옹벽·재해 영향 검토', '경사지·절성토가 예상된다(조감도 기단부)', null, null);
  if (hh >= 500) add('교통영향평가 · 교육환경 검토', `${hh}세대 규모 — 대상 기준은 관련 법령·조례로 판정`, null, null);
  add('건축·경관 심의', '층수·규모에 따른 심의 대상 여부 판정', null, null);
  return rows;
}

/* §12 실사 시각화 지시문 — 제미나이 나노바나나에 «기준 그림»과 함께 넘긴다 */
function renderBrief(c, { view = 'aerial' } = {}) {
  const B = (c.plan && c.plan.buildings) || [];
  const list = B.map((b) => `${b.id} ${b.floors}층`).join(', ');
  return [
    '제공된 기준 그림(배치도 또는 매스 렌더)을 바탕으로 실사형 건축 조감도를 제작한다.',
    `사업지 경계와 건물 수 ${B.length}개 동(${list})의 위치·방향·층수·높이·외곽선, 도로·출입구 위치, 카메라 구도를 기준 그림 그대로 유지한다.`,
    '새 건물을 추가하거나 건물을 삭제·이동하지 않는다. 층수를 바꾸지 않는다.',
    '외장재·창호·조경·포장에 현실적인 질감과 반사, 자연광과 그림자를 적용한다. 주변 환경은 기준 그림의 항공사진을 따른다.',
    '문구·로고·상표·수치·동번호를 그림 안에 생성하지 않는다(표기는 별도 레이어로 후삽입한다).',
    view === 'aerial' ? '시점: 남측 상공 사선 조감.' : `시점: ${view}.`,
  ].join(' ');
}

/* 단위세대 평면 — 디자인 A·B·C 중 고른 것 · 템플릿 면적이 타입과 맞는지 (arch-plan.js) */
function planSet(c) {
  const plan = require('./arch-plan');
  const styles = plan.pickStyles(c.plan_style);
  const mix = (c.plan && c.plan.unit_mix) || [];
  const units = mix.map((u) => {
    const t = plan.TEMPLATES[u.type];
    if (!t) return { type: u.type, template: false };
    const a = plan.audit(t);
    return { type: u.type, template: true, label: t.label, sum: a.sum, tiled: a.tiled };
  });
  const checks = units.map((u) => {
    if (!u.template) return chk('E-' + u.type, `${u.type}㎡형 단위세대 평면`, 'UNVERIFIED', null, '개념 템플릿이 없다 — 실제 평면(치수 포함)이 오면 그린다.');
    const ok = u.tiled && Math.abs(u.sum - u.type) <= 1;
    return chk('E-' + u.type, `${u.type}㎡형 평면 면적 = 타입`, ok ? 'PASS' : 'FAIL', `${u.sum}㎡`,
      ok ? '개념 템플릿 · 벽체 중심선 기준 · 방이 외곽을 빈틈없이 덮는다 — 실제 평면이 아니다.' : '템플릿 면적이 타입과 다르거나 방이 겹친다 — 템플릿을 고친다.');
  });
  return { styles: styles.map((x) => ({ id: x, name: plan.STYLES[x].name })), units, checks };
}

function report(c, now) {
  const { model, checks: cs0 } = checks(c);
  const ps = planSet(c);
  const cs = [...cs0, ...ps.checks];
  const fail = cs.filter((x) => x.status === 'FAIL'), unv = cs.filter((x) => x.status === 'UNVERIFIED'), pass = cs.filter((x) => x.status === 'PASS');
  const tools = toolCheck(c.env || {});
  return { at: now || null, model, tools, checks: cs, scenarios: scenarios(c), permits: permits(c), renderBrief: renderBrief(c), plans: { styles: ps.styles, units: ps.units },
    summary: { pass: pass.length, fail: fail.length, unverified: unv.length, verdict: fail.length ? '검토안 — 부적합 항목 있음' : '검토안 — 미확인 항목 있음' } };
}

function toMarkdown(r, c) {
  const L = [];
  const cell = (s) => String(s == null ? '—' : s).replace(/\|/g, '／').replace(/\n/g, ' ');
  L.push(`# ${c.title || 'AI 건축설계·법규·인허가 통합엔진 — 검토 보고'}`, '');
  L.push(`설계 버전 ${r.model.design_version} · 시나리오 ${r.model.scenario} · 상태 ${r.model.status} · 작성 ${r.at || '—'}`, '');
  L.push('## 1. 결론', '');
  L.push(`- 판정: **${r.summary.verdict}** — 적합 ${r.summary.pass} · 부적합 ${r.summary.fail} · 미확인 ${r.summary.unverified}`);
  L.push('- 현행 조건(시나리오 A)의 규모는 산정하지 않았다 — 현행 용도지역·대지면적이 자료에 없다.');
  L.push('- 첨부 이미지의 조감도·평면도는 기준 배치도와 어긋나는 곳이 있어 «AI 디자인 참고 이미지»로 둔다.', '');
  L.push('## 2. 근거 — 수치·도서 대조', '', '| ID | 항목 | 판정 | 값 | 근거·사유 |', '|---|---|---|---|---|');
  for (const x of r.checks) L.push(`| ${x.id} | ${cell(x.item)} | ${x.statusKo} | ${cell(x.value)} | ${cell(x.why)} |`);
  L.push('', '## 3. 설계 — 시나리오', '', '| 시나리오 | 용도지역 | 용적률 | 상태 | 비고 |', '|---|---|---|---|---|');
  for (const s of r.scenarios) L.push(`| ${s.id} ${s.name} | ${cell(s.zoning)} | ${s.far == null ? '—' : s.far + '%'} | 미확인 | ${cell(s.note)} |`);
  L.push('', '## 4. 실행 — 인허가 경로 (적용 여부 판정 필요)', '', '| 절차 | 적용 여부 | 근거 | 관할 | 선행·쟁점 | 법정 처리기간 | 상태 |', '|---|---|---|---|---|---|---|');
  for (const p of r.permits) L.push(`| ${cell(p.step)} | ${p.applies} | ${cell(p.why)} | ${cell(p.agency)} | ${cell(p.lead)} | 미확인 | 미확인 |`);
  L.push('', '## 5. 도구 연결', '', '| 기능 | 연결 | 경로 | 미연결 시 |', '|---|---|---|---|');
  for (const t of r.tools) L.push(`| ${t.label} | ${t.state} | ${cell(t.via)} | ${cell(t.miss)} |`);
  L.push('', '## 6. 결정 — 받아야 할 자료', '');
  for (const n of (c.next || [])) L.push(`- ${n}`);
  if (r.plans && r.plans.styles.length) {
    L.push('', '## 7. 단위세대 평면 — 디자인 ' + r.plans.styles.map((x) => x.id).join('·'), '');
    L.push('고른 디자인: ' + r.plans.styles.map((x) => `${x.id} ${x.name}`).join(' · ') + ' — 모양만 다르고 치수·면적·실 배치는 같다.', '');
    for (const u of r.plans.units) L.push(u.template ? `- ${u.label}: 전용 합계 ${u.sum}㎡ · plans/unit-${u.type}-{${r.plans.styles.map((x) => x.id).join(',')}}.svg (+ JPEG)` : `- ${u.type}㎡형: 개념 템플릿 없음 — 실제 평면을 받아야 그린다`);
    L.push('', '★ 지금 평면은 «개념 템플릿 · 설계도서 아님»이다. 첨부 평면(46㎡·79㎡)은 타입과 달라 쓰지 않았다.');
  }
  L.push('', '## 8. 실사 조감도 지시문 (제미나이 나노바나나)', '', '> ' + r.renderBrief, '');
  L.push('이 보고는 기본설계 검토안이다. 인허가 적합 또는 허가 취득을 보장하지 않으며, 인허가 도서는 건축사 등 관계전문가의 검토·작성을 거친다(지침 §2-7).');
  return L.join('\n') + '\n';
}

module.exports = { STATUS, TOOLS, toolCheck, designModel, compareViews, checks, scenarios, permits, renderBrief, report, toMarkdown };
