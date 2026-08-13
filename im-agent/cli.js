#!/usr/bin/env node
'use strict';
/**
 * cli.js — LinkPilot IM Agent 실행기.
 *
 *   node im-agent/cli.js new "인천 남동공단 6.5MW 데이터센터 개발사업 IM 작성"
 *   node im-agent/cli.js run LP-DC-2026-001
 *   node im-agent/cli.js status LP-DC-2026-001
 *   node im-agent/cli.js agents
 *   node im-agent/cli.js approve LP-DC-2026-001 --by "김대표" --comment "IC 통과"
 *   node im-agent/cli.js demo          # 샘플 자료로 전체 흐름 1회 실행
 *
 * 환경변수:
 *   IM_AGENT_ROOT     프로젝트 저장 루트 (기본 ./im-projects)
 *   IM_AGENT_OFFLINE  1이면 LLM 호출 없이 결정적 경로만 실행
 *   IM_AGENT_DISABLE  끌 Agent 목록 (예: "03_research")
 *   GEMINI_API_KEY    LLM 사용 시 (GitHub Secrets)
 */

const fs = require('fs');
const path = require('path');
const pipeline = require('./pipeline');
const store = require('./core/store');
const registry = require('./core/registry');
const gate = require('./core/gate');
const { formatEok, pct, fmt } = require('./core/numeric');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function cmdNew(request) {
  if (!request) return fail('사용법: cli.js new "<요청문>"');
  const r = await pipeline.run({ request, log: m => console.log(m) });
  console.log(`\n프로젝트 ${r.projectId} 생성 완료.`);
  console.log(`원본자료를 ${path.join(store.projectDir(r.projectId), '02_Source_Data')} 에 넣고`);
  console.log(`  node im-agent/cli.js run ${r.projectId}\n을 실행하면 재추출된다.`);
}

async function cmdRun(projectId) {
  if (!projectId) return fail('사용법: cli.js run <PROJECT_ID>');
  const r = await pipeline.run({ projectId, log: m => console.log(m) });
  cmdStatus(r.projectId);
}

function cmdStatus(projectId) {
  if (!projectId) return fail('사용법: cli.js status <PROJECT_ID>');
  const project = store.readJson(projectId, '01_Project/project.json', null);
  if (!project) return fail(`프로젝트 없음: ${projectId}`);

  const val = store.readJson(projectId, '11_QC/validation.json', null);
  const fin = store.readJson(projectId, '07_Financial/financial.json', null);
  const im = store.readJson(projectId, '09_IM/im.json', null);
  const approval = gate.readApproval(projectId);

  console.log(`\n─ ${projectId} ─ ${project.name}`);
  console.log(`  자산유형   : ${project.assetType} (${project.templateId})`);
  console.log(`  상태       : ${project.status}`);

  if (fin) {
    const m = fin.scenarios.base.metrics;
    console.log(`  총사업비   : ${formatEok(m.totalProjectCost)} (차입 ${formatEok(m.debtAmount)} / 자본 ${formatEok(m.equityAmount)})`);
    console.log(`  Project IRR: ${pct(m.projectIRR)}   Equity IRR: ${pct(m.equityIRR)}   minDSCR: ${m.minDSCR ?? '-'}`);
    console.log(`  가정치     : ${fin.assumed.length}건 (문서 미확인)`);
  }
  if (val) {
    console.log(`  QC         : ${val.verdict} · Score ${val.score.total}/100 · RED ${val.summary.red} / YELLOW ${val.summary.yellow}`);
    for (const f of val.flags.filter(f => f.severity === 'RED').slice(0, 8)) console.log(`     [RED] ${f.message}`);
  }
  if (im) console.log(`  IM         : ${im.sections.length}개 절 · 인용 ${im.citations.length}건 · 출처없는숫자 ${im.unsourcedNumbers.length}건`);

  const g = gate.canApprove(projectId);
  console.log(`  승인 가능  : ${g.allowed ? 'YES' : 'NO — ' + g.reasons.join(' / ')}`);
  if (approval) console.log(`  승인 기록  : ${approval.decision} by ${approval.approver} (${approval.at})`);
  console.log('');
}

// ── 디자인 선택 (사양 §2·§6·§14·§15) ────────────────────────
function cmdDesign(sub, projectId) {
  const themes = require('./design/themes');
  const recommend = require('./design/recommend');
  const designState = require('./core/design-state');
  const a4 = require('./design/a4');

  if (!sub || sub === 'list') {
    console.log('\n  SELECT YOUR DESIGN\n');
    for (const t of themes.list()) {
      console.log(`  ${t.no}  ${t.id.padEnd(16)} ${t.label.padEnd(26)} ${t.labelKr}`);
      if (t.note) console.log(`      ${' '.repeat(16)} ※ ${t.note}`);
    }
    console.log('\n  추천: cli.js design recommend <PROJECT_ID>');
    console.log('  적용: cli.js design set <PROJECT_ID> --theme <id> --by "<이름>"');
    console.log('  미리보기: cli.js design preview --theme <id> [--doc teaser]\n');
    return;
  }

  if (sub === 'preview') {
    const themeId = arg('--theme', 'institutional');
    const docType = arg('--doc', 'im');
    if (!themes.get(themeId)) return fail(`알 수 없는 테마: ${themeId}`);
    const out = arg('--out', path.join(process.cwd(), `design-preview-${themeId}.html`));
    fs.writeFileSync(out, a4.preview(themeId, { docType }), 'utf8');
    console.log(`미리보기 생성: ${out}\n브라우저로 열어 확인한 뒤 design set 으로 적용한다.`);
    return;
  }

  if (sub === 'recommend') {
    if (!projectId) return fail('사용법: cli.js design recommend <PROJECT_ID> [--doc im] [--investor bank]');
    const project = store.readJson(projectId, '01_Project/project.json', null);
    if (!project) return fail(`프로젝트 없음: ${projectId}`);

    const r = recommend.recommend({
      assetType: project.assetType, templateId: project.templateId,
      projectName: project.name,
      docType: arg('--doc', 'im'),
      investorType: arg('--investor', null),
      transactionType: arg('--transaction', null),
      country: arg('--country', 'KR'),
    });
    console.log(`\n  BEST MATCH — ${project.name}\n`);
    r.recommendations.forEach((x, i) => {
      console.log(`  ${['①', '②', '③'][i] || (i + 1)} ${x.label} (${x.themeId}) — ${x.confidence}%`);
      console.log(`     ${x.labelKr} · ${x.purpose}`);
      if (x.reasons.length) console.log(`     근거: ${x.reasons.join(' / ')}`);
      console.log('');
    });
    console.log(`  판단 신호: ${JSON.stringify(r.signals)}\n`);
    return;
  }

  if (sub === 'set') {
    const themeId = arg('--theme');
    const by = arg('--by');
    if (!projectId || !themeId) return fail('사용법: cli.js design set <PROJECT_ID> --theme <id> [--doc im] [--by "<이름>"]');
    try {
      const st = designState.select(projectId, { themeId, docType: arg('--doc', null), by, note: arg('--note', '') });
      console.log(`디자인 적용: ${themes.get(themeId).label} (v${st.version})`);
      console.log(`  ※ 내용·수치는 그대로다. 재실행하면 새 디자인으로 다시 렌더된다:  cli.js run ${projectId}`);
    } catch (e) { fail(e.message); }
    return;
  }

  if (sub === 'history') {
    if (!projectId) return fail('사용법: cli.js design history <PROJECT_ID>');
    const st = designState.read(projectId);
    console.log(`\n  현재: v${st.version} ${st.themeId} (${st.docType})`);
    for (const h of [...st.history].reverse()) {
      console.log(`  이전: v${h.version} ${h.themeId} (${h.docType})${h.by ? ' by ' + h.by : ''}`);
    }
    console.log('');
    return;
  }

  if (sub === 'revert') {
    const version = arg('--version');
    if (!projectId || !version) return fail('사용법: cli.js design revert <PROJECT_ID> --version 1.0 --by "<이름>"');
    try {
      const st = designState.revert(projectId, version, arg('--by'));
      console.log(`디자인 복원: ${st.themeId} (v${st.version})`);
    } catch (e) { fail(e.message); }
    return;
  }

  fail(`알 수 없는 하위명령: ${sub} (list|recommend|preview|set|history|revert)`);
}

// ── 출력 사양 (사양 확정 → 콘텐츠 → 디자인 → 렌더 → QC) ──
function cmdSpec(sub, projectId) {
  const outputspec = require('./core/outputspec');

  if (sub === 'show' || !sub) {
    if (!projectId) return fail('사용법: cli.js spec show <PROJECT_ID>');
    const spec = outputspec.read(projectId);
    if (!spec) return fail('출력 사양이 없다 — cli.js spec propose <ID> 를 먼저 실행한다');
    const check = outputspec.validateSpec(spec);
    console.log(`\n  OUTPUT SPECIFICATION — ${projectId}\n`);
    const rows = [
      ['Document Type', `${spec.docType} (${spec.label})`],
      ['Page Size', `${spec.pageSize} ${spec.orientation}`],
      ['Target Pages', `${spec.targetPages} (${spec.minPages}~${spec.maxPages}, 허용 ±${spec.tolerance})`],
      ['Format', (spec.formats || []).join(', ')],
      ['Language', spec.language],
      ['Design Theme', spec.themeId || '-'],
      ['Resolution', `${spec.resolution} / ${spec.color}`],
      ['File Name', spec.fileName],
      ['Version', spec.version],
      ['Confidentiality', spec.confidentiality],
      ['Watermark', spec.watermark ? 'Yes' : 'No'],
      ['STATUS', spec.locked ? `LOCKED (확정: ${spec.confirmedBy})` : 'PENDING USER CONFIRMATION'],
    ];
    for (const [k, v] of rows) console.log(`  ${k.padEnd(18)} ${v}`);
    if (!check.ok) {
      console.log('\n  ※ 미확정 항목:');
      for (const p of check.problems) console.log(`     - ${p}`);
    }
    console.log(spec.locked ? '' : `\n  확정: cli.js spec confirm ${projectId} --by "<이름>"\n`);
    return;
  }

  if (sub === 'propose') {
    if (!projectId) return fail('사용법: cli.js spec propose <PROJECT_ID> [--doc im]');
    const spec = outputspec.propose(projectId, { docType: arg('--doc', 'im') });
    outputspec.save(projectId, spec);
    console.log(`출력 사양 제안 생성 (DRAFT). 확인: cli.js spec show ${projectId}`);
    return;
  }

  if (sub === 'set') {
    if (!projectId) return fail('사용법: cli.js spec set <PROJECT_ID> --pages 40 --size A4 --orientation portrait --formats html,json');
    const changes = {};
    if (arg('--pages')) changes.targetPages = Number(arg('--pages'));
    if (arg('--size')) changes.pageSize = arg('--size');
    if (arg('--orientation')) changes.orientation = arg('--orientation');
    if (arg('--formats')) changes.formats = arg('--formats').split(',').map(s => s.trim());
    if (arg('--language')) changes.language = arg('--language');
    if (arg('--doc')) changes.docType = arg('--doc');
    if (arg('--tolerance')) changes.tolerance = Number(arg('--tolerance'));
    if (!Object.keys(changes).length) return fail('변경할 항목이 없다');
    try {
      const r = outputspec.change(projectId, changes, { by: arg('--by'), reason: arg('--reason', '') });
      console.log(`사양 변경: ${Object.keys(changes).join(', ')}`);
      if (r.materialChanges.length) {
        console.log(`  ※ 중대 변경(${r.materialChanges.join(', ')}) — 확정이 해제되었다. 다시 confirm 해야 한다.`);
        if (r.versionBumped) console.log(`  ※ 새 버전: ${r.spec.version}`);
      }
    } catch (e) { fail(e.message); }
    return;
  }

  if (sub === 'confirm') {
    const by = arg('--by');
    if (!projectId || !by) return fail('사용법: cli.js spec confirm <PROJECT_ID> --by "<이름>"');
    try {
      const spec = outputspec.confirm(projectId, { by, notes: arg('--note', '') });
      console.log(`출력 사양 확정 (LOCKED) — ${spec.version} by ${spec.confirmedBy}`);
      console.log(`  이제 최종 산출물을 생성할 수 있다: cli.js run ${projectId}`);
    } catch (e) { fail(e.message); }
    return;
  }

  fail(`알 수 없는 하위명령: ${sub} (show|propose|set|confirm)`);
}

// ── 최종 검증 결과 조회 ─────────────────────────────────────
function cmdValidate(projectId) {
  if (!projectId) return fail('사용법: cli.js validate <PROJECT_ID>');
  const final = store.readJson(projectId, '11_QC/final-validation.json', null);
  if (!final) return fail('최종검증 결과가 없다 — cli.js run 을 먼저 실행한다');

  console.log(`\n  LINKPILOT FINAL VALIDATION — ${projectId}\n`);
  console.log(`  Overall Score : ${final.score.total} / 100`);
  console.log(`  Status        : ${final.status}`);
  console.log(`  Critical ${final.summary.critical} · Major ${final.summary.major} · Minor ${final.summary.minor}\n`);

  for (const g of final.gates) {
    const mark = { PASS: '●', WARNING: '▲', FAIL: '✕' }[g.status] || '·';
    console.log(`  ${mark} ${g.id} ${g.name.padEnd(38)} ${g.status}`);
  }
  if (final.calculation) {
    console.log(`\n  독립 재계산: ${final.calculation.worst} — ${final.calculation.checks.filter(c => c.level === 'PASS').length}/${final.calculation.checks.length} 항목 일치`);
  }
  console.log(`  추적 가능: ${Math.round((final.traceability.coverage || 0) * 100)}% (${final.traceability.rows.filter(r => r.traceable).length}/${final.traceability.rows.length})`);

  const open = final.issues.filter(i => i.severity !== 'MINOR');
  if (open.length) {
    console.log('\n  미해결 (CRITICAL/MAJOR)');
    for (const i of open) console.log(`   ${i.id} [${i.severity}] ${i.message}\n        → ${i.action}`);
  }
  console.log(`\n  보고서: 11_QC/validation-report.md · red-flag-report.md · traceability-report.md\n`);
}

function cmdQuota() {
  const cache = require('./connectors/cache');
  const vworld = require('./connectors/vworld');
  const molit = require('./connectors/molit');
  const s = cache.stats();

  console.log(`\n공공데이터 호출 현황 (KST ${s.date})\n`);
  console.log(`  캐시 위치 : ${s.cacheRoot}`);
  console.log(`  VWORLD_KEY     : ${vworld.isAvailable() ? '설정됨' : '미설정 — 지오코딩·지적·공시지가 생략'}`);
  console.log(`  DATA_GO_KR_KEY : ${molit.isAvailable() ? '설정됨' : '미설정 — 실거래가·건축물대장 생략'}`);

  const providers = new Set([...Object.keys(s.counts), 'vworld', 'data.go.kr']);
  console.log('');
  for (const p of providers) {
    const usedCount = s.counts[p] || 0;
    const limit = cache.limitFor(p);
    const bar = '█'.repeat(Math.min(20, Math.round((usedCount / limit) * 20))).padEnd(20, '·');
    console.log(`  ${p.padEnd(14)} ${bar} ${usedCount} / ${limit}`);
  }
  console.log('\n  ※ 캐시 히트는 쿼터를 소모하지 않는다. 재실행 시 호출 0건이 정상이다.\n');
}

function cmdAgents() {
  console.log('\nAGENT CONTROL CENTER\n');
  for (const a of registry.list()) {
    console.log(`  ${a.id.padEnd(15)} ${a.label.padEnd(26)} ${a.enabled ? 'ON ' : 'OFF'}  임계 ${a.confidenceThreshold}  승인 ${a.approvalRule}`);
  }
  console.log('\n  — 미구현 (Phase 2/3) —');
  for (const [id, p] of Object.entries(registry.PLANNED)) {
    console.log(`  ${id.padEnd(15)} ${p.label.padEnd(26)} Phase ${p.phase}${p.note ? `  · ${p.note}` : ''}`);
  }
  console.log('');
}

function cmdList() {
  const projects = store.listProjects();
  if (!projects.length) return console.log('프로젝트 없음');
  console.log('');
  for (const p of projects) {
    console.log(`  ${p.id}  ${(p.project.name || '').slice(0, 40).padEnd(42)} ${p.project.status || '-'}`);
  }
  console.log('');
}

function cmdApprove(projectId) {
  const by = arg('--by');
  if (!projectId || !by) return fail('사용법: cli.js approve <PROJECT_ID> --by "<승인자>" [--comment "..."]');
  try {
    const r = gate.approve(projectId, { approver: by, decision: arg('--decision', 'APPROVE'), comment: arg('--comment', '') });
    console.log(`승인 기록 완료: ${r.decision} by ${r.approver} (${r.at})`);
  } catch (e) {
    fail(e.message);
  }
}

async function cmdDemo() {
  const sampleDir = path.join(__dirname, 'samples');
  process.env.IM_AGENT_ROOT = process.env.IM_AGENT_ROOT || path.join(process.cwd(), 'im-projects');

  const first = await pipeline.run({
    request: '인천 남동공단 6.5MW 데이터센터 개발사업 IM 작성',
    log: m => console.log(m),
  });

  // 샘플 원본자료 복사 후 재실행 (실제 업로드 흐름과 동일)
  const dest = path.join(store.projectDir(first.projectId), '02_Source_Data');
  for (const f of fs.readdirSync(sampleDir)) {
    fs.copyFileSync(path.join(sampleDir, f), path.join(dest, f));
  }
  console.log(`\n샘플 원본자료 ${fs.readdirSync(sampleDir).length}건 투입 → 재실행\n`);

  await pipeline.run({ projectId: first.projectId, log: m => console.log(m) });
  cmdStatus(first.projectId);
  console.log(`산출물: ${path.join(store.projectDir(first.projectId), '09_IM/im.md')}`);
}

function fail(msg) {
  console.error(`✕ ${msg}`);
  process.exitCode = 1;
}

async function main() {
  const [cmd, a1] = process.argv.slice(2);
  switch (cmd) {
    case 'new': return cmdNew(a1);
    case 'run': return cmdRun(a1);
    case 'status': return cmdStatus(a1);
    case 'agents': return cmdAgents();
    case 'quota': return cmdQuota();
    case 'design': return cmdDesign(process.argv[3], process.argv[4]);
    case 'spec': return cmdSpec(process.argv[3], process.argv[4]);
    case 'validate': return cmdValidate(a1);
    case 'list': return cmdList();
    case 'approve': return cmdApprove(a1);
    case 'demo': return cmdDemo();
    default:
      console.log(`LinkPilot IM Agent

  new <요청문>            프로젝트 생성 + 1회 실행
  run <PROJECT_ID>        전체 파이프라인 재실행
  status <PROJECT_ID>     현황 조회
  list                    프로젝트 목록
  agents                  Agent Control Center
  quota                   공공데이터 일일 호출 현황 (KST 기준)
  design list             디자인 테마 13종 목록
  design recommend <ID>   AI 디자인 추천 (상위 3개 + 신뢰도)
  design preview --theme <id>   미리보기 HTML 생성
  design set <ID> --theme <id>  디자인 적용 (내용은 유지)
  design history <ID>     디자인 변경 이력
  spec show <ID>          출력 사양 조회 (페이지·크기·형식·언어)
  spec set <ID> --pages 40 --size A4   출력 사양 변경
  spec confirm <ID> --by <이름>        출력 사양 확정 (LOCK)
  validate <ID>           최종 독립검증 결과 (8 GATE · 점수 · 추적성)
  design revert <ID> --version 1.0   이전 디자인으로 복원
  approve <ID> --by <이름>  사람 승인 기록
  demo                    샘플 자료로 전체 흐름 시연
`);
  }
}

main().catch(e => { console.error('✕ 실패:', e.message); process.exit(1); });
