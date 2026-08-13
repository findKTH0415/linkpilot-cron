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
  approve <ID> --by <이름>  사람 승인 기록
  demo                    샘플 자료로 전체 흐름 시연
`);
  }
}

main().catch(e => { console.error('✕ 실패:', e.message); process.exit(1); });
