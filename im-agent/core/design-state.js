'use strict';
/**
 * design-state.js — 프로젝트별 디자인 선택 상태 + 버전 이력 (사양 §14 · §15).
 *
 * ★ 사양 §16 MASTER RULE: Content 와 Design 을 완전히 분리한다.
 *   디자인을 바꿔도 dataset.json · im.json(내용·수치)은 건드리지 않는다.
 *   이 파일은 '어떤 테마를 골랐는가'만 관리하며, 다시 렌더하면 새 디자인이 적용된다.
 */

const themes = require('../design/themes');
const store = require('./store');
const { kstStamp } = require('./kst');

const PATH = '01_Project/design.json';

const DEFAULT = {
  themeId: 'institutional',
  docType: 'im',
  brandKit: null,
  version: '1.0',
  history: [],
};

function read(projectId) {
  return store.readJson(projectId, PATH, null) || { ...DEFAULT };
}

/** 현재 선택 → 해석된 테마 객체 */
function currentTheme(projectId, docType = null) {
  const state = read(projectId);
  return themes.resolve(state.themeId, {
    docType: docType || state.docType || 'im',
    brandKit: state.brandKit,
  });
}

/**
 * 디자인 선택/변경. 이전 선택은 history 에 쌓인다 (되돌릴 수 있어야 한다).
 * @param {string} by 변경한 사람 — 디자인 변경도 감사 대상이다
 */
function select(projectId, { themeId, docType = null, brandKit = undefined, by = null, note = '' }) {
  if (!themes.get(themeId)) {
    throw new Error(`알 수 없는 디자인 테마: ${themeId} (사용 가능: ${themes.list().map(t => t.id).join(', ')})`);
  }
  const prev = read(projectId);
  const nextVersion = `${Number(String(prev.version).split('.')[0] || 1) + (prev.history.length || prev.themeId !== themeId ? 1 : 0)}.0`;

  const state = {
    themeId,
    docType: docType || prev.docType || 'im',
    brandKit: brandKit === undefined ? prev.brandKit : brandKit,
    version: prev.themeId === themeId && prev.docType === (docType || prev.docType) ? prev.version : nextVersion,
    changedAt: kstStamp(),
    changedBy: by,
    note,
    history: [
      ...prev.history,
      { version: prev.version, themeId: prev.themeId, docType: prev.docType, at: prev.changedAt || null, by: prev.changedBy || null },
    ].filter(h => h.themeId),
  };

  store.writeJson(projectId, PATH, state);
  store.appendRunLog(projectId, { agent: 'design_selection', status: 'complete', themeId, version: state.version, by });
  return state;
}

/** 이전 버전으로 되돌린다 */
function revert(projectId, version, by = null) {
  const state = read(projectId);
  const target = state.history.find(h => h.version === version);
  if (!target) throw new Error(`디자인 버전 ${version} 이력이 없다`);
  return select(projectId, { themeId: target.themeId, docType: target.docType, by, note: `v${version} 로 복원` });
}

/** Brand Kit 저장 (사양 §8) */
function setBrandKit(projectId, brandKit, by = null) {
  const state = read(projectId);
  return select(projectId, { themeId: state.themeId, docType: state.docType, brandKit, by, note: 'Brand Kit 적용' });
}

/** 프로젝트 폴더에 테마 산출물을 쓴다 — PPT·Dashboard 가 같은 파일을 읽는다 */
function writeThemeAssets(projectId, theme) {
  store.writeJson(projectId, '12_Final/theme.json', {
    id: theme.id, label: theme.label, docType: theme.docType,
    palette: {
      primary: theme.primary, primaryMid: theme.primaryMid,
      accent: theme.accent, accentLight: theme.accentLight,
      onPrimary: theme.onPrimary, onPrimarySub: theme.onPrimarySub,
      surface: theme.surface, surfaceAlt: theme.surfaceAlt,
      negative: theme.negative, brandRed: theme.brandRed,
    },
    chart: theme.chart,
    typography: { serif: theme.serif, sans: theme.sans },
    spacing: theme.spacing,
    cover: theme.cover,
    emphasisKpis: theme.emphasisKpis,
    brandKit: theme.brandKit || null,
    resolvedFrom: theme.resolvedFrom,
  });
  store.writeText(projectId, '12_Final/theme.css', themes.toCss(theme));
}

module.exports = { read, select, revert, currentTheme, setBrandKit, writeThemeAssets, PATH, DEFAULT };
