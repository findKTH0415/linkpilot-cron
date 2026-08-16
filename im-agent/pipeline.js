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
const reports = require('./core/reports');
const monitor = require('./core/monitor');
const { kstStamp } = require('./core/kst');
const assetclass = require('./core/assetclass');
const pdf = require('./core/pdf');
const deskappraisal = require('./core/deskappraisal');
const a4 = require('./design/a4');
const path = require('path');

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
  let pdfResult = null;
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

  // Control Tower 시작 — 이후 모든 Agent 상태가 실시간으로 기록된다
  monitor.start(projectId);
  // 기존 프로젝트를 재실행하는 경우 01_project 는 이미 끝난 상태다 (WAITING 으로 남으면 진행률이 왜곡된다)
  if (opts.projectId) {
    monitor.update(projectId, '01_project', {
      status: monitor.STATUS.COMPLETED, progress: 100, activity: '기존 프로젝트 (재실행)',
    });
  }

  // ── 10 Output Specification (콘텐츠보다 먼저) ──────────────
  // 출력 사양이 확정되기 전에는 최종 산출물을 만들지 않는다. 초안(DRAFT)까지만 만든다.
  const specRes = await runAgent('10_output_spec', { projectId, docType: opts.docType || null }, ctx);
  results['10_output_spec'] = specRes;
  const spec = specRes.output ? specRes.output.spec : null;
  if (spec) {
    log(`  출력사양: ${spec.docType} · ${spec.pageSize} ${spec.orientation} · 목표 ${spec.targetPages}p · ${spec.formats.join('/')} · ${spec.locked ? `${spec.version} LOCKED` : 'DRAFT(미확정)'}`);
  }

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
  const geo = await runAgent('07_geo', { projectId, templateId: templateId || null }, ctx);
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
    templateId: templateId || null,
    location: locationFact ? String(locationFact.value) : null,
    projectName: nameFact ? String(nameFact.value) : projectId,
  }, ctx);
  results['03_research'] = res;
  if (res.output) {
    store.writeJson(projectId, '05_Market/research.json', res.output);
    // ★ 서술(sections)이 아니라 **실측 지표만** Dataset 에 들어간다.
    //   LLM 기억은 여기로 오지 않는다 — 03-research.js 머리말의 ①/② 구분 참고.
    if (res.output.facts && res.output.facts.length) {
      dataset.dropSource('REC 현물시장(한국전력거래소)');
      for (const f of res.output.facts) dataset.dropSource(f.source);
      dataset.addMany(res.output.facts);
      dataset.resolve();
      saveDataset(projectId, dataset);
      log(`  시장지표: ${res.output.facts.length}건 (출처 있는 실측값)`);
    }

    // ★ 대조는 **facts 가 아니다.** Dataset 에 넣지 않고 따로 남긴다 —
    //   넣는 순간 대조값이 딜의 값으로 IM 에 실린다 (등록부 D-48).
    const checks = res.output.crosschecks || [];
    if (checks.length) {
      store.writeJson(projectId, '05_Market/crosschecks.json', { checks });
      const done = checks.filter(c => c.status === 'ok');
      const skipped = checks.filter(c => c.status === 'skipped');
      const review = checks.filter(c => c.status === 'needs_review' || c.status === 'ambiguous');

      // ★ **묻는 딜에서만 「미선택」을 시끄럽게 말한다.**
      //   제조 딜은 화면이 이 값들을 물어본다 — 비워 두면 그 사실을 알려야 한다.
      //   데이터센터·호텔 딜은 애초에 묻지도 않으므로 매번 5줄이 뜨면 그냥 소음이고,
      //   소음이 쌓이면 **진짜 경고도 같이 안 읽힌다.**
      //   ★ 자산군이 **안 정해지는 것이 정상인 경우가 있다** — 「제조」와 「공장」이
      //     함께 읽히면 고르지 않는다(§4.9). 그때 자산군만 보면 제조 딜인데도
      //     안내가 통째로 빠진다. 재무 템플릿은 그때도 정해져 있으므로 함께 본다
      const project = store.readJson(projectId, '01_Project/project.json', null);
      const asks = assetclass.asksCrosschecks(project && project.assetClass, templateId);

      if (done.length || review.length || asks) {
        log(`  대조: ${done.length}건 · 확인필요 ${review.length}건 · 미선택 ${skipped.length}건`
          + (asks && skipped.length ? ` (${skipped.map(c => c.label).join(' · ')})` : ''));
        done.forEach(c => log(`    · ${c.label}: ${c.text}`));
        review.forEach(c => log(`    ⚠ ${c.label}: ${c.reason || c.text || ''}`));
        if (asks && skipped.length) {
          log('    ※ 미선택은 「대조했는데 문제 없었다」가 아니다 — 가이드 필드에서 대상을 고르면 돈다');
        }
      }
    }
  }

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

    // ── 탁상검토 보고서 (등록부 D-57) ──────────────────────
    //
    // ★ 08 은 계산까지만 하고 **문서가 없었다.** 토지가치만 따로 묻는 자리
    //   (대주단 사전검토·투심 전 단계)에서 IM 40쪽을 통째로 돌릴 수는 없다.
    // ★ **감정평가서가 아니다** — 표지·고지·본문 세 곳에 그 사실이 들어간다.
    // ★ `Dataset` 에는 `num` 만 있고 문자열 접근자가 없다. **`dataset.str &&` 로
    //   감싸 두었더니 소재지·PNU·용도지역이 통째로 빈 채로 문서가 나왔다** —
    //   오류도 경고도 없이 「[미확인]」만 남아서 자료가 없는 것처럼 보였다
    const strOf = (key) => {
      const f = dataset.get(key);
      const v = f && f.value !== undefined && f.value !== null ? String(f.value).trim() : '';
      return v || null;
    };

    const dr = deskappraisal.build({
      projectId,
      projectName: (store.readJson(projectId, '01_Project/project.json', {}) || {}).name,
      location: strOf('project.location'),
      pnu: strOf('geo.pnu'),
      areaSqm: dataset.num('land.area_sqm'),
      zoning: strOf('land.zoning'),
      useDistricts: strOf('land.use_districts'),
      appraisal: appraisal.output,
    });

    if (dr.ok) {
      store.writeText(projectId, '08_Appraisal/desk-review.md', dr.markdown);
      const html = a4.render({
        projectId,
        projectName: (store.readJson(projectId, '01_Project/project.json', {}) || {}).name || projectId,
        docType: 'desk_appraisal',
        docTitle: '토지가치 탁상검토 보고서',
        // ★ 표지가 문서의 성격을 말한다 — 여기가 IM 문구면 IM 처럼 읽힌다
        docLabel: '탁상검토 보고서 ㅣ 감정평가서가 아님',
        valueRange: deskappraisal.coverValue(dr.conclusion),
        valueCaption: '참고 산정치 — 감정평가법인등의 평가가 아니다',
        location: strOf('project.location'),
        sections: dr.sections,
        disclaimers: dr.disclaimers,
      });
      store.writeText(projectId, '08_Appraisal/desk-review-a4.html', html);

      const drPdf = pdf.fromHtmlFile(
        path.join(store.projectDir(projectId), '08_Appraisal/desk-review-a4.html'),
        { theme: 'institutional' },
      );
      // ★ 표지에 숫자를 안 올린 경우가 **정상 동작**이다 — 왜 그런지 함께 찍는다
      log(`  탁상검토: ${dr.sections.length}개 절 · 결론 ${dr.conclusion.mode}`
        + (dr.conclusion.mode === 'point' ? '' : ` (표지에 단일 값 없음 — ${dr.conclusion.text})`)
        + (drPdf.ok ? ` · PDF ${drPdf.pages ?? '?'}쪽` : ` · ⚠ PDF 실패: ${drPdf.reason}`));
    } else {
      // ★ 조용히 넘어가지 않는다. 빈 평가서를 만들지 않는 것이 의도다
      log(`  탁상검토: 만들지 않았다 — ${dr.reason}`);
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
    geo: geo.output || null,
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

    // ── PDF (등록부 D-53) ────────────────────────────────────
    // ★ `outputspec` 이 `formats: ['pdf']` 라고 선언해 온 것을 **실제로 만든다.**
    //   새 의존성은 없다 — 이미 쓰는 헤드리스 크로미움에 `--print-to-pdf` 다.
    if (writer.output.html && (!spec || (spec.formats || []).includes('pdf'))) {
      const htmlPath = path.join(store.projectDir(projectId), '12_Final/im-a4.html');
      const r = pdf.fromHtmlFile(htmlPath, { theme: writer.output.theme });
      pdfResult = r;

      if (r.ok) {
        // ★ 경로를 **손으로 적지 않는다.** 파일명은 HTML 에서 파생되는데
        //   로그에 다른 이름을 박아 두면 화면만 옛말을 한다 (실제로 그랬다)
        const rel = path.relative(store.projectDir(projectId), r.path);
        log(`  PDF: ${r.pages ?? '?'}쪽 · ${Math.round(r.bytes / 1024)}KB → ${rel}`);
        // ★ 쪽수는 **막지 않는다.** 사양은 목표이고 쪽수는 내용이 정한다 —
        //   다만 크게 벗어나면 빠진 절이 있다는 신호다
        const pc = pdf.pageCheck(r.pages, spec);
        if (pc) log(`    ⚠ ${pc}`);
      } else {
        // ★ 조용히 넘어가지 않는다. HTML 은 남아 있으므로 파이프라인은 계속 간다
        log(`    ⚠ PDF 를 만들지 못했다: ${r.reason}`);
      }

      // ★ **글꼴은 PDF 성패와 별개다.** PDF 는 나왔는데 활자가 요청과 다를 수 있다 —
      //   실제로 한글이 중국어 글꼴로 박혀 있었다 (D-52). 조용히 두지 않는다
      if (r.fontOk === false) {
        log(`    ⚠ 글꼴: ${r.fontReason}`);
      }
    }
  }

  // ── 11 Final Validation (독립 제3자 검증 · 8 GATES) ────────
  const final = await runAgent('11_final_validation', {
    projectId,
    financial: fin.output || null,
    validation: val.output || null,
    writer: writer.output || null,
    geo: geo.output || null,
    appraisal: appraisal.output || null,
    massing: massing.output || null,
    research: res.output || null,
  }, ctx);
  results['11_final_validation'] = final;
  if (final.output) {
    store.writeJson(projectId, '11_QC/final-validation.json', final.output);
    store.writeText(projectId, '11_QC/validation-report.md', reports.validationReport(projectId, final.output, spec));
    store.writeText(projectId, '11_QC/red-flag-report.md', reports.redFlagReport(projectId, final.output));
    store.writeText(projectId, '11_QC/traceability-report.md', reports.traceabilityReport(projectId, final.output));
    store.writeJson(projectId, '12_Final/manifest.json', reports.manifest(projectId, { spec, writer: writer.output, final: final.output, theme: writer.output && writer.output.theme }));

    const g = final.output.summary;
    log(`  최종검증: ${final.output.status} · ${final.output.score.total}/100 · GATE ${g.gatesPassed}/${g.gatesTotal} 통과 · CRITICAL ${g.critical} / MAJOR ${g.major} / MINOR ${g.minor}`);
    if (final.output.calculation) {
      log(`  독립 재계산: ${final.output.calculation.worst} (Newton-Raphson 역산)`);
    }
  }

  // ── 승인 게이트 판정 (승인은 사람이 별도로 한다) ───────────
  const check = gate.canApprove(projectId);
  const project = store.readJson(projectId, '01_Project/project.json', {});
  store.writeJson(projectId, '01_Project/project.json', {
    ...project,
    status: check.allowed ? 'awaiting_approval' : 'blocked',
    lastRunAt: kstStamp(),
  });

  monitor.finish(projectId);
  const snap = monitor.snapshot(projectId);
  store.writeJson(projectId, '01_Project/control-tower.json', snap);

  log(`  진행률: 전체 ${snap.overall}% (제작 ${snap.tracks.production.pct}% · 검증 ${snap.tracks.validation.pct}% · 산출 ${snap.tracks.output.pct}% · 승인 ${snap.tracks.approval.pct}%) · ${snap.health.mark} ${snap.health.level}`);
  log(check.allowed
    ? '  승인 대기: 사람 승인 후 배포 가능 (cli.js approve)'
    : `  배포 차단: ${check.reasons.join(' / ')}`);

  return { projectId, templateId, results, dataset, gate: check, finalValidation: final.output || null, spec };
}

module.exports = { run, loadDataset, saveDataset };
