'use strict';
/**
 * outputspec.js — Output Specification (사양: 출력 사양 확정 → 콘텐츠 → 디자인 → 렌더 → QC).
 *
 * ★ 핵심 규칙: AI가 페이지 수·크기·방향·파일형식·언어·파일명을 임의로 정하지 않는다.
 *   사양이 LOCK 되기 전에는 최종 산출물을 만들지 않는다. 초안(DRAFT)까지만 만든다.
 *
 * ★ 사양이 없을 때 AI가 하는 일은 '결정'이 아니라 '제안'이다.
 *   preset 으로 기본값을 채우되 confirmed=false 로 두고, 사람이 confirm 해야 LOCKED 가 된다.
 */

const store = require('./store');
const { kstStamp, kstDate } = require('./kst');

const PATH = '01_Project/output-spec.json';

/** 문서유형별 기본 사양 (사양 §4 DOCUMENT TYPE PRESET) */
const PRESETS = {
  im: {
    label: 'Investment Memorandum',
    pageSize: 'A4', orientation: 'portrait',
    targetPages: 40, minPages: 30, maxPages: 100, tolerance: 2,
    formats: ['pdf'], coverIncluded: true, appendixIncluded: true,
    language: 'ko', resolution: 'high', color: 'RGB',
    confidentiality: 'Strictly Confidential', watermark: false,
  },
  teaser: {
    label: 'Investment Teaser',
    pageSize: 'A4', orientation: 'portrait',
    targetPages: 3, minPages: 2, maxPages: 5, tolerance: 1,
    formats: ['pdf'], coverIncluded: true, appendixIncluded: false,
    language: 'ko', resolution: 'high', color: 'RGB',
    confidentiality: 'Confidential', watermark: false,
  },
  investor_presentation: {
    label: 'Investor Presentation',
    pageSize: '16:9', orientation: 'landscape',
    targetPages: 20, minPages: 15, maxPages: 30, tolerance: 3,
    formats: ['pdf'], coverIncluded: true, appendixIncluded: true,
    language: 'ko', resolution: 'high', color: 'RGB',
    confidentiality: 'Confidential', watermark: false,
  },
  financial_report: {
    label: 'Financial Report',
    pageSize: 'A4', orientation: 'portrait',
    targetPages: 20, minPages: 10, maxPages: 30, tolerance: 2,
    formats: ['pdf'], coverIncluded: true, appendixIncluded: true,
    language: 'ko', resolution: 'standard', color: 'RGB',
    confidentiality: 'Strictly Confidential', watermark: false,
  },
  ic_memo: {
    label: 'Investment Committee Memo',
    pageSize: 'A4', orientation: 'portrait',
    targetPages: 8, minPages: 5, maxPages: 15, tolerance: 2,
    formats: ['pdf'], coverIncluded: true, appendixIncluded: false,
    language: 'ko', resolution: 'standard', color: 'RGB',
    confidentiality: 'Strictly Confidential', watermark: true,
  },
  dd_report: {
    label: 'Due Diligence Report',
    pageSize: 'A4', orientation: 'portrait',
    targetPages: 30, minPages: 20, maxPages: 60, tolerance: 3,
    formats: ['pdf'], coverIncluded: true, appendixIncluded: true,
    language: 'ko', resolution: 'standard', color: 'RGB',
    confidentiality: 'Strictly Confidential', watermark: false,
  },
  executive_summary: {
    label: 'Executive Summary',
    pageSize: 'A4', orientation: 'portrait',
    targetPages: 2, minPages: 1, maxPages: 3, tolerance: 1,
    formats: ['pdf'], coverIncluded: false, appendixIncluded: false,
    language: 'ko', resolution: 'standard', color: 'RGB',
    confidentiality: 'Confidential', watermark: false,
  },
};

/**
 * 이 저장소가 실제로 만들 수 있는 형식.
 * ★ 만들 수 없는 형식을 사양에 넣고 '생성됨'으로 표시하지 않는다 —
 *   사양서에서 HWP를 언급했다고 해서 HWP를 만들 수 있는 것은 아니다.
 */
const SUPPORTED_FORMATS = {
  html: { ext: 'html', label: 'A4 인쇄용 HTML', supported: true },
  pdf: { ext: 'pdf', label: 'PDF', supported: false, via: 'HTML을 브라우저 인쇄로 출력한다 (헤드리스 렌더러 미탑재)' },
  json: { ext: 'json', label: '뷰어용 content.json', supported: true },
  md: { ext: 'md', label: '마크다운 원문', supported: true },
  pptx: { ext: 'pptx', label: 'PowerPoint', supported: false, via: '의존성 추가 승인 필요' },
  docx: { ext: 'docx', label: 'Word', supported: false, via: '의존성 추가 승인 필요' },
  hwp: { ext: 'hwp', label: '한글', supported: false, via: '생성 불가 — 사양에 넣어도 만들어지지 않는다' },
  xlsx: { ext: 'xlsx', label: 'Excel', supported: false, via: '의존성 추가 승인 필요' },
};

const PAGE_SIZES = {
  A4: { widthMm: 210, heightMm: 297 },
  A3: { widthMm: 297, heightMm: 420 },
  A5: { widthMm: 148, heightMm: 210 },
  Letter: { widthMm: 216, heightMm: 279 },
  Legal: { widthMm: 216, heightMm: 356 },
  '16:9': { widthMm: 338, heightMm: 190 },
  '4:3': { widthMm: 254, heightMm: 190 },
};

function read(projectId) {
  return store.readJson(projectId, PATH, null);
}

/**
 * 사양 제안 — AI는 제안만 하고 확정하지 않는다.
 * @returns {object} confirmed=false 상태의 사양
 */
function propose(projectId, { docType = 'im', themeId = null, overrides = {} } = {}) {
  const preset = PRESETS[docType] || PRESETS.im;
  const project = store.readJson(projectId, '01_Project/project.json', {});
  const existing = read(projectId);

  const spec = {
    projectId,
    docType,
    ...preset,
    ...overrides,
    themeId: themeId || overrides.themeId || null,
    version: existing ? existing.version : 'v1.0',
    fileName: overrides.fileName || fileName({
      projectName: project.name || projectId,
      docType, language: overrides.language || preset.language,
      version: existing ? existing.version : 'v1.0',
    }),
    proposedAt: kstStamp(),
    confirmed: false,
    confirmedBy: null,
    locked: false,
    pageBudget: null,
    source: existing ? 'updated' : 'preset',
  };

  spec.pageDimensions = PAGE_SIZES[spec.pageSize] || null;
  return spec;
}

/**
 * 페이지 예산 (사양 §5 PAGE COUNT CONTROL).
 * "약 30페이지"라고 쓰지 않고 절별로 배분한 뒤 목표에 맞춘다.
 */
function buildPageBudget(sections, targetPages, { coverIncluded = true, appendixPages = 3 } = {}) {
  const fixed = (coverIncluded ? 1 : 0) + 2; // 표지 + 중요고지 + 목차
  const available = Math.max(sections.length, targetPages - fixed - appendixPages);

  // 절별 가중치 — 내용이 많은 절에 더 준다
  const weights = sections.map(s => {
    const text = String(s.text || '');
    const tables = (text.match(/^\s*\|/gm) || []).length;
    const lines = text.split('\n').filter(l => l.trim()).length;
    return Math.max(1, Math.round((lines + tables * 1.5) / 12));
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0) || sections.length;

  let allocated = sections.map((s, i) => ({
    no: s.no, id: s.id, title: s.title,
    pages: Math.max(1, Math.round((weights[i] / totalWeight) * available)),
  }));

  // 목표에 맞춰 보정 (내용을 지우지 않고 배분만 조정한다)
  const adjust = () => allocated.reduce((a, x) => a + x.pages, 0);
  let guard = 0;
  while (adjust() > available && guard++ < 500) {
    const biggest = allocated.reduce((a, b) => (b.pages > a.pages ? b : a));
    if (biggest.pages <= 1) break;
    biggest.pages -= 1;
  }
  guard = 0;
  while (adjust() < available && guard++ < 500) {
    const smallest = allocated.reduce((a, b) => (b.pages < a.pages ? b : a));
    smallest.pages += 1;
  }

  const body = adjust();
  return {
    fixed: { cover: coverIncluded ? 1 : 0, notice: 1, toc: 1 },
    sections: allocated,
    appendix: appendixPages,
    total: fixed + body + appendixPages,
    target: targetPages,
  };
}

/** 파일명 규칙 (사양 §22): [Project]_[DocType]_[Lang]_[Version]_[Date] */
function fileName({ projectName, docType, language = 'ko', version = 'v1.0', date = null }) {
  const clean = String(projectName || 'Project')
    .replace(/[^\wㄱ-ㅎ가-힣]+/g, '')
    .slice(0, 30) || 'Project';
  const lang = String(language).toUpperCase();
  const d = (date || kstDate()).replace(/-/g, '');
  const type = String(docType).replace(/_/g, '');
  return `${clean}_${type}_${lang}_${version}_${d}`;
}

/**
 * 사양 확정 — 사람만 할 수 있다. 확정되면 LOCKED.
 */
function confirm(projectId, { by, notes = '' } = {}) {
  if (!by || /agent|ai|auto|claude|gemini/i.test(by)) {
    throw new Error('출력 사양 확정은 사람만 할 수 있다 — AI는 제안만 한다');
  }
  const spec = read(projectId);
  if (!spec) throw new Error('확정할 출력 사양이 없다 — 먼저 spec propose 를 실행한다');

  const check = validateSpec(spec);
  if (!check.ok) {
    throw new Error(`사양이 불완전하다: ${check.problems.join(' / ')}`);
  }

  const locked = { ...spec, confirmed: true, confirmedBy: by, confirmedAt: kstStamp(), locked: true, notes };
  store.writeJson(projectId, PATH, locked);
  store.appendRunLog(projectId, { agent: 'output_spec', status: 'locked', by, version: locked.version });
  return locked;
}

/**
 * 사양 변경 — 확정 후 변경하면 새 버전이 필요하다 (사양 §27).
 */
function change(projectId, changes, { by, reason = '' } = {}) {
  const prev = read(projectId);
  if (!prev) throw new Error('변경할 사양이 없다');

  const MATERIAL = ['pageSize', 'orientation', 'targetPages', 'formats', 'language', 'themeId', 'docType'];
  const material = Object.keys(changes).filter(k => MATERIAL.includes(k)
    && JSON.stringify(changes[k]) !== JSON.stringify(prev[k]));

  const nextVersion = material.length && prev.locked
    ? bumpVersion(prev.version)
    : prev.version;

  const next = {
    ...prev, ...changes,
    version: nextVersion,
    pageDimensions: PAGE_SIZES[changes.pageSize || prev.pageSize] || null,
    // 중대 변경은 확정을 무효화한다 — 다시 사람이 확인해야 한다
    confirmed: material.length ? false : prev.confirmed,
    locked: material.length ? false : prev.locked,
    changedAt: kstStamp(),
    changedBy: by || null,
    changeReason: reason,
    history: [...(prev.history || []), {
      version: prev.version, at: prev.changedAt || prev.proposedAt,
      changed: material, by: by || null, reason,
    }],
  };
  store.writeJson(projectId, PATH, next);
  return { spec: next, materialChanges: material, versionBumped: nextVersion !== prev.version };
}

function bumpVersion(v) {
  const m = String(v).match(/^v?(\d+)\.(\d+)$/);
  if (!m) return 'v1.1';
  return `v${m[1]}.${Number(m[2]) + 1}`;
}

/** 사양 자체의 완결성 검사 (사양 §26 FINAL OUTPUT CHECKLIST) */
function validateSpec(spec) {
  const problems = [];
  const required = ['docType', 'pageSize', 'orientation', 'targetPages', 'formats', 'language', 'version', 'fileName', 'confidentiality'];
  for (const k of required) {
    if (spec[k] === null || spec[k] === undefined || (Array.isArray(spec[k]) && !spec[k].length)) {
      problems.push(`${k} 미확정`);
    }
  }
  if (spec.pageSize && !PAGE_SIZES[spec.pageSize]) problems.push(`알 수 없는 페이지 크기: ${spec.pageSize}`);
  if (!['portrait', 'landscape'].includes(spec.orientation)) problems.push(`알 수 없는 방향: ${spec.orientation}`);
  if (spec.targetPages && spec.minPages && spec.targetPages < spec.minPages) problems.push('목표 페이지가 최소값보다 작다');
  if (spec.targetPages && spec.maxPages && spec.targetPages > spec.maxPages) problems.push('목표 페이지가 최대값보다 크다');

  // 생성 불가 형식을 요구하면 사양 단계에서 막는다
  const unsupported = (spec.formats || []).filter(f => SUPPORTED_FORMATS[f] && !SUPPORTED_FORMATS[f].supported);
  for (const f of unsupported) {
    problems.push(`${f.toUpperCase()} 생성 불가 — ${SUPPORTED_FORMATS[f].via}`);
  }
  const unknown = (spec.formats || []).filter(f => !SUPPORTED_FORMATS[f]);
  for (const f of unknown) problems.push(`알 수 없는 형식: ${f}`);

  return { ok: problems.length === 0, problems };
}

function save(projectId, spec) {
  store.writeJson(projectId, PATH, spec);
  return spec;
}

module.exports = {
  PRESETS, SUPPORTED_FORMATS, PAGE_SIZES, PATH,
  read, propose, save, confirm, change, validateSpec, buildPageBudget, fileName, bumpVersion,
};
