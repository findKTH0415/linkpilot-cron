'use strict';
/**
 * pipeline.js — Agent Workflow 오케스트레이터.
 *
 *   Project Create → Extraction → Research → Financial → Cross Validation
 *   → IM/Teaser 생성 → [사람 승인] → 배포
 *
 * 실패 격리 원칙: 한 Agent가 죽어도 나머지는 진행한다.
 * 단, Dataset을 오염시킬 수 있는 실패(스키마 위반 등)는 결과를 버린다(runtime이 처리).
 *
 * ★ 사람 승인(gate) 이후 단계는 이 파이프라인이 수행하지 않는다.
 */

const { runAgent, STATUS } = require('./core/runtime');
const { Dataset } = require('./core/facts');
const { FIELDS } = require('./core/dictionary');
const store = require('./core/store');
const gate = require('./core/gate');
const designState = require('./core/design-state');
const { kstStamp } = require('./core/kst');

function loadDataset(projectId) {
  const json = store.readJson(projectId, '01_Project/dataset.json', null);
  if (json) return Dataset.fromJSON(json, FIELDS);
  return new Dataset(projectId, FIELDS);
}

function saveDataset(projectId, dataset) {
  store.writeJson(projectId, '01_Project/dataset.json', dataset.toJSON());
}

/**
 * @param {object} opts { request?, projectId?, log?, useLlm? }
 */
async function run(opts = {}) {
  const log = opts.log || (m => console.log(m));
  const results = {};
  let projectId = opts.projectId || null;
  let templateId = opts.templateId || null;

  // ── 01 Project ────────────────────────────────────────────
  if (!projectId) {
    if (!opts.request) throw new Error('request 또는 projectId 가 필요하다');
    const r = await runAgent('01_project', { request: opts.request, projectName: opts.projectName, assetType: opts.assetType }, { log });
    results['01_project'] = r;
    if (r.status === STATUS.ERROR) throw new Error(`프로젝트 생성 실패: ${r.error}`);
    projectId = r.output.projectId;
    templateId = r.output.templateId;

    const ds = new Dataset(projectId, FIELDS);
    ds.addMany(r.output.facts);
    ds.resolve();
    saveDataset(projectId, ds);
    log(`  프로젝트 생성: ${projectId} (${templateId}) → ${r.output.dir}`);
  } else {
    const project = store.readJson(projectId, '01_Project/project.json', null);
    if (!project) throw new Error(`프로젝트 없음: ${projectId}`);
    templateId = templateId || project.templateId;
  }

  const dataset = loadDataset(projectId);
  const ctx = { projectId, dataset, log };

  // ── 02 Extraction ─────────────────────────────────────────
  const ext = await runAgent('02_extraction', { projectId, useLlm: opts.useLlm !== false }, ctx);
  results['02_extraction'] = ext;
  if (ext.output && ext.output.facts) {
    // 재실행 시 같은 문서의 옛 추출값을 먼저 버린다 (자기 자신과의 충돌 방지)
    for (const doc of ext.output.documents) dataset.dropSource(doc.name);
    dataset.addMany(ext.output.facts);
    dataset.resolve();
    saveDataset(projectId, dataset);
    // ※ 메타파일은 02_Source_Data 밖에 쓴다 — 원본자료 폴더를 오염시키면 다음 실행에서 자신을 다시 읽는다
    store.writeJson(projectId, '01_Project/extraction.json', {
      at: kstStamp(), documents: ext.output.documents, unsupported: ext.output.unsupported,
      factCount: ext.output.facts.length,
    });
    log(`  추출: ${ext.output.facts.length}건 / 문서 ${ext.output.documents.length}건 / 미지원 ${ext.output.unsupported.length}건`);
  }

  // ── 07 Geo / Satellite (공공데이터 — 지적·공시지가·건축물대장) ──
  // 다른 Agent보다 먼저 돈다: 여기서 확보한 PNU/좌표가 감정평가·매스의 입력이다.
  const geo = await runAgent('07_geo', { projectId }, ctx);
  results['07_geo'] = geo;
  if (geo.output) {
    dataset.dropSource('지적공부(VWorld)');
    dataset.dropSource('건축물대장(국토교통부)');
    dataset.addMany(geo.output.facts);
    dataset.resolve();
    saveDataset(projectId, dataset);
    store.writeJson(projectId, '04_Property/geo.json', geo.output);
    if (geo.output.geo) {
      log(`  입지: ${geo.output.geo.refined || ''} (${geo.output.geo.lat}, ${geo.output.geo.lon})`
        + (geo.output.parcel ? ` · 지적 ${geo.output.parcel.officialAreaSqm ?? '-'}㎡` : '')
        + (geo.output.landUse ? ` · ${geo.output.landUse.zone}` : ''));
    }
  }

  // ── 03 Research ───────────────────────────────────────────
  const assetTypeFact = dataset.get('project.assetType');
  const locationFact = dataset.get('project.location');
  const nameFact = dataset.get('project.name');
  const res = await runAgent('03_research', {
    projectId,
    assetType: assetTypeFact ? String(assetTypeFact.value) : (templateId || 'generic'),
    location: locationFact ? String(locationFact.value) : null,
    projectName: nameFact ? String(nameFact.value) : projectId,
  }, ctx);
  results['03_research'] = res;
  if (res.output) store.writeJson(projectId, '05_Market/research.json', res.output);

  // ── 04 Financial ──────────────────────────────────────────
  const fin = await runAgent('04_financial', { projectId, templateId: templateId || 'generic' }, ctx);
  results['04_financial'] = fin;
  if (fin.output) {
    // 계산값은 매 실행마다 새로 산출된다 — 옛 계산값을 버리지 않으면 자기 자신과 충돌한다
    dataset.dropSource('financial_model (04_financial)');
    dataset.addMany(fin.output.computedFacts);
    dataset.resolve();
    saveDataset(projectId, dataset);
    store.writeJson(projectId, '07_Financial/financial.json', fin.output);
    const base = fin.output.scenarios.base.metrics;
    log(`  재무모델: Project IRR ${base.projectIRR}% / Equity IRR ${base.equityIRR}% / minDSCR ${base.minDSCR} (가정치 ${fin.output.assumed.length}건)`);
  }

  // ── 08 Appraisal (감정평가 — 수익환원법에 재무모델 NOI가 필요하므로 04 이후) ──
  const appraisal = await runAgent('08_appraisal', { projectId, financial: fin.output || null }, ctx);
  results['08_appraisal'] = appraisal;
  if (appraisal.output) {
    dataset.dropSource('감정평가 Agent · 3방식 가중평균');
    for (const label of ['공시지가 기준', '거래사례비교법', '수익환원법']) dataset.dropSource(`감정평가 Agent · ${label}`);
    dataset.addMany(appraisal.output.facts);
    dataset.resolve();
    saveDataset(projectId, dataset);
    store.writeJson(projectId, '04_Property/appraisal.json', appraisal.output);
    if (appraisal.output.concluded) {
      log(`  감정평가(참고): ${appraisal.output.concluded.valueEok}억원 · ${appraisal.output.concluded.methodsUsed.join('/')}`);
    }
  }

  // ── 09 Massing / 3D ───────────────────────────────────────
  const massing = await runAgent('09_massing', { projectId, geo: geo.output || null }, ctx);
  results['09_massing'] = massing;
  if (massing.output) {
    dataset.dropSource('매스 검토 Agent (09_massing)');
    dataset.addMany(massing.output.facts);
    dataset.resolve();
    saveDataset(projectId, dataset);
    store.writeJson(projectId, '04_Property/massing.json', massing.output);
    if (massing.output.model) {
      log(`  매스: 지상 ${massing.output.model.floors}층 · 높이 ${massing.output.model.heightM}m · ${massing.output.files.length}개 파일`);
    }
  }

  // ── 05 Cross Validation ───────────────────────────────────
  const val = await runAgent('05_validation', {
    projectId,
    financial: fin.output || null,
    research: res.output || null,
    appraisal: appraisal.output || null,
    massing: massing.output || null,
  }, ctx);
  results['05_validation'] = val;
  if (val.output) {
    store.writeJson(projectId, '11_QC/validation.json', val.output);
    log(`  검증: ${val.output.verdict} · RED ${val.output.summary.red} / YELLOW ${val.output.summary.yellow} · Score ${val.output.score.total}/100`);
  }

  // ── 06 IM Writer ──────────────────────────────────────────
  const writer = await runAgent('06_im_writer', {
    projectId,
    docType: opts.docType || null,
    financial: fin.output || null,
    research: res.output || null,
    validation: val.output || null,
    geo: geo.output || null,
    appraisal: appraisal.output || null,
    massing: massing.output || null,
  }, ctx);
  results['06_im_writer'] = writer;
  if (writer.output) {
    store.writeText(projectId, '09_IM/im.md', writer.output.im);
    store.writeText(projectId, '10_Teaser/teaser.md', writer.output.teaser);
    // PDI 핸드오프 규격 산출물: 자립형 A4 HTML + 기존 뷰어용 content.json
    if (writer.output.html) store.writeText(projectId, '12_Final/im-a4.html', writer.output.html);
    if (writer.output.content) store.writeJson(projectId, '12_Final/content.json', writer.output.content);
    if (writer.output.theme) {
      designState.writeThemeAssets(projectId, writer.output.theme);
      store.writeJson(projectId, '12_Final/layouts.json', writer.output.layouts || []);
    }
    store.writeJson(projectId, '09_IM/im.json', {
      at: writer.output.generatedAt,
      sections: writer.output.sections,
      citations: writer.output.citations,
      unsourcedNumbers: writer.output.unsourcedNumbers,
      designViolations: writer.output.designViolations || [],
    });
    const dv = (writer.output.designViolations || []).filter(v => v.severity === 'RED').length;
    log(`  디자인: ${writer.output.theme.label} (${writer.output.theme.id}) · ${writer.output.theme.docType}`);
    log(`  IM 생성: ${writer.output.sections.length}개 절 / 인용 ${writer.output.citations.length}건 / 출처없는숫자 ${writer.output.unsourcedNumbers.length}건 / 디자인위반 ${dv}건`);
  }

  // ── 승인 게이트 판정 (승인은 사람이 별도로 한다) ───────────
  const check = gate.canApprove(projectId);
  const project = store.readJson(projectId, '01_Project/project.json', {});
  store.writeJson(projectId, '01_Project/project.json', {
    ...project,
    status: check.allowed ? 'awaiting_approval' : 'blocked',
    lastRunAt: kstStamp(),
  });

  log(check.allowed
    ? '  승인 대기: 사람 승인 후 배포 가능 (cli.js approve)'
    : `  배포 차단: ${check.reasons.join(' / ')}`);

  return { projectId, templateId, results, dataset, gate: check };
}

module.exports = { run, loadDataset, saveDataset };
