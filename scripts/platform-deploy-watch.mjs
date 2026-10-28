#!/usr/bin/env node
/* platform-deploy-watch.mjs — linkpilot-platform 의 마지막 배포(deploy-nas)가 «시작조차 못 했는지»를 «이 저장소의 러너»가 대신 본다 (D-289 · 2026-09-24)
 *
 * [왜 여기서 도나] platform 은 비공개 저장소라 결제·지출 한도에 막히면 러너를 못 받는다 — 배포도, 그것을 지켜보는 deploy-watch 도
 *   같은 이유로 안 돈다(§12-17 이 적어 둔 그 구멍). 그래서 «공개 저장소(여기)의 러너»가 읽기 토큰으로 대신 묻는다.
 * [무엇을] 마지막 deploy-nas 실행 · 그 잡들 · 실패한 잡의 check-run 주석을 받아 im-agent/tools/deploy-why.js 에 넘긴다 — 판정은 «한 벌»(§8-1).
 * [되돌아오는 값] deploy-why 와 같다: 0 성공·비켜남·도는 중 / 1 돌다가 실패 / 3 «러너를 못 받음»(결제) / 4 시작 전 거부 / 2 못 쟀다.
 *   0 이 아니면 이 워크플로가 빨개지고 GitHub 이 실패 메일을 보낸다 — 그것이 알림이다 (§2 의 실패 통보 경로 그대로).
 * [열쇠] PLATFORM_WATCH_TOKEN — 저장소 linkpilot-platform 에 Actions:read 만 있는 fine-grained 토큰. 값은 한 글자도 찍지 않는다 (§2).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OWNER = process.env.PLATFORM_WATCH_OWNER || 'findKTH0415';
const REPO = process.env.PLATFORM_WATCH_REPO || 'linkpilot-platform';
const WF = process.env.PLATFORM_WATCH_WORKFLOW || 'deploy-nas.yml';
const TOKEN = String(process.env.PLATFORM_WATCH_TOKEN || '').trim();
const API = process.env.PLATFORM_WATCH_API || 'https://api.github.com';   /* 검사가 가짜 서버를 끼우는 자리 */
const log = [];
const say = (l) => { log.push(l); console.log(l); };

async function gh(p) {
  const r = await fetch(API + p, { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'linkpilot-cron-watch' } });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (_) {}
  return { status: r.status, j, head: text.slice(0, 200) };
}

async function main() {
  if (!TOKEN) {
    say('⚠ PLATFORM_WATCH_TOKEN 이 없다 — **이 감시는 아무것도 못 쟀다**. Settings → Secrets and variables → Actions 에 그 이름으로 넣고, Variables 에 PLATFORM_WATCH_ON=1 을 둔다.');
    return 2;
  }
  say(`열쇠: PLATFORM_WATCH_TOKEN (${TOKEN.length}자) · 대상 ${OWNER}/${REPO} · ${WF}`);
  const runs = await gh(`/repos/${OWNER}/${REPO}/actions/workflows/${encodeURIComponent(WF)}/runs?per_page=1`);
  if (runs.status !== 200 || !runs.j || !Array.isArray(runs.j.workflow_runs)) {
    /* 401/403/404 는 열쇠·권한(대상 저장소 Actions:read) 쪽이다 — «못 쟀다»로 적고, 무엇이 왔는지는 상태코드로만 (본문에 값이 섞일 수 있다) */
    say(`⚠ 실행 목록을 못 받았다 — HTTP ${runs.status}. 열쇠의 저장소 권한(Actions: read)을 본다. **이 감시는 아무것도 못 쟀다.**`);
    return 2;
  }
  const run = runs.j.workflow_runs[0];
  if (!run) { say('⚠ 그 워크플로의 실행이 아직 없다 — 잴 것이 없다.'); return 2; }
  const jobs = await gh(`/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs?per_page=50`);
  const jobsDoc = jobs.status === 200 && jobs.j ? jobs.j : { jobs: [] };
  const ann = [];
  for (const j of (jobsDoc.jobs || [])) {
    if (!j.conclusion || j.conclusion === 'success' || j.conclusion === 'skipped') continue;
    const a = await gh(`/repos/${OWNER}/${REPO}/check-runs/${j.id}/annotations`);
    if (a.status === 200 && Array.isArray(a.j)) ann.push(...a.j);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-pdw-'));
  const w = (n, o) => { const p = path.join(dir, n); fs.writeFileSync(p, JSON.stringify(o)); return p; };
  const tool = path.join(HERE, '..', 'im-agent', 'tools', 'deploy-why.js');
  const r = spawnSync(process.execPath, [tool, '--run', w('run.json', run), '--jobs', w('jobs.json', jobsDoc), '--ann', w('ann.json', ann)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const code = typeof r.status === 'number' ? r.status : 2;
  const label = { 0: '✅ 마지막 배포는 성공·비켜남·도는 중', 1: '❌ 배포가 돌다가 멈췄다 — 코드·설정 쪽', 3: '❌ 배포가 «시작조차 못 했다» — 러너를 못 받았다(결제·지출 한도). 코드가 아니다', 4: '❌ 워크플로 파일이 시작 전에 거부됐다', 2: '⚠ 못 쟀다' }[code] || ('판정 ' + code);
  log.unshift(`**판정 ${code} — ${label}** · 실행 ${run.id} · 커밋 ${String(run.head_sha || '').slice(0, 8)} · ${run.html_url || ''}`);
  console.log(out);
  console.error(`판정 ${code} — ${label}`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  try { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, log.join('\n\n') + '\n\n```\n' + out.slice(0, 6000) + '\n```\n'); } catch (_) {}
  return code;
}

const code = await main().catch((e) => { say('⚠ 예상 밖 오류 — ' + String(e && e.message || e).replace(/gh[pousr]_[A-Za-z0-9_]+/g, '***').slice(0, 200) + ' · **못 쟀다**'); return 2; });
try { if (code === 2 && process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, log.join('\n\n') + '\n'); } catch (_) {}
process.exit(code);
