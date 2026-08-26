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
const linked = require('./core/linked');
const agentMerge = require('./core/agent-merge');
const assetclass = require('./core/assetclass');
const pdf = require('./core/pdf');
const deskappraisal = require('./core/deskappraisal');
const corpreport = require('./core/corpreport');
const nts = require('./connectors/nts');
const nps = require('./connectors/nps');
const a4 = require('./design/a4');
const path = require('path');

/**
 * 본체가 준 「연결 자료 내려받기」를 찾는다.
 *   opts.fetchLinked  — 같은 프로세스에서 부를 때 (함수)
 *   IM_LINKED_FETCHER — cli.js 가 자식 프로세스로 돌 때 (모듈 경로: `module.exports.fetchLinked`)
 * 없으면 null — 그때 파이프라인은 연결 자료를 **읽지 않고 그 사실을 경고로 세운다.**
 * 있는데 모양이 틀리면 조용히 null 로 두지 않고 던진다 — 붙였다고 믿는데 안 붙은 상태가 제일 나쁘다.
 */
function resolveLinkedFetcher(opts = {}) {
  if (typeof opts.fetchLinked === 'function') return opts.fetchLinked;
  const mod = process.env.IM_LINKED_FETCHER;
  if (!mod) return null;
  let m;
  try { m = require(path.resolve(mod)); } catch (e) { throw new Error(`IM_LINKED_FETCHER 모듈을 읽을 수 없다 (${mod}): ${e.message}`); }
  if (!m || typeof m.fetchLinked !== 'function') throw new Error(`IM_LINKED_FETCHER 모듈에 fetchLinked 함수가 없다 (${mod})`);
  return m.fetchLinked;
}

/**
 * 추출 결과를 dataset 에 넣고 저장한다 — run() 과 extractInto() 가 **같은 코드**를 쓴다 (D-68).
 * 본체가 이 절차를 복제하면 엔진이 바뀌는 날 본체만 옛말을 한다.
 *   옛 추출값 버리기(같은 문서) → 병합 → resolve → 저장 → 01_Project/extraction.json 갱신
 */
function mergeExtraction(projectId, dataset, out, opts = {}) {
  const log = opts.log || (() => {});
  // 재실행 시 같은 문서의 옛 추출값을 먼저 버린다 (자기 자신과의 충돌 방지)
  for (const doc of out.documents) dataset.dropSource(doc.name);
  dataset.addMany(out.facts);
  dataset.resolve();
  saveDataset(projectId, dataset);
  // ※ 메타파일은 02_Source_Data 밖에 쓴다 — 원본자료 폴더를 오염시키면 다음 실행에서 자신을 다시 읽는다
  // 부분 추출(extractInto)일 때 이전 문서 목록을 지우지 않는다 — 같은 이름은 새것으로 바꾼다
  /**
   * ★★★ **아무것도 안 읽었으면 기록을 덮지 않는다** 〈2026-08-25 · 실측으로 찾았다〉.
   *
   *   1회성으로 올린 자료를 스캔하면 값은 `dataset.json` 에 **그대로 남는다** —
   *   실측했다(3개 뽑고 원본을 지운 뒤에도 3개가 살아 있었다). 그러니
   *   「원본을 지워서 값이 사라진다」는 말은 **사실이 아니다.**
   *
   *   ★ 사라지는 것은 **읽었다는 기록**이다. 그 뒤 보고서를 생성하면
   *     `02_Source_Data` 가 비어 있으니 02 가 0건을 돌려주고, 그 0 이
   *     `extraction.json` 을 **`factCount: 0` 으로 덮어썼다.**
   *
   *   ★★ 그러면 화면이 「자료 N건을 읽어 값 M개를 뽑았다」를 **못 말한다.**
   *     값은 멀쩡히 있는데 화면은 읽은 적이 없다고 한다 — M-32 · M-34 와
   *     똑같은 결이다. **지울 것이 없는데 기록만 지운 것이다.**
   *
   * ★ 그래서 **이번 실행이 아무것도 안 읽었으면 그대로 둔다.** 덮는 것은
   *   실제로 읽은 것이 있을 때뿐이다.
   */
  const readNothing = !out.documents.length && !out.facts.length;
  const kept = readNothing ? store.readJson(projectId, '01_Project/extraction.json', null) : null;
  if (kept) {
    /* ★ 다만 **못 읽은 것은 새로 적는다.** 「연결 자료가 안 붙어 있다」 같은
     *   경고는 이번 실행의 사실이라 앞 판 것을 그대로 두면 안 된다 —
     *   조기 반환으로 이것까지 삼켰다가 검사가 잡았다 */
    store.writeJson(projectId, '01_Project/extraction.json', {
      at: kept.at || kstStamp(),
      documents: kept.documents || [],
      unsupported: out.unsupported,
      factCount: kept.factCount || 0,
    });
    log(`  추출: 이번에는 읽은 것이 없다 — 앞서 읽은 기록(자료 ${(kept.documents || []).length}건 · 값 ${kept.factCount || 0}개)을 그대로 둔다`);
    return { facts: [], documents: [], unsupported: out.unsupported };
  }

  const prev = opts.merge ? (store.readJson(projectId, '01_Project/extraction.json', null) || {}) : {};
  const byName = new Map((prev.documents || []).map(d => [d.name, d]));
  for (const d of out.documents) byName.set(d.name, d);
  const unsupNames = new Set(out.unsupported.map(u => u.name));
  const unsupported = (prev.unsupported || []).filter(u => !unsupNames.has(u.name)).concat(out.unsupported);
  const documents = Array.from(byName.values());
  store.writeJson(projectId, '01_Project/extraction.json', {
    at: kstStamp(), documents, unsupported,
    factCount: opts.merge ? (prev.factCount || 0) + out.facts.length : out.facts.length,
  });
  log(`  추출: ${out.facts.length}건 / 문서 ${out.documents.length}건 / 미지원 ${out.unsupported.length}건`);
  return { facts: out.facts, documents: out.documents, unsupported: out.unsupported };
}

/**
 * 파일 목록을 읽어 이 프로젝트의 dataset 에 넣는다 — 1회성 업로드(oneshot)의 읽는 경로 (D-68 · §6-2).
 * 본체는 `extractOneshot: (id, files) => pipeline.extractInto(id, files)` 한 줄이면 된다.
 * files 는 {name, path, size, ext} — OS 임시 폴더의 실제 파일. **여기서는 지우지 않는다**(부른 쪽이 dispose 한다).
 * @returns {{facts, documents, unsupported}}
 */
async function extractInto(projectId, files, opts = {}) {
  if (!store.exists(projectId)) throw new Error(`프로젝트 없음: ${projectId}`);
  /**
   * ★★★ **빈 목록을 「읽을 것이 없다」로 넘기지 않는다** 〈2026-08-25 · 사장님
   *   권고 ③ 「0개 수집자료」를 따라가다 잡았다〉.
   *
   *   앞 판은 `Array.isArray(files) ? files : []` 였다. 그래서 `null` 을 주면
   *   **빈 배열**이 되어 그대로 넘어갔는데, 받는 쪽은 `input.files || 목록()` 으로
   *   판단한다 — **빈 배열도 참**이라 목록을 안 부른다.
   *   결과는 **「추출: 0건 / 문서 0건 / 미지원 0건」 — 성공으로 끝난다.**
   *   자료가 폴더에 그대로 있는데도 한 글자도 안 읽고, 오류도 안 난다.
   *
   * ★ 그래서 **줄 것이 있을 때만 준다.** 안 주면 받는 쪽이 프로젝트 폴더를
   *   훑고, 거기도 비었으면 그때 「원본자료가 없다」고 말한다 — 그게 사실이다.
   * ★ 「목록을 줬는데 비어 있다」는 부른 쪽의 실수일 수 있으므로 **말한다.**
   *   조용히 폴더를 훑으면 「0건인데 값이 나왔다」로 보여 더 헷갈린다.
   */
  const given = Array.isArray(files) ? files : null;
  const list = (given && given.length) ? given : null;
  const log = opts.log || (() => {});
  if (given && !given.length) {
    log('  추출: 빈 목록이 왔다 — 프로젝트의 원본자료를 대신 훑는다');
  }
  const dataset = loadDataset(projectId);
  /* ★ `onFile` 은 **읽는 동안 진행을 흘리는 길**이다 (D-99 · 사장님: 「스캔하는데
   *   너무 오래걸림」). 안 주면 아무 일도 안 한다 — 진행을 어디에 적을지는
   *   부른 쪽이 정한다. 읽기는 그것을 모른다 */
  const ctx = { projectId, dataset, log, onFile: opts.onFile };
  /* ★ `files` 를 **아예 안 보낸다** — 빈 배열을 보내면 받는 쪽이 목록을 안 부른다 */
  const input = { projectId, useLlm: opts.useLlm !== false };
  if (list) input.files = list;
  const r = await runAgent('02_extraction', input, ctx);
  if (!r.output || !r.output.facts) throw new Error(`추출 실패: ${(r.error && r.error.message) || r.status || 'unknown'}`);
  return mergeExtraction(projectId, dataset, r.output, { log, merge: true });
}

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

  // ── 02-0 연결 자료 — 보관하지 않는 쪽 (D-65 · 플랫폼-연결-지시서 §6-1) ────
  //   장부(linked.json)에 연결된 자료가 있으면 **여기서 실제로 가져와** 추출기에 넘긴다.
  //   가져오는 함수는 본체가 준다(opts.fetchLinked 또는 IM_LINKED_FETCHER 모듈) — 토큰이 그쪽에 있다.
  //   ★ 없으면 조용히 건너뛰지 않는다: 연결은 돼 있는데 안 읽힌 채 보고서가 나가면
  //     사용자는 「넣었다」고 믿는다. 경고를 세우고 추출기 unsupported 에도 올린다.
  const projectDir = store.projectDir(projectId);
  const fetchLinked = resolveLinkedFetcher(opts);
  const linkedItems = linked.list(projectDir).items;
  let linkedMat = null;
  const linkedFailed = [];
  if (linkedItems.length) {
    if (!fetchLinked) {
      for (const it of linkedItems) linkedFailed.push({ key: it.key, name: it.name, reason: '저장소 내려받기(fetchLinked)가 붙어 있지 않습니다' });
      log(`  연결 자료 ${linkedItems.length}건 — 내려받기가 붙어 있지 않아 읽지 않는다 (경고로 남긴다)`);
    } else {
      linkedMat = await linked.materialize(projectDir, fetchLinked);
      for (const f of linkedMat.failed) linkedFailed.push(f);
      log(`  연결 자료: 가져옴 ${linkedMat.files.length}건 / 실패 ${linkedMat.failed.length}건 (임시 ${linkedMat.dir})`);
    }
  }

  // ── 02 Extraction ─────────────────────────────────────────
  let ext;
  try {
    ext = await runAgent('02_extraction', {
      projectId, useLlm: opts.useLlm !== false,
      extraFiles: linkedMat ? linkedMat.files : [],
      linkedFailed,
    }, ctx);
  } finally {
    // ★ 읽고 나면 **반드시** 지운다 — 안 지우면 그것이 곧 보관이다. 추출기가 던져도 지운다.
    if (linkedMat) { const d = linkedMat.dispose(); log(`  연결 자료 임시 파일 정리: ${d.removed}건`); }
  }
  results['02_extraction'] = ext;
  if (ext.output && ext.output.facts) {
    mergeExtraction(projectId, dataset, ext.output, { log });
  }

  // ── 07 Geo / Satellite (공공데이터 — 지적·공시지가·건축물대장) ──
  // 다른 Agent보다 먼저 돈다: 여기서 확보한 PNU/좌표가 감정평가·매스의 입력이다.
  const geo = await runAgent('07_geo', { projectId, templateId: templateId || null }, ctx);
  results['07_geo'] = geo;
  if (geo.output) {
    // 병합 절차는 core/agent-merge.js 한 곳에만 있다 — 여기에 다시 적지 않는다 (D-68)
    agentMerge.apply(projectId, '07_geo', geo.output, dataset, { save: saveDataset });
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
    // ★ 서술(sections)이 아니라 **실측 지표만** Dataset 에 들어간다.
    //   LLM 기억은 여기로 오지 않는다 — 03-research.js 머리말의 ①/② 구분 참고.
    //   병합 규칙은 core/agent-merge.js 가 갖는다 (오케스트레이터와 같은 것을 쓴다)
    const rm = agentMerge.apply(projectId, '03_research', res.output, dataset, { save: saveDataset });
    if (rm.merged) log(`  시장지표: ${rm.merged}건 (출처 있는 실측값)`);

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
    // 계산값은 매 실행마다 새로 산출된다 — 옛 계산값을 버리지 않으면 자기 자신과 충돌한다.
    // 버릴 출처 이름은 core/agent-merge.js 가 갖는다 (여기와 오케스트레이터가 같은 것을 쓴다)
    agentMerge.apply(projectId, '04_financial', fin.output, dataset, { save: saveDataset });
    const base = fin.output.scenarios.base.metrics;
    log(`  재무모델: Project IRR ${base.projectIRR}% / Equity IRR ${base.equityIRR}% / minDSCR ${base.minDSCR} (가정치 ${fin.output.assumed.length}건)`);
  }

  // ── 08 Appraisal (감정평가 — 수익환원법에 재무모델 NOI가 필요하므로 04 이후) ──
  const appraisal = await runAgent('08_appraisal', { projectId, financial: fin.output || null }, ctx);
  results['08_appraisal'] = appraisal;
  if (appraisal.output) {
    agentMerge.apply(projectId, '08_appraisal', appraisal.output, dataset, { save: saveDataset });
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

    // ── 법인가치 검토 보고서 (등록부 D-59) ────────────────
    //
    // ★ **대부분의 딜에서 안 만들어지는 것이 정상이다.** DART 는 공시대상회사만
    //   수록하고 시행사 SPC 는 원래 거기 없다 — 재무자료를 제출받아야 한다.
    //   그래서 「만들지 않았다」가 결함이 아니라는 사실을 로그가 말해 준다.
    // ★ **재무제표와 무관한 두 번째 출처** (D-60). 휴폐업은 국세청만 알고
    //   인원·고지금액은 공단이 부과한 값이다 — 회사가 만든 숫자가 아니다.
    // ★ **한 쪽이 죽어도 나머지를 돌린다** (§4.6). 실재 점검이 실패했다고
    //   법인 보고서 전체를 세우지 않는다
    const existence = {};
    const bizNo = strOf('corp.biz_no');
    if (bizNo) {
      const st = await nts.status(bizNo).catch(e => ({ ok: false, error: e.message }));
      existence.status = st.ok ? st.value : { text: `조회하지 못했다 — ${st.error}` };
    }
    const corpNm = strOf('corp.name') || strOf('project.sponsor');
    if (corpNm) {
      const wp = await nps.findWorkplace(corpNm).catch(e => ({ ok: false, error: e.message }));
      if (wp.ok) {
        const d = await nps.workplaceDetail(wp.value.seq).catch(e => ({ ok: false, error: e.message }));
        existence.workplace = d.ok ? d.value : { text: `상세를 못 받았다 — ${d.error}` };
      } else if (wp.ambiguous) {
        // ★ 고르지 않는다 — 엉뚱한 회사의 인원이 실사 보고서에 실리면 안 된다
        existence.workplace = { text: `동명 사업장 ${wp.candidates.length}건 — **고르지 않았다.** 사람이 특정한다` };
      } else if (wp.notFound) {
        existence.workplace = { text: wp.error };
      }
    }
    existence.clearance = strOf('corp.tax_clearance');

    const cr = corpreport.build({
      projectId,
      existence,
      corpName: strOf('corp.name') || strOf('project.sponsor'),
      shares: dataset.num('corp.shares'),
      netAsset: dataset.num('corp.net_asset'),
      income1: dataset.num('corp.net_income_1'),
      income2: dataset.num('corp.net_income_2'),
      income3: dataset.num('corp.net_income_3'),
      realEstatePct: dataset.num('corp.real_estate_pct'),
    });

    if (cr.ok) {
      store.writeText(projectId, '10_Corporate/corp-review.md', cr.markdown);
      const chtml = a4.render({
        projectId,
        projectName: cr.sections ? (strOf('corp.name') || strOf('project.sponsor')) : projectId,
        docType: 'corp_valuation',
        docTitle: '법인가치 검토 보고서',
        docLabel: '법인가치 검토 ㅣ 평가의견서가 아님',
        valueRange: corpreport.coverValue(cr.conclusion),
        valueCaption: '참고 산정치 — 외부평가기관의 평가의견서가 아니다',
        sections: cr.sections,
        disclaimers: cr.disclaimers,
      });
      store.writeText(projectId, '10_Corporate/corp-review-a4.html', chtml);
      const crPdf = pdf.fromHtmlFile(
        path.join(store.projectDir(projectId), '10_Corporate/corp-review-a4.html'),
        { theme: 'institutional' },
      );
      log(`  법인검토: ${cr.sections.length}개 절 · 결론 ${cr.conclusion.mode}`
        + (cr.conclusion.mode === 'point' ? '' : ' (표지에 단일 값 없음)')
        + (crPdf.ok ? ` · PDF ${crPdf.pages ?? '?'}쪽` : ` · ⚠ PDF 실패: ${crPdf.reason}`));
    } else {
      log(`  법인검토: 만들지 않았다 — ${cr.reason}`);
    }
  }

  // ── 09 Massing / 3D ───────────────────────────────────────
  const massing = await runAgent('09_massing', { projectId, geo: geo.output || null }, ctx);
  results['09_massing'] = massing;
  if (massing.output) {
    agentMerge.apply(projectId, '09_massing', massing.output, dataset, { save: saveDataset });
    if (massing.output.model) {
      log(`  매스: 지상 ${massing.output.model.floors}층 · 높이 ${massing.output.model.heightM}m · ${massing.output.files.length}개 파일`);
    }
  }

  // ── 12 SketchUp Plan / 13 Intake (평면 A — D-95) ──────────
  // 평면 A 의 두 절반 — 계획을 내고, 사람이 만든 결과가 있으면 되받아 대조한다.
  // SketchUp MCP 는 여기서 부르지 않는다 (D-95 — 자동 실행에는 연결이 없다).
  // ★ 계획서에는 「무엇을 만들 수 있는가」와 「무엇을 만들어 달라고 적는가」가
  //   함께 들어간다 (D-101 합침) — 뒤엣것이 deliverables 다.
  const skPlan = await runAgent('12_sketchup_plan', { projectId, massing: massing.output || null }, ctx);
  results['12_sketchup_plan'] = skPlan;
  if (skPlan.output && skPlan.output.plan) {
    log(`  모델 계획: 지상 ${skPlan.output.plan.building.floors}층 · 층고 ${skPlan.output.plan.building.floor_height_mm}mm → 04_Property/model-plan.json`);
  }
  const asked = (skPlan.output && skPlan.output.deliverables) || [];
  if (asked.length) {
    const req = asked.filter((d) => d.status === 'requested').map((d) => d.label);
    const blocked = asked.filter((d) => d.status === 'blocked');
    log(`  시각자료 요청: ${req.length}건${req.length ? ` (${req.join('·')})` : ''}`
      + `${blocked.length ? ` · 못 만드는 것 ${blocked.length}건 — ${blocked.map((b) => b.label).join('·')}` : ''}`);
  }
  const skIntake = await runAgent('13_sketchup_intake', { projectId, plan: (skPlan.output && skPlan.output.plan) || null }, ctx);
  results['13_sketchup_intake'] = skIntake;
  if (skIntake.output && skIntake.output.status === 'received') {
    log(`  모델 수령: 파일 ${skIntake.output.result.files}건 · 렌더 ${skIntake.output.result.renders}건 · solid ${skIntake.output.result.solid || '미기재'}`);
  }

  // ── 18 Legal & Permit (D-113) ─────────────────────────────
  // ★ 여기가 자리인 이유: 매스가 선 뒤라야 「그 한도로 세운 것」을 댈 수 있고,
  //   값 검증 앞이라야 05 가 그 판정을 받아 쓴다.
  const legal = await runAgent('18_legal', {
    projectId,
    geo: geo.output || null,
    massing: massing.output || null,
  }, ctx);
  results['18_legal'] = legal;
  /* ★★ **결과를 실제로 쓴다** 〈2026-08-26 · agent:check 여섯째 칸이 잡았다〉.
   *   앞 판은 `results` 에 담기만 했다 — 그러면 **돌기만 하고 아무것도 안 바꾼다.**
   *   `15_design` 과 똑같은 구멍이었고, 그 칸을 만들면서 이것이 드러났다. */
  if (legal.output) {
    store.writeJson(projectId, '03_Legal/legal.json', legal.output);
    const st = legal.output.status === 'reviewed'
      ? `조례 후보 ${legal.output.ordinanceCandidates.length}건`
      : `조회 못 함 — ${legal.output.unavailableReason || '까닭 모름'}`;
    log(`  인허가·법률 기록: 03_Legal/legal.json · ${st}`);
  }

  // ── 05 Cross Validation ───────────────────────────────────
  const val = await runAgent('05_validation', {
    projectId,
    financial: fin.output || null,
    research: res.output || null,
    geo: geo.output || null,
    appraisal: appraisal.output || null,
    massing: massing.output || null,
    sketchup: skIntake.output || null,
    sketchupPlan: skPlan.output || null,
    // ★ 조례 한도를 확인했는지를 값 검증이 받아 쓴다 — 안 넘기면 05 가
    //   확인 안 된 시행령 값으로 판정한다 (D-113)
    legal: legal.output || null,
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
    // ★ AI 렌더를 본문에 싣는다 (D-34 2차 개정) — 표기가 온전한 것만 넘어온다
    intake: skIntake.output || null,
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
      } else if (r.fontNote) {
        // ★ 경고가 아니다 — **어떤 활자로 나갔는지**를 남긴다. 이걸 안 적으면
        //   같은 문서를 다른 기계에서 다시 만들었을 때 왜 달라졌는지 알 수 없다
        log(`    · 글꼴: ${r.fontNote}`);
      }
    }
  }

  // ── 15 Design Manager (D-123) ─────────────────────────────
  // ★ 지시서 §8.4 — 기능이 돌아도 DESIGN_VERIFIED 를 통과하지 못하면
  //   완료로 치지 않는다. 그래서 최종검증 **앞**에 선다.
  const design = await runAgent('15_design', {
    projectId,
    writer: writer.output || null,
    massing: massing.output || null,
    intake: skIntake.output || null,
  }, ctx);
  results['15_design'] = design;
  if (design.output) {
    store.writeJson(projectId, '11_QC/design-verified.json', design.output);
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
    // ★ 지시서 §8.4 — 이 판정을 못 들으면 「기능은 되는데 디자인은 안 본」
    //   문서가 완료로 나간다 (D-123)
    design: design.output || null,
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

module.exports = { run, loadDataset, saveDataset, extractInto, mergeExtraction, resolveLinkedFetcher };
