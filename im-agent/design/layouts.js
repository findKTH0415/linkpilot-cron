'use strict';
/**
 * layouts.js — Page Template Engine (사양 §10 · §11).
 *
 * 절의 '내용'을 보고 레이아웃을 고른다. 테마가 선호 레이아웃을 지정하면 그쪽이 우선한다.
 * ★ 레이아웃 선택은 규칙이다. 같은 내용이면 항상 같은 레이아웃이 나와야 한다.
 */

const LAYOUTS = {
  L01: { id: 'L01', label: 'Full Image', use: '표지·자산 전경·입지 항공사진', needs: ['image'] },
  L02: { id: 'L02', label: 'Two Column', use: '서술 + 데이터 병렬', needs: [] },
  L03: { id: 'L03', label: 'Three Column', use: '3개 축 비교', needs: [] },
  L04: { id: 'L04', label: 'KPI Dashboard', use: '핵심 지표 카드', needs: ['kpi'] },
  L05: { id: 'L05', label: 'Chart Focus', use: '차트 중심', needs: ['chart'] },
  L06: { id: 'L06', label: 'Table Focus', use: '표 중심', needs: ['table'] },
  L07: { id: 'L07', label: 'Map Focus', use: '지도·위성·GIS', needs: ['map'] },
  L08: { id: 'L08', label: 'Timeline', use: '일정·단계', needs: ['timeline'] },
  L09: { id: 'L09', label: 'Comparison', use: '경쟁·대안 비교', needs: ['table'] },
  L10: { id: 'L10', label: 'Investment Structure', use: '자본구조·지분구조', needs: [] },
  L11: { id: 'L11', label: 'Risk Matrix', use: '위험 매트릭스', needs: ['flags'] },
  L12: { id: 'L12', label: 'Full Text', use: '순수 서술', needs: [] },
};

/** 데이터 유형 → 시각화 (사양 §11: 숫자를 표로만 표시하지 않는다) */
const VISUALIZATION = {
  'revenue.annual': 'bar',
  'returns.equity_irr': 'kpi',
  'returns.project_irr': 'kpi',
  'returns.min_dscr': 'kpi',
  'debt.amount': 'donut',
  'equity.amount': 'donut',
  'investment.total': 'kpi',
  'schedule.construction_years': 'timeline',
  'exit.cap_rate': 'kpi',
  'massing.far_planned': 'gauge',
};

/** 절 본문을 훑어 어떤 요소가 들어 있는지 판별한다 */
function detect(section) {
  const text = String(section.text || '');
  return {
    table: /^\s*\|/m.test(text),
    map: /지도에서 보기|위성|지적|좌표|VWorld/.test(text),
    flags: /\[RED\]|\[YELLOW\]|\[안내\]/.test(text),
    chart: /민감도|Sensitivity/.test(text) || (section.table === 'sensitivity'),
    timeline: /공사기간|일정|착공|준공|Timeline/.test(text),
    kpi: /IRR|DSCR|MOIC|NPV/.test(text),
    image: /\.(svg|png|jpg)/i.test(text),
    empty: text.trim().length < 40,
  };
}

/**
 * @param {object} section IM 절 (no, id, title, text, table)
 * @param {object} theme   테마 (layouts 선호 지정)
 * @returns {{id:string, label:string, reason:string}}
 */
function pick(section, theme = {}) {
  const preferred = (theme.layouts || {})[section.id];
  if (preferred && LAYOUTS[preferred]) {
    return { ...LAYOUTS[preferred], reason: `테마 '${theme.id}' 지정` };
  }

  const has = detect(section);

  // 우선순위: 지도 > 위험 > 차트 > 표 > KPI > 이미지 > 서술
  if (has.map) return { ...LAYOUTS.L07, reason: '지도·위성 자료 포함' };
  if (has.flags) return { ...LAYOUTS.L11, reason: '위험 플래그 포함' };
  if (has.chart) return { ...LAYOUTS.L05, reason: '민감도·차트 자료' };
  if (has.timeline && !has.table) return { ...LAYOUTS.L08, reason: '일정 정보' };
  if (has.table && has.kpi) return { ...LAYOUTS.L06, reason: '지표 표' };
  if (has.table) return { ...LAYOUTS.L06, reason: '표 포함' };
  if (has.kpi) return { ...LAYOUTS.L04, reason: '핵심 지표' };
  if (has.image) return { ...LAYOUTS.L01, reason: '이미지 자료' };
  if (has.empty) return { ...LAYOUTS.L12, reason: '자료 부족' };
  return { ...LAYOUTS.L12, reason: '서술 중심' };
}

/** 절 목록 전체에 레이아웃 배정 */
function assign(sections, theme = {}) {
  return sections.map(s => ({ ...s, layout: pick(s, theme) }));
}

/** 어떤 값을 어떤 시각화로 보여줄지 */
function visualFor(key) {
  return VISUALIZATION[key] || 'value';
}

module.exports = { LAYOUTS, VISUALIZATION, detect, pick, assign, visualFor };
