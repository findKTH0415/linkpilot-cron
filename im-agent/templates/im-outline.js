'use strict';
/**
 * im-outline.js — IM / Teaser 목차 정의.
 *
 * 각 절은 자기가 쓸 수 있는 데이터 key 를 선언한다(dataKeys).
 * Writer Agent는 선언되지 않은 값을 그 절에서 쓸 수 없다 — 절별 데이터 격리.
 */

const IM_SECTIONS = [
  { no: '01', id: 'exec_summary', title: 'Executive Summary', dataKeys: ['project.name', 'project.location', 'project.assetType', 'investment.total', 'returns.equity_irr', 'returns.project_irr', 'returns.equity_moic'], narrative: true },
  { no: '02', id: 'highlights', title: 'Investment Highlights', dataKeys: ['returns.equity_irr', 'returns.min_dscr', 'capacity.it_load_mw', 'building.gfa_sqm', 'exit.cap_rate'], narrative: true },
  { no: '03', id: 'overview', title: 'Project Overview', dataKeys: ['project.name', 'project.location', 'project.sponsor', 'schedule.construction_years', 'schedule.ops_years'], narrative: true },
  { no: '04', id: 'sponsor', title: 'Sponsor / Developer', dataKeys: ['project.sponsor', 'legal.spc'], narrative: true },
  { no: '05', id: 'asset', title: 'Asset Overview', dataKeys: ['land.area_sqm', 'building.gfa_sqm', 'building.floors', 'capacity.it_load_mw', 'capacity.power_mw', 'capacity.pue', 'capacity.dc_kw', 'capacity.ac_kw', 'capacity.leasable_sqm'], narrative: true },
  { no: '06', id: 'location', title: 'Location Analysis', dataKeys: ['project.location', 'land.zoning'], narrative: true, research: 'location' },
  { no: '07', id: 'market', title: 'Market Analysis', dataKeys: [], narrative: true, research: 'market_size' },
  { no: '08', id: 'industry', title: 'Industry Analysis', dataKeys: [], narrative: true, research: 'demand_driver' },
  { no: '09', id: 'development', title: 'Development Plan', dataKeys: ['schedule.construction_years', 'investment.construction'], narrative: true },
  { no: '10', id: 'technical', title: 'Technical Analysis', dataKeys: ['capacity.pue', 'capacity.power_mw', 'capacity.dc_kw', 'capacity.ac_kw'], narrative: true },
  { no: '11', id: 'legal', title: 'Legal & Permit', dataKeys: ['legal.permit_status', 'land.ownership', 'land.zoning', 'legal.spc'], narrative: true },
  { no: '12', id: 'construction', title: 'Construction', dataKeys: ['investment.construction', 'schedule.construction_years', 'investment.contingency_pct'], narrative: true },
  { no: '13', id: 'commercial', title: 'Commercial Strategy', dataKeys: ['revenue.annual', 'revenue.unit_price', 'revenue.ramp_years'], narrative: true },
  { no: '14', id: 'financial', title: 'Financial Analysis', dataKeys: [], table: 'financial', narrative: true },
  { no: '15', id: 'financing', title: 'Financing Structure', dataKeys: ['debt.amount', 'debt.rate', 'debt.tenor_years', 'debt.grace_years', 'debt.ltc', 'equity.amount'], narrative: true },
  { no: '16', id: 'structure', title: 'Investment Structure', dataKeys: ['legal.spc', 'equity.amount', 'debt.amount'], narrative: true },
  { no: '17', id: 'risk', title: 'Risk Analysis', dataKeys: [], table: 'flags', narrative: true, research: 'risk' },
  { no: '18', id: 'exit', title: 'Exit Strategy', dataKeys: ['exit.cap_rate', 'exit.year', 'returns.exit_value'], narrative: true },
  { no: '19', id: 'sensitivity', title: 'Sensitivity Analysis', dataKeys: [], table: 'sensitivity', narrative: false },
  { no: '20', id: 'conclusion', title: 'Investment Conclusion', dataKeys: ['returns.equity_irr', 'returns.project_irr', 'returns.min_dscr', 'returns.npv'], narrative: true },
];

const TEASER_ITEMS = [
  { label: 'Project Name', key: 'project.name' },
  { label: 'Asset Type', key: 'project.assetType' },
  { label: 'Location', key: 'project.location' },
  { label: 'Investment Size', key: 'investment.total' },
  { label: 'Annual Revenue', key: 'revenue.annual' },
  { label: 'Stabilized NOI', key: 'returns.noi_stabilized' },
  { label: 'Project IRR', key: 'returns.project_irr' },
  { label: 'Equity IRR', key: 'returns.equity_irr' },
  { label: 'Equity Multiple', key: 'returns.equity_moic' },
  { label: 'Min DSCR', key: 'returns.min_dscr' },
  { label: 'Exit Value', key: 'returns.exit_value' },
];

/** 대외 문서(Teaser/IM)는 PDI 하우스 스타일을 따른다 */
const HOUSE_STYLE = {
  header: 'Strictly Private and Confidential',
  noEmoji: true,
  noPersonalNames: true,
  footer: 'This document has been prepared for information purposes only and does not constitute an offer or solicitation.',
};

module.exports = { IM_SECTIONS, TEASER_ITEMS, HOUSE_STYLE };
