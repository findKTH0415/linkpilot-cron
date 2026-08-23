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
/**
 * 시각자료 기본값.
 *
 * ★ **왜 사양에 두는가:** 조감도는 「만들지 말지」를 사람이 정하는 것이고,
 *   그 결정은 페이지 수·형식과 같은 자리에 있어야 한다. 값 입력(2단계)에 두면
 *   「값」과 「무엇을 만들지」가 섞인다.
 * ★ 켜 두어도 **근거가 없으면 만들지 않는다** — 지적 필지 형상이 없으면
 *   09 Massing 이 사유를 남기고 건너뛴다. 켰다고 그림이 나오는 것이 아니다.
 */
const VISUAL_DEFAULT = {
  // 지적도 + 건축개요로 그리는 검토용 조감도 (AI 이미지가 아니다)
  birdseye: true,
  // 용적률·건폐율 검토용 매스. 조감도와 달리 필지 형상이 없어도 만든다
  massing: true,
};

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
  /**
   * 탁상검토 보고서 (등록부 D-57).
   *
   * ★ **감정평가서가 아니다.** 감정평가는 감정평가법인등만 할 수 있다 —
   *   그래서 label 에 「Appraisal」을 쓰지 않는다. 파일 이름·표지·목차에
   *   그 낱말이 들어가면 형식만으로 정식 평가처럼 읽힌다.
   * ★ **워터마크를 켠다.** 이 문서는 낱장으로 굴러다니기 쉽다 — 한 장만
   *   떨어져 나가도 참고 자료임이 남아야 한다.
   */
  desk_appraisal: {
    label: 'Desk Review — Land Value',
    pageSize: 'A4', orientation: 'portrait',
    targetPages: 8, minPages: 5, maxPages: 15, tolerance: 2,
    formats: ['pdf'], coverIncluded: true, appendixIncluded: false,
    language: 'ko', resolution: 'standard', color: 'RGB',
    confidentiality: 'Strictly Confidential', watermark: true,
  },
  /**
   * 법인가치 검토 보고서 (등록부 D-59).
   *
   * ★ **평가의견서가 아니다** — 외부평가는 외부평가기관만, 세무 평가는
   *   세무대리인만 할 수 있다. `desk_appraisal` 과 같은 이유로 label 에
   *   「Valuation Opinion」·「평가의견서」를 쓰지 않고 워터마크를 켠다.
   */
  corp_valuation: {
    label: 'Desk Review — Corporate',
    pageSize: 'A4', orientation: 'portrait',
    targetPages: 8, minPages: 5, maxPages: 15, tolerance: 2,
    formats: ['pdf'], coverIncluded: true, appendixIncluded: false,
    language: 'ko', resolution: 'standard', color: 'RGB',
    confidentiality: 'Strictly Confidential', watermark: true,
  },
  /**
   * 요약 보고서 · 검증 보고서 〈2026-08-23 추가 — 실제 사고〉.
   *
   * ★★ **없어서 조용히 `im` 으로 떨어지고 있었다.** 화면(`reports.html` 의
   *   `kinds`)과 서버 문지기(`DOC_PLANS`)는 넷을 아는데 여기만 둘이었다.
   *   그래서 「요약 보고서 · 10페이지」를 확정하면 `PRESETS.im` 이 얹혀
   *   `minPages` 가 30 이 되고 **「목표 페이지가 최소값보다 작다」**로 막혔다.
   *
   * ★ 막힌 것이 그나마 다행이다 — 통과했으면 표지·파일이름·기밀등급이
   *   **전부 Investment Memorandum 으로** 나갔다. 사양은 요약인데 문서는
   *   IM 인 상태이고, 문서만 봐서는 잡히지 않는다 (§4.9).
   *
   * ★ 페이지 수는 화면이 이미 쓰던 값을 그대로 가져왔다 (요약 10 · 검증 12).
   *   `test/outputspec-doctype.test.js` 가 화면과 여기를 대 본다.
   */
  summary: {
    label: 'Summary Report',
    pageSize: 'A4', orientation: 'portrait',
    targetPages: 10, minPages: 5, maxPages: 20, tolerance: 2,
    formats: ['pdf'], coverIncluded: true, appendixIncluded: false,
    language: 'ko', resolution: 'standard', color: 'RGB',
    confidentiality: 'Strictly Confidential', watermark: false,
  },
  /**
   * 검증 보고서 — RED FLAG · 값 충돌 · 독립 재계산.
   * ★ **워터마크를 켠다.** 낱장으로 돌아다니면 「이 딜은 문제가 있다」로만
   *   읽히기 쉬운 문서다 — 어느 문서의 부속인지가 장마다 남아야 한다.
   */
  validation: {
    label: 'Validation Report',
    pageSize: 'A4', orientation: 'portrait',
    targetPages: 12, minPages: 6, maxPages: 30, tolerance: 2,
    formats: ['pdf'], coverIncluded: true, appendixIncluded: true,
    language: 'ko', resolution: 'standard', color: 'RGB',
    confidentiality: 'Strictly Confidential', watermark: true,
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
  /**
   * ★★ **대신 쓴 것은 대신 썼다고 남긴다** 〈2026-08-23 · 실제 사고〉.
   *
   *   앞 판은 `PRESETS[docType] || PRESETS.im` 한 줄이었다. 모르는 종류가 오면
   *   조용히 IM 사양이 얹히고, 그 뒤로는 **아무 데도 그 사실이 없었다.**
   *   실제로 `summary`·`validation` 이 여기 없어서 「요약 보고서 · 10페이지」가
   *   IM 의 `minPages: 30` 에 걸려 확정이 안 됐다. 막혀서 알았지, 안 막혔으면
   *   표지도 파일이름도 IM 으로 나갔을 것이다.
   *
   *   ★ 그래서 되돌아가지 않는다 — 대신 쓴 사실을 `presetFor` 에 적고
   *     `validateSpec` 이 그것을 문제로 잡는다. 대체값으로 메우면 문서에는
   *     「적용됨」만 남는다 (CLAUDE.md §4.9).
   */
  const known = Object.prototype.hasOwnProperty.call(PRESETS, docType);
  const preset = known ? PRESETS[docType] : PRESETS.im;
  const project = store.readJson(projectId, '01_Project/project.json', {});
  const existing = read(projectId);

  const spec = {
    projectId,
    docType,
    ...preset,
    // 어느 preset 을 썼는가. 종류와 다르면 대신 쓴 것이다
    presetFor: known ? docType : 'im',
    /* ★ 출력 성격 네 축 〈2026-08-23〉. 기존 사양을 이어받되, **판형은 layout 이
     *   정한다** — 사람이 A4/16:9 를 따로 고르면 「세로형인데 16:9」가 나온다 */
    ...STYLE_DEFAULT,
    ...((existing && {
      layout: existing.layout, density: existing.density,
      house: existing.house, register: existing.register,
    }) || {}),
    ...overrides,
    // ★ 통째로 덮어쓰지 않고 **항목별로** 얹는다. 사용자가 birdseye 하나만
    //   보내도 massing 이 사라지면 안 된다
    visuals: { ...VISUAL_DEFAULT, ...((existing && existing.visuals) || {}), ...(overrides.visuals || {}) },
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

  /* ★★ **판형이 용지·방향을 이긴다** 〈2026-08-23〉. 둘을 따로 두면
   *   「발표자료(가로형)인데 A4 세로」 같은 사양이 만들어지고, 그때 나오는
   *   문서는 어느 쪽도 아니다. overrides 로 직접 준 것만 예외로 둔다. */
  const st = styleOf(spec);
  if (overrides.pageSize === undefined) spec.pageSize = st.L.pageSize;
  if (overrides.orientation === undefined) spec.orientation = st.L.orientation;

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
  /* ★ 2026-08-17 — 부분 문자열이 아니라 **낱말**로 본다. 예전 /ai/ 는 'gmail.com' 의 "ai" 에 걸려
     @gmail.com 사용자 전원이 사양을 확정할 수 없었다(앱 실측: ws.gmsc@gmail.com 이 409).
     이메일이면 로컬파트만 보고, 낱말 경계로 agent/ai/auto/claude/gemini/bot 을 막는다. */
  const who = String(by || '').split('@')[0];
  if (!who || /(^|[^a-z])(agent|ai|auto|claude|gemini|bot|gpt|llm)([^a-z]|$)/i.test(who)) {
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

  /* ★ 네 축도 **중대 변경**이다 — 판형·어조가 바뀌면 문서가 통째로 달라진다.
   *   확정을 무효로 돌리지 않으면 「확정했는데 다른 문서」가 나온다 */
  const MATERIAL = ['pageSize', 'orientation', 'targetPages', 'formats', 'language', 'themeId', 'docType', 'visuals',
    'layout', 'density', 'house', 'register'];
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
  /* ★ 모르는 축 값은 **문제로 잡는다.** 조용히 기본값으로 그리면 사람은
   *   자기가 고른 것이 적용된 줄 안다 (§4.9) */
  const st = styleOf(spec);
  st.unknown.forEach((u) => problems.push(`알 수 없는 출력 성격: ${u}`));
  /* ★ 판형과 용지가 어긋나면 잡는다 — 어느 쪽으로 나올지 문서만 봐서는 모른다 */
  if (spec.layout && spec.pageSize && spec.pageSize !== st.L.pageSize) {
    problems.push(`판형(${st.L.label})과 용지(${spec.pageSize})가 어긋난다`);
  }
  if (spec.pageSize && !PAGE_SIZES[spec.pageSize]) problems.push(`알 수 없는 페이지 크기: ${spec.pageSize}`);
  if (!['portrait', 'landscape'].includes(spec.orientation)) problems.push(`알 수 없는 방향: ${spec.orientation}`);
  /* ★ 대신 쓴 사양은 **문제로 잡는다.** 여기서 조용히 통과시키면 요약 보고서가
   *   IM 표지·IM 파일이름으로 나가고, 문서만 봐서는 잡히지 않는다 (§4.9) */
  if (spec.presetFor && spec.docType && spec.presetFor !== spec.docType) {
    problems.push(`「${spec.docType}」 사양이 없어 「${spec.presetFor}」 사양을 대신 썼다`
      + ' — 표지·파일이름·기밀등급이 다른 문서의 것이 된다');
  }
  if (spec.targetPages && spec.minPages && spec.targetPages < spec.minPages) {
    problems.push(`목표 페이지가 최소값보다 작다 (${spec.targetPages} < ${spec.minPages})`);
  }
  if (spec.targetPages && spec.maxPages && spec.targetPages > spec.maxPages) {
    problems.push(`목표 페이지가 최대값보다 크다 (${spec.targetPages} > ${spec.maxPages})`);
  }

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

/* ══════════════════════════════════════════════════════════════════
   출력 성격 — 네 축 〈2026-08-23 사장님 지시〉

     「전문 금융권 IM 레이아웃(세로형), PPT(가로형) / 텍스트 중심, 디자인
      그래픽 중심, 혼합형 중심 / 정부, 공기업, 대기업, 연구실, 전문기업 스타일 /
      전문형, 일반형 (용어, 단어선택, 설명기조) 다름」

   ★★ **여기가 단일 출처다.** 화면(미리보기 팝업)과 엔진(본문 집필)이 같은 표를
     본다. 화면에만 두면 「미리보기는 이렇게 생겼는데 나온 문서는 다른」 상태가
     되고, 그것은 미리보기가 없느니만 못하다.

   ★ 네 축은 **서로 곱해진다** — 2 × 3 × 5 × 2 = 60가지. 그래서 조합마다
     견본을 미리 그려 두지 않는다. **고른 조합 하나를 그 자리에서** 그린다.
   ══════════════════════════════════════════════════════════════════ */

/**
 * ① 판형. **용지·방향을 여기서 정한다** — 사람이 A4/16:9 를 따로 고르면
 *   「세로형인데 16:9」 같은 조합이 만들어진다.
 */
const LAYOUTS = {
  im_portrait: {
    label: '금융권 IM (세로형)',
    hint: '기관 투자자에게 내는 정본. 본문이 이어지고 표·주석이 함께 간다.',
    pageSize: 'A4', orientation: 'portrait',
    columns: 1, bodyPt: 10.5, headingPt: 15,
  },
  ppt_landscape: {
    label: '발표자료 (가로형)',
    hint: '한 장에 한 메시지. 문장을 줄이고 도표를 키운다.',
    pageSize: '16:9', orientation: 'landscape',
    columns: 2, bodyPt: 12, headingPt: 22,
  },
};

/**
 * ② 무게중심. **페이지 예산의 배분**이 실제로 달라진다 —
 *   말만 바꾸는 것이 아니라 그림 자리를 몇 할 잡을지가 바뀐다.
 */
const DENSITY = {
  text: { label: '텍스트 중심', hint: '문장으로 설명한다. 그림은 근거가 있을 때만.', figureShare: 0.15 },
  mixed: { label: '혼합형', hint: '절마다 그림 하나와 문단 몇 개.', figureShare: 0.35 },
  graphic: { label: '그래픽 중심', hint: '표·차트가 먼저. 문장은 그것을 읽는 법만.', figureShare: 0.6 },
};

/**
 * ③ 기관 스타일. 색·활자·표지 격식이 달라진다.
 * ★ **로고와 이름은 여기서 정하지 않는다** — 그것은 발행 주체(`core/issuer.js`)다.
 *   섞으면 「정부 스타일을 골랐더니 발행처가 정부로 바뀌는」 사고가 난다.
 */
const HOUSES = {
  gov: {
    label: '정부', accent: '#1B3A6B', neutral: '#F4F5F7',
    hint: '표지에 문서번호·시행일. 장식을 쓰지 않고 표를 많이 쓴다.',
    serifBody: true, coverRule: 'heavy',
  },
  public: {
    label: '공기업', accent: '#0E6B5E', neutral: '#F2F6F5',
    hint: '정부 격식에 준하되 사업 성과를 앞에 둔다.',
    serifBody: true, coverRule: 'heavy',
  },
  corp: {
    label: '대기업', accent: '#16304F', neutral: '#F5F6F8',
    hint: '표지가 넓고 여백이 크다. 지표를 큰 활자로 보여 준다.',
    serifBody: false, coverRule: 'wide',
  },
  research: {
    label: '연구실', accent: '#4A3A78', neutral: '#F5F4F8',
    hint: '각주와 출처가 본문만큼 중요하다. 그림에 번호를 붙인다.',
    serifBody: true, coverRule: 'plain',
  },
  boutique: {
    label: '전문기업', accent: '#C00000', neutral: '#F7F5F4',
    hint: '한 가지 색만 강하게. 판형과 활자로 승부한다.',
    serifBody: false, coverRule: 'plain',
  },
};

/**
 * ④ 어조. **용어·단어선택·설명기조**가 달라진다.
 *
 * ★★ 여기 표가 **문구의 단일 출처**다. 화면이 견본에 쓰는 말과 엔진이 본문에
 *   쓰는 말이 같아야 「교정본」이 뜻을 갖는다.
 * ★ 숫자는 어느 쪽에서도 바뀌지 않는다 — 바뀌는 것은 **부르는 이름과 설명**뿐이다.
 */
const REGISTER = {
  expert: {
    label: '전문형',
    hint: '기관 심사역이 읽는다. 약어를 풀지 않고 판단 근거만 적는다.',
    terms: {
      irr: 'Equity IRR', dscr: 'Min. DSCR', ltc: 'LTC', noi: 'NOI',
      capRate: 'Exit Cap Rate', moic: 'Equity Multiple',
    },
    explain: false,
    sample: 'Equity IRR 14.2% · Min. DSCR 1.31x · LTC 65%. 준공 후 3년차 안정화 기준이며, '
      + '민감도는 임대료 ±10% · 금리 ±100bp 구간에서 DSCR 1.15x 를 하회하지 않는다.',
  },
  plain: {
    label: '일반형',
    hint: '내부 보고·의사결정자가 읽는다. 약어를 처음 나올 때 풀어 준다.',
    terms: {
      irr: '자기자본 수익률(Equity IRR)', dscr: '원리금 상환능력(DSCR)',
      ltc: '총사업비 대비 대출비율(LTC)', noi: '순영업이익(NOI)',
      capRate: '매각 환원율(Cap Rate)', moic: '투자원금 대비 회수배수',
    },
    explain: true,
    sample: '투자한 돈에 대한 수익률(Equity IRR)은 연 14.2% 입니다. 대출 원리금을 갚을 여력'
      + '(DSCR)은 최소 1.31배로, 1배를 넘으면 갚을 수 있다는 뜻입니다. 임대료가 10% 떨어지고 '
      + '금리가 1%p 올라도 1.15배 아래로는 내려가지 않았습니다.',
  },
};

/** 사양에 안 적혀 있을 때 쓰는 값. **골라 놓고 안 적힌 것과 구분되어야 한다** */
const STYLE_DEFAULT = {
  layout: 'im_portrait', density: 'mixed', house: 'boutique', register: 'expert',
};

/**
 * 네 축을 읽어 **그리는 데 필요한 것만** 뽑아 준다.
 * ★ 모르는 값이 오면 **조용히 기본값으로 바꾸지 않는다** — 무엇이 모르는 값이었는지
 *   `unknown` 에 담아 돌려준다 (CLAUDE.md §4.9).
 */
function styleOf(spec) {
  const s = spec || {};
  const unknown = [];
  const pick = (table, key, dflt) => {
    const v = s[key];
    if (v === undefined || v === null || v === '') return dflt;
    if (!table[v]) { unknown.push(`${key}=${v}`); return dflt; }
    return v;
  };
  const layout = pick(LAYOUTS, 'layout', STYLE_DEFAULT.layout);
  const density = pick(DENSITY, 'density', STYLE_DEFAULT.density);
  const house = pick(HOUSES, 'house', STYLE_DEFAULT.house);
  const register = pick(REGISTER, 'register', STYLE_DEFAULT.register);
  return {
    layout, density, house, register, unknown,
    L: LAYOUTS[layout], D: DENSITY[density], H: HOUSES[house], R: REGISTER[register],
  };
}

module.exports = {
  LAYOUTS, DENSITY, HOUSES, REGISTER, STYLE_DEFAULT, styleOf,
  VISUAL_DEFAULT,
  PRESETS, SUPPORTED_FORMATS, PAGE_SIZES, PATH,
  read, propose, save, confirm, change, validateSpec, buildPageBudget, fileName, bumpVersion,
};
