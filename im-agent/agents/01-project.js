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
const { pickTemplate } = require('../finance/templates');
const { kstStamp } = require('../core/kst');
const { parseNumber } = require('../core/numeric');

const inputSchema = {
  type: 'object',
  required: ['request'],
  properties: {
    request: { type: 'string', minLength: 2 },
    projectName: { type: 'string' },
    assetType: { type: 'string' },
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

async function run(input, ctx) {
  const request = input.request.trim();
  const template = input.assetType
    ? pickTemplate(input.assetType)
    : pickTemplate(request);

  const projectId = store.nextProjectId(template.id);
  const dir = store.createProjectDirs(projectId);
  const name = input.projectName || deriveName(request);

  const facts = seedFromRequest(request);
  facts.push({
    key: 'project.name', value: name, unit: null,
    source: 'user_request', sourceDate: kstStamp().slice(0, 10), confidence: 0.7, verified: false,
  });
  facts.push({
    key: 'project.assetType', value: template.label, unit: null,
    source: 'user_request', sourceDate: kstStamp().slice(0, 10), confidence: 0.7, verified: false,
  });

  const project = {
    projectId, name, request,
    templateId: template.id, assetType: template.label,
    createdAt: kstStamp(),
    status: 'created',
    folders: store.FOLDERS,
  };
  store.writeJson(projectId, '01_Project/project.json', project);

  if (!facts.some(f => f.key === 'project.location')) {
    ctx.warn('요청문에서 소재지를 찾지 못했다 — 원본자료 업로드 후 재추출 필요');
  }

  return { projectId, templateId: template.id, name, dir, facts, confidence: 0.7 };
}

module.exports = { id: '01_project', label: 'Project Manager Agent', inputSchema, outputSchema, run, seedFromRequest, deriveName };
