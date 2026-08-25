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
 *   IM_LINKED_FETCHER 연결 자료 내려받기 모듈 경로(`module.exports.fetchLinked(item)`) — 본체가 준다.
 *                     없으면 연결 자료를 읽지 않고 그 사실을 경고로 세운다 (플랫폼-연결-지시서 §6-1)
 *   IM_AGENT_DISABLE  끌 Agent 목록 (예: "03_research")
 *   GEMINI_API_KEY    LLM 사용 시 (GitHub Secrets)
 */

require('./core/env').load();   // .env 가 있으면 올린다 (셸·Secrets 값이 우선)

const fs = require('fs');
const path = require('path');
const pipeline = require('./pipeline');
const store = require('./core/store');
const registry = require('./core/registry');
const gate = require('./core/gate');
const orchestrator = require('./core/orchestrator');
const tasksMod = require('./core/tasks');
const router = require('./core/router');
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

// ── Project Control Tower ───────────────────────────────────
function bar(pct, width = 18) {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function cmdMonitor(projectId) {
  if (!projectId) return fail('사용법: cli.js monitor <PROJECT_ID>');
  const monitor = require('./core/monitor');
  const snap = monitor.snapshot(projectId);
  if (!snap.agents.length) return fail('모니터 기록이 없다 — cli.js run 을 먼저 실행한다');

  const T = snap.tracks;
  console.log('');
  console.log('┌────────────────────────────────────────────────────────────┐');
  console.log('│ LINKPILOT PROJECT CONTROL TOWER                            │');
  console.log('└────────────────────────────────────────────────────────────┘');
  console.log(`  Project  : ${snap.project.name}`);
  console.log(`  ID       : ${snap.project.id}   ${snap.health.mark} ${snap.health.level} (${snap.health.reason})`);
  console.log(`  Elapsed  : ${Math.round(snap.timing.elapsedMs / 1000)}s`
    + (snap.timing.estimatedRemainingMs ? `   Est. remaining ~${Math.round(snap.timing.estimatedRemainingMs / 1000)}s (참고값)` : ''));

  console.log('\n① OVERALL PROGRESS');
  console.log(`  전체  ${bar(snap.overall)} ${String(snap.overall).padStart(3)}%`);
  console.log('  ※ Agent 진행률이 아니라 4개 트랙의 가중합이다. Agent를 다 돌려도 검증 전이면 100%가 되지 않는다.\n');
  for (const k of ['production', 'validation', 'output', 'approval']) {
    console.log(`  ${T[k].label.padEnd(24)} ${bar(T[k].pct, 14)} ${String(T[k].pct).padStart(3)}%  (비중 ${T[k].weight}%)  ${T[k].detail || ''}`);
  }

  console.log('\n② AGENT ACTIVITY');
  const icon = { COMPLETED: '●', WARNING: '▲', RUNNING: '▶', ERROR: '✕', WAITING: '○', SKIPPED: '·', BLOCKED: '■' };
  for (const a of snap.agents) {
    const t = a.elapsedMs ? `${(a.elapsedMs / 1000).toFixed(1)}s` : '';
    console.log(`  ${icon[a.status] || '·'} ${a.id.padEnd(20)} ${String(a.progress).padStart(3)}%  ${a.status.padEnd(10)} ${t.padStart(7)}  ${(a.activity || '').slice(0, 34)}`);
  }
  if (snap.bottleneck) {
    console.log(`\n  병목: ${snap.bottleneck.label} — ${(snap.bottleneck.elapsedMs / 1000).toFixed(1)}s (전체의 ${snap.bottleneck.sharePct}%, 후속 ${snap.bottleneck.dependents}개, 영향 ${snap.bottleneck.impactLevel})`);
  }
  if (snap.waiting.length) {
    console.log('  대기: ' + snap.waiting.map(w => `${w.id} ← ${w.waitingFor.join(',')}`).join(' / '));
  }

  console.log('\n③ VALIDATION / RISK');
  if (T.validation.score !== null) {
    console.log(`  Score ${T.validation.score}/100 · ${T.validation.status}`);
    console.log(`  🔴 CRITICAL ${T.validation.critical}   🟠 MAJOR ${T.validation.major}   🟡 MINOR ${T.validation.minor}   GATE ${T.validation.gatesPassed}/${T.validation.gatesTotal}`);
  } else {
    console.log(`  ${T.validation.detail}`);
  }

  console.log('\n④ OUTPUT STATUS');
  for (const f of T.output.files) {
    console.log(`  ${f.exists ? '✓' : '○'} ${f.label.padEnd(16)} ${f.path}`);
  }
  console.log(`  사양: ${T.output.detail}${T.output.manifestStatus ? ` · 매니페스트: ${T.output.manifestStatus}` : ''}`);

  if (T.approval.reasons.length) {
    console.log('\n  USER ACTION REQUIRED');
    for (const r of T.approval.reasons) console.log(`   - ${r}`);
  }

  const acts = snap.activity.slice(-8);
  if (acts.length) {
    console.log('\n  LIVE ACTIVITY');
    for (const a of acts) {
      console.log(`  ${a.at.slice(11, 19)}  ${a.agent.padEnd(18)} ${a.level === 'WARN' ? '⚠ ' : ''}${a.message.slice(0, 60)}`);
    }
  }
  console.log('');
}

// ── 데이터 계보 / 변경 영향 ─────────────────────────────────
function cmdLineage(projectId, key) {
  if (!projectId || !key) return fail('사용법: cli.js lineage <PROJECT_ID> <dictionary-key>   예: lineage LP-DC-2026-001 building.gfa_sqm');
  const lineage = require('./core/lineage');
  const r = lineage.trace(projectId, key);
  if (!r.found) return fail(`${key}: ${r.reason}`);

  console.log(`\n  DATA LINEAGE — ${r.label} (${r.key})`);
  console.log(`  값: ${r.value}${r.unit ? ' ' + r.unit : ''} · 등급 ${r.grade} · ${r.verified ? '검증됨' : '미검증'}${r.conflicted ? ' · ⚠ 값 충돌 있음' : ''}\n`);
  for (const c of r.chain) {
    console.log(`  ${c.adopted ? '│' : '╎'} [${c.stage}] ${c.label}${c.adopted ? '' : '  (미채택)'}`);
    if (c.detail) console.log(`  ${c.adopted ? '│' : '╎'}    ${c.detail}`);
    if (c.value !== null && c.value !== undefined) console.log(`  ${c.adopted ? '│' : '╎'}    값: ${c.value}`);
    console.log(`  ${c.adopted ? '▼' : '╎'}`);
  }
  if (r.consumers.length) {
    console.log('  소비처');
    for (const c of r.consumers) console.log(`   - ${c.stage}: ${c.affects.slice(0, 5).join(', ')}${c.affects.length > 5 ? ` 외 ${c.affects.length - 5}건` : ''}`);
  }
  console.log('');
}

function cmdImpact(projectId, key) {
  if (!projectId || !key) return fail('사용법: cli.js impact <PROJECT_ID> <dictionary-key>');
  const lineage = require('./core/lineage');
  const r = lineage.impact(projectId, key);

  console.log(`\n  CHANGE IMPACT — ${r.label} (${r.key})\n`);
  console.log(`  이 값을 바꾸면 ${r.totalAffected}개 결과물이 영향을 받는다.\n`);
  console.log(`  재실행할 Agent (순서대로):`);
  for (const a of r.rerunOrder) console.log(`   ${r.rerunOrder.indexOf(a) + 1}. ${a}`);
  if (r.affectedValues.length) {
    console.log(`\n  다시 계산되는 값 ${r.affectedValues.length}건:`);
    console.log('   ' + r.affectedValues.map(v => v.label).join(', '));
  }
  console.log(`\n  갱신되는 문서 ${r.affectedDocuments.length}건:`);
  for (const d of r.affectedDocuments) console.log(`   - ${d}`);
  if (r.requiresNewVersion) {
    console.log('\n  ⚠ 이미 승인된 프로젝트다 — 변경하면 새 버전이 필요하다.');
  }
  console.log(`\n  재실행: cli.js run ${projectId}\n`);
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


// ══ 지휘체계 (Task 그래프) ══════════════════════════════════

const MARK = {
  QUEUED: '·', READY: '·', RUNNING: '▶', WAITING: '◐', VALIDATING: '?',
  PASSED: '✓', COMPLETED: '●', FAILED: '✕', REWORK: '↻',
  BLOCKED: '■', PLANNED: '✕', SKIPPED: '↷',
};

function printPlan(snap) {
  const s = snap.summary;
  console.log(`\n─ ${snap.projectId} ─ Task ${s.total}건`
    + ` · 완료 ${s.done}/${s.runnable} (${s.pct}%)`
    + ` · 대기 ${s.waiting} · 막힘 ${s.blocked} · 담당없음 ${s.planned}`);
  if (snap.assetClass) console.log(`  자산군: ${snap.assetClass.label}`);

  console.log('\n  회전 (같은 줄은 동시에 돈다)');
  for (const w of snap.waves) {
    console.log(`   ${String(w.wave).padStart(2)}. `
      + w.tasks.map(t => `${MARK[t.status] || '·'} ${t.id} ${t.name}`).join('   '));
  }

  // ★ 못 도는 것을 목록 끝에 몰아 두지 않는다 — 이유와 함께 바로 보여준다
  const trouble = [
    ['담당 Agent 가 없다', snap.planned],
    ['지금 돌 수 없다', snap.blocked],
    ['사람을 기다린다', snap.waiting],
    ['다른 곳에서 이미 돈다', snap.elsewhere],
  ];
  for (const [label, rows] of trouble) {
    if (!rows || !rows.length) continue;
    console.log(`\n  ${label} — ${rows.length}건`);
    for (const r of rows) console.log(`   · ${r.id} ${r.name}${r.reason || r.handledBy ? ` — ${r.reason || r.handledBy}` : ''}`);
  }

  const a = snap.artifacts;
  console.log(`\n  산출물 등록부: ${a.distinct}건 (개정 ${a.revised} · 없음 ${a.missing} · 갈림 ${a.drift})`);
  const off = snap.tools.filter(t => !t.ok);
  if (off.length) {
    console.log(`  못 쓰는 자료원 ${off.length}종 — ${off.map(t => `${t.name}(${t.missing.join(',')})`).join(' · ')}`);
  }
  if (snap.project) {
    const tr = snap.project.tracks;
    console.log(`\n  ★ 프로젝트 진행률은 Task 진행률과 다르다`);
    console.log(`     전체 ${snap.project.overall}% — 제작 ${tr.production.pct}% · 검증 ${tr.validation.pct}%`
      + ` · 산출 ${tr.output.pct}% · 승인 ${tr.approval.pct}%`);
  }
}

function cmdPlan(projectId) {
  if (!projectId) return fail('PROJECT_ID 가 필요하다');
  const request = arg('--request', null);
  orchestrator.planProject(projectId, { request });
  printPlan(orchestrator.snapshot(projectId));
  console.log(`\n  다음: im orchestrate ${projectId}  (--dry-run 이면 순서만 본다)`);
}

async function cmdOrchestrate(projectId) {
  if (!projectId) return fail('PROJECT_ID 가 필요하다');
  if (!tasksMod.load(projectId)) {
    console.log('계획이 없어 먼저 세운다.');
    orchestrator.planProject(projectId, { request: arg('--request', null) });
  }
  const r = await orchestrator.execute(projectId, {
    log: m => console.log(m),
    dryRun: process.argv.includes('--dry-run'),
  });
  printPlan(orchestrator.snapshot(projectId));
  if (r.stoppedBecause) console.log(`\n  멈춘 이유: ${r.stoppedBecause}`);
}

function cmdRework(projectId, key) {
  if (!projectId || !key) return fail('사용법: im rework <PROJECT_ID> <key>');
  const r = orchestrator.markRework(projectId, key, { apply: !process.argv.includes('--dry-run') });
  console.log(`\n─ ${r.label || key} 를 바꾸면 ─`);
  console.log(`  다시 도는 순서: ${r.rerunOrder.join(' → ')}`);
  console.log(`  다시 도는 Task ${r.marked.length}건`);
  for (const m of r.marked) console.log(`   ↻ ${m.taskId} ${m.name} (${m.agentId})`);
  if (r.notFound.length) console.log(`  되돌리지 못한 것: ${r.notFound.join(', ')}`);
  if (r.requiresNewVersion) {
    console.log('\n  ★ 이미 승인된 프로젝트다 — 값을 바꾸면 승인이 풀리고 버전이 올라간다');
  }
  console.log(`\n  갱신될 문서: ${r.affectedDocuments.length}건`);
  if (process.argv.includes('--dry-run')) console.log('  (dry run — 아무것도 표시하지 않았다)');
  else console.log(`  다음: im orchestrate ${projectId}`);
}

function cmdTools() {
  console.log('\n─ 자료원 (MCP/커넥터) ─  ★ 키 값은 표시하지 않는다. 이름만 본다');
  for (const t of router.toolStatus()) {
    console.log(`  ${t.ok ? '●' : '○'} ${t.name.padEnd(10)} ${t.ok ? '쓸 수 있다' : `키 없음: ${t.missing.join(', ')}`}`);
  }
  console.log('\n─ 능력 → 담당 ─  ★ Agent 가 도구를 고르지 않는다. 여기서 지정해 내려보낸다');
  for (const [id, c] of Object.entries(router.CAPABILITIES)) {
    const a = router.assign(id);
    const who = a.agentId || (a.handledBy ? `(${a.handledBy})` : '— 담당 없음');
    console.log(`  ${c.label.padEnd(18)} ${String(who).padEnd(34)} ${a.tools.map(x => x.name).join(' ') || '-'}`);
    if (a.reason) console.log(`   └ ${a.reason}`);
  }
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
    case 'monitor': return cmdMonitor(a1);
    case 'lineage': return cmdLineage(a1, process.argv[4]);
    case 'impact': return cmdImpact(a1, process.argv[4]);
    case 'list': return cmdList();
    case 'approve': return cmdApprove(a1);
    case 'plan': return cmdPlan(a1);
    case 'orchestrate': return cmdOrchestrate(a1);
    case 'rework': return cmdRework(a1, process.argv[4]);
    case 'tools': return cmdTools();
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
  monitor <ID>            Project Control Tower (진행률 4트랙 · Agent · 위험 · 산출)
  lineage <ID> <key>      데이터 계보 (원천자료 → 계산 → 문서)
  impact <ID> <key>       변경 영향 분석 (무엇을 다시 계산해야 하는가)
  design revert <ID> --version 1.0   이전 디자인으로 복원
  approve <ID> --by <이름>  사람 승인 기록

  ── 지휘체계 (업무를 쪼개고 · 동시에 돌리고 · 바뀐 것만 다시) ──
  plan <ID>               요청문을 Task 로 쪼개 계획을 세운다
  orchestrate <ID>        계획을 돌린다 (--dry-run 이면 순서만 본다)
  rework <ID> <key>       값 하나가 바뀌었을 때 다시 돌 것만 표시한다
  tools                   자료원 상태와 능력별 담당 (키 값은 안 나온다)

  demo                    샘플 자료로 전체 흐름 시연
`);
  }
}

main().catch(e => { console.error('✕ 실패:', e.message); process.exit(1); });
