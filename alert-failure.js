/**
 * alert-failure.js
 * 크론이 실패했을 때 사람에게 알린다. CLAUDE.md §2 — "발송 실패 시 조용히 죽지 않는다".
 *
 * 실패한 크론은 다음날 아침에야 발견된다. 그래서 알림 경로를 두 개 둔다.
 *   ① GitHub Issue — 외부 서비스에 의존하지 않는다. NAS·Solapi·Gemini 가 전부 죽어도 뜬다.
 *   ② SMS(Solapi)  — 이슈 메일을 놓쳐도 폰으로 온다. ALERT_PHONE 이 있을 때만.
 *
 * ★ 이 스크립트는 어떤 경우에도 예외를 던지거나 0 이외의 코드로 끝나지 않는다.
 *   알림 실패가 원래 실패를 덮어버리면 안 된다. 두 경로 다 실패해도
 *   Actions 로그에는 사유가 남는다.
 *
 * 환경변수:
 *   ALERT_WORKFLOW   — 실패한 워크플로 이름 (필수)
 *   ALERT_RUN_URL    — 실패한 실행 URL
 *   GITHUB_TOKEN     — 이슈 생성용 (Actions 가 자동 주입, issues:write 필요)
 *   GITHUB_REPOSITORY / GITHUB_API_URL — Actions 자동 주입
 *   ALERT_PHONE      — (선택) 실패 알림 SMS 수신 번호. 없으면 SMS 생략
 *   SENDER_PHONE     — (선택) SMS 발신번호. 없으면 SMS 생략
 *   SOLAPI_API_KEY / SOLAPI_API_SECRET
 *   ALERT_DRY_RUN=1  — 네트워크 호출 없이 무엇을 보낼지만 출력 (로컬 검증용)
 */
'use strict';

const DRY_RUN = process.env.ALERT_DRY_RUN === '1';

/** 실패 시각은 항상 KST 로 명시한다 (러너는 UTC 로 돈다) */
function kstStamp(now = new Date()) {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(now);
  return s.replace(' ', ' ') + ' KST';
}

/** 이슈 제목은 워크플로마다 고정한다 — 같은 크론이 연속 실패해도 이슈가 쌓이지 않는다 */
function issueTitle(workflow) {
  return `🔴 크론 실패: ${workflow}`;
}

function buildAlert({ workflow, runUrl, now = new Date() }) {
  const when = kstStamp(now);
  return {
    title: issueTitle(workflow),
    body: [
      `**${workflow}** 워크플로가 실패했다.`,
      '',
      `- 실패 시각: ${when}`,
      `- 실행 로그: ${runUrl || '(URL 없음)'}`,
      '',
      '복구한 뒤 이 이슈를 닫는다. 열려 있는 동안 같은 워크플로가 또 실패하면',
      '새 이슈를 만들지 않고 이 이슈에 댓글로 누적한다.',
    ].join('\n'),
    // SMS 는 길면 LMS 로 전환되어 과금이 달라진다. 핵심만 담는다.
    sms: `[LinkPilot] ${workflow} 크론 실패\n${when}\n${runUrl || ''}`.trim(),
  };
}

// ── ① GitHub Issue ────────────────────────────────────────────────
// 열려 있는 같은 제목의 이슈가 있으면 댓글, 없으면 새로 만든다.

async function gh(path, options = {}) {
  const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const r = await fetch(api + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'linkpilot-cron-alert',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`GitHub API ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function notifyIssue(alert) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return { ok: false, skipped: true, reason: 'GITHUB_REPOSITORY 없음' };
  if (!process.env.GITHUB_TOKEN) return { ok: false, skipped: true, reason: 'GITHUB_TOKEN 없음 (issues:write 권한 확인)' };
  if (DRY_RUN) return { ok: true, dryRun: true, action: 'issue', title: alert.title };

  // PR 도 /issues 에 섞여 나오므로 걸러낸다
  const open = await gh(`/repos/${repo}/issues?state=open&per_page=100`);
  const existing = (open || []).find(it => !it.pull_request && it.title === alert.title);

  if (existing) {
    await gh(`/repos/${repo}/issues/${existing.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: alert.body }),
    });
    return { ok: true, action: 'comment', number: existing.number };
  }

  const created = await gh(`/repos/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: alert.title, body: alert.body }),
  });
  return { ok: true, action: 'create', number: created.number };
}

// ── ② SMS (Solapi) ────────────────────────────────────────────────
// 친구톡이 아니라 SMS 를 쓴다. 친구톡은 08:00~20:50 에만 나가는데
// 크론 실패는 그 시간대 밖에서도 일어난다.

async function notifySms(alert) {
  const to = (process.env.ALERT_PHONE || '').replace(/[^0-9]/g, '');
  const from = (process.env.SENDER_PHONE || '').replace(/[^0-9]/g, '');
  if (!to) return { ok: false, skipped: true, reason: 'ALERT_PHONE 미설정 — SMS 생략' };
  if (!from) return { ok: false, skipped: true, reason: 'SENDER_PHONE 미설정 — SMS 발신번호 없음' };
  if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET) {
    return { ok: false, skipped: true, reason: 'SOLAPI 키 미설정 — SMS 생략' };
  }
  if (DRY_RUN) return { ok: true, dryRun: true, action: 'sms', to: maskPhone(to) };

  // 알림 잡에서 npm install 이 실패했을 수도 있다. 그때는 이슈 경로만으로 간다.
  let SolapiMessageService;
  try {
    ({ SolapiMessageService } = require('solapi'));
  } catch (e) {
    return { ok: false, skipped: true, reason: 'solapi 모듈 없음 — SMS 생략' };
  }

  const ms = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);
  await ms.send([{ to, from, text: alert.sms }]);
  return { ok: true, action: 'sms', to: maskPhone(to) };
}

/** 로그에 전화번호를 그대로 남기지 않는다 */
function maskPhone(p) {
  return p.length > 4 ? p.slice(0, 3) + '*'.repeat(p.length - 7 > 0 ? p.length - 7 : 1) + p.slice(-4) : '***';
}

// ── 실행 ──────────────────────────────────────────────────────────

async function main() {
  const workflow = process.env.ALERT_WORKFLOW || '(알 수 없는 워크플로)';
  const alert = buildAlert({ workflow, runUrl: process.env.ALERT_RUN_URL });

  console.log(`알림 대상: ${workflow}${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log('── 알림 내용 ──\n' + alert.body + '\n──────────────');

  // 두 경로를 독립적으로 시도한다. 하나가 죽어도 다른 하나는 나간다.
  const results = await Promise.all([
    notifyIssue(alert).catch(e => ({ ok: false, error: e.message })),
    notifySms(alert).catch(e => ({ ok: false, error: e.message })),
  ]);

  const [issue, sms] = results;
  console.log('GitHub Issue:', JSON.stringify(issue));
  console.log('SMS         :', JSON.stringify(sms));

  if (!issue.ok && !sms.ok) {
    // 알림이 전부 실패한 것은 그 자체로 심각하다. 로그에 크게 남긴다.
    console.error('❌ 알림 경로가 모두 실패했다 — 실패가 조용히 묻힐 수 있다.');
  } else {
    console.log('✅ 실패 알림 전달됨');
  }
}

if (require.main === module) {
  // 알림 실패가 원래 실패를 덮지 않도록 항상 정상 종료한다.
  main().catch(e => { console.error('알림 처리 중 예외:', e.message); }).finally(() => process.exit(0));
}

module.exports = { buildAlert, issueTitle, kstStamp, maskPhone };
