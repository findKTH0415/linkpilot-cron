'use strict';
/**
 * 01 Project Manager Agent
 *
 * 입력: 자연어 요청 1줄 ("인천 남동공단 6.5MW 데이터센터 개발사업 IM 작성")
 * 출력: Project ID · Data Room 폴더 · 요청문에서 뽑은 초기 Fact
 *
 * ★ 요청문에서 뽑은 값은 출처 = 'user_request', confidence 0.55, verified=false 다.
 *   사용자가 말했다는 것은 문서로 확인됐다는 뜻이 아니다.
 */

const store = require('../core/store');
const { pickTemplate, getTemplate } = require('../finance/templates');
const assetclass = require('../core/assetclass');
const { kstStamp } = require('../core/kst');
const { parseNumber } = require('../core/numeric');

const inputSchema = {
  type: 'object',
  required: ['request'],
  properties: {
    request: { type: 'string', minLength: 2 },
    projectName: { type: 'string' },
    assetType: { type: 'string' },
    assetClass: { type: 'string' },
  },
};

const outputSchema = {
  type: 'object',
  required: ['projectId', 'templateId', 'name', 'facts'],
  properties: {
    projectId: { type: 'string', pattern: '^LP-[A-Z]+-\\d{4}-\\d{3}$' },
    templateId: { type: 'string' },
    name: { type: 'string' },
    dir: { type: 'string' },
    facts: { type: 'array' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

/** 요청문에서 용량/지역을 뽑는다 (규칙 기반 — LLM 불필요) */
function seedFromRequest(request) {
  const facts = [];
  const src = { source: 'user_request', sourceDate: kstStamp().slice(0, 10), page: null, confidence: 0.55, verified: false };

  const mw = request.match(/([\d,.]+)\s*MW/i);
  if (mw) {
    const v = parseNumber(mw[1]);
    if (v !== null) facts.push({ key: 'capacity.it_load_mw', value: v, unit: 'MW', quote: mw[0], ...src });
  }

  const kw = request.match(/([\d,.]+)\s*kW/i);
  if (kw && !mw) {
    const v = parseNumber(kw[1]);
    if (v !== null) facts.push({ key: 'capacity.dc_kw', value: v, unit: 'kW', quote: kw[0], ...src });
  }

  // 지역: '시/군/구/공단/산업단지' 앞의 어절
  const loc = request.match(/([가-힣]+(?:특별시|광역시|시|군|구)?\s*[가-힣]*(?:공단|산업단지|산단|지구|동|읍|면))/);
  if (loc) facts.push({ key: 'project.location', value: loc[1].trim(), unit: null, quote: loc[0], ...src });

  return facts;
}

function deriveName(request) {
  return request
    .replace(/\s*(IM|Teaser|티저|보고서|투자설명서)?\s*(작성|생성|만들어\s*줘|만들기|해줘)\s*$/i, '')
    .trim() || request.trim();
}

/**
 * 자산군을 정한다. **못 정하면 null 을 돌려준다** — generic 으로 흘려보내면
 * 그 자산군의 전용 필수 항목(객실 수·층고·분양가능 면적…)이 통째로
 * 안 물어봐지는데, 화면은 「필수 다 채웠다」고 말한다.
 */
function resolveClass(raw, request) {
  const s = String(raw || '').trim();
  if (s) {
    const hit = assetclass.CLASSES.find(c => c.id === s || c.label === s || c.en === s);
    if (hit) return { id: hit.id, how: 'chosen', reason: null, candidates: [hit.id] };
  }
  const d = assetclass.detect([s, request].filter(Boolean).join(' '));
  return { id: d.id, how: d.id ? 'detected' : null, reason: d.reason, candidates: d.candidates };
}

async function run(input, ctx) {
  const request = input.request.trim();
  const cls = resolveClass(input.assetClass || input.assetType, request);

  // 자산군이 정해지면 재무 템플릿도 그것이 정한다 (둘이 어긋나면 모델과 문서가 갈린다)
  const template = cls.id
    ? getTemplate(assetclass.templateOf(cls.id))
    : (input.assetType ? pickTemplate(input.assetType) : pickTemplate(request));

  const projectId = store.nextProjectId(template.id);
  const dir = store.createProjectDirs(projectId);
  const name = input.projectName || deriveName(request);

  const facts = seedFromRequest(request);
  facts.push({
    key: 'project.name', value: name, unit: null,
    source: 'user_request', sourceDate: kstStamp().slice(0, 10), confidence: 0.7, verified: false,
  });
  const classDef = cls.id ? assetclass.CLASSES.find(c => c.id === cls.id) : null;
  facts.push({
    // 자산군을 알면 그쪽이 더 구체적이다 — 「부동산 개발 (PF)」보다 「호텔」이
    // IM 에 실려야 할 말이다. 모르면 템플릿 이름으로 둔다
    key: 'project.assetType', value: classDef ? classDef.label : template.label, unit: null,
    source: 'user_request', sourceDate: kstStamp().slice(0, 10), confidence: 0.7, verified: false,
  });

  const project = {
    projectId, name, request,
    templateId: template.id, assetType: classDef ? classDef.label : template.label,
    assetClass: cls.id,
    assetClassHow: cls.how,
    createdAt: kstStamp(),
    status: 'created',
    folders: store.FOLDERS,
  };
  store.writeJson(projectId, '01_Project/project.json', project);

  if (!facts.some(f => f.key === 'project.location')) {
    ctx.warn('요청문에서 소재지를 찾지 못했다 — 원본자료 업로드 후 재추출 필요');
  }
  // ★ 조용히 넘어가지 않는다. 자산군을 못 정하면 전용 필수 항목이 적용되지
  //   않는 채로 진행되고, 그 사실은 화면 어디에도 안 나온다
  if (!cls.id) {
    ctx.warn('자산군을 정하지 못했다 — 자산군 전용 필수 항목이 적용되지 않는다'
      + (cls.reason ? ` (${cls.reason})` : '')
      + (cls.candidates && cls.candidates.length ? ` · 후보: ${cls.candidates.join(', ')}` : ''));
  }

  return {
    projectId, templateId: template.id, name, dir, facts, confidence: 0.7,
    assetClass: cls.id, assetClassCandidates: cls.candidates || [],
  };
}

/**
 * 이 Agent 가 요청문만으로 채우는 key.
 * ★ 입력 화면이 '무엇을 안 물어봐도 되는가'를 판단하는 근거다 (core/fieldplan.js).
 *   여기와 실제 seedFromRequest 가 갈리면 화면이 물어보지 않는데 값도 안 들어온다.
 */
const FILLS = ['project.name', 'project.assetType', 'project.location',
  'capacity.it_load_mw', 'capacity.dc_kw'];

module.exports = { id: '01_project', label: 'Project Manager Agent', inputSchema, outputSchema, run, seedFromRequest, deriveName, FILLS };
