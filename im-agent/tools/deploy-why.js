'use strict';
/**
 * deploy-why.js — **배포가 왜 실패했는지 «갈래를 갈라» 사람 말로 적는다**
 *   〈2026-09-17 사장님: 「권하는 개선안 진행해」 — 제가 올린 권장 ①〉
 *
 * ## 왜 만드나 — 실측에서 났다
 *
 * platform #122 가 합쳐진 뒤 배포가 **3초 만에** 실패했다. 나는 로그를 열고
 * 잡 JSON 을 뜯어 **주석(annotation)** 까지 가서야 사유를 찾았다:
 *
 *   「The job was not started because recent account payments have failed or
 *     your spending limit needs to be increased.」
 *
 * ★★★ **이것은 «코드 실패»가 아니라 «일이 시작조차 못 한 것»이다.**
 *   할 일이 **정반대**다 — 앞은 **결제 자리**를 보셔야 하고, 뒤는 **코드**를 고쳐야 한다.
 *   뭉뚱그리면 사장님이 **고칠 것이 없는 자리**를 보러 가신다
 *   (CLAUDE.md §4.6 · §12-4 · §12-10 · §12-13 과 **같은 규칙**).
 *
 * ★★ **그리고 그 사유는 로그에 «없다».** 로그 내려받기는 404 를 준다 — 단계가
 *   하나도 안 돌았으니 로그 자체가 없다. 사유는 **check-run 의 주석**에만 있다.
 *   그 자리를 모르면 「왜 실패했는지 모르겠다」로 끝난다.
 *
 * ## 갈래 — 다섯
 *
 *   초록      성공                                   → 되돌아오는 값 0
 *   비켜남    cancelled (같은 커밋을 두 번 안 재려고)  → 0  (실패가 아니다)
 *   도는 중   queued · in_progress                    → 0
 *   못 시작   실패인데 단계 0개 · 러너 없음            → 3  ★ 코드 문제가 아니다
 *   코드      실패이고 단계가 돌다 멈춤                → 1
 *   못 쟀다   입력을 못 읽음                           → 2  (통과가 아니다 · §8)
 *
 * ★ **「못 쟀다」를 0 으로도 1 로도 뭉개지 않는다** — 그러면 못 잰 것이
 *   통과나 실패로 바뀐다 (CLAUDE.md §8 · run-gate.js 와 같은 잣대).
 *
 * ## 쓰는 법
 *
 *   node im-agent/tools/deploy-why.js --run <run.json> --jobs <jobs.json> [--ann <ann.json>]
 *
 *   세 파일은 GitHub API 응답을 그대로 담은 것이다:
 *     run  : /repos/{o}/{r}/actions/runs/{id}
 *     jobs : /repos/{o}/{r}/actions/runs/{id}/jobs
 *     ann  : /repos/{o}/{r}/check-runs/{job_id}/annotations   ← 사유가 여기 있다
 */
const fs = require('fs');

function arg(n, d) { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; }

function readJson(p) {
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

/** 초 단위로 얼마나 걸렸나 — **3초는 「시작조차 못 했다」의 강한 신호**다 */
function secs(run) {
  try {
    const a = Date.parse(run.run_started_at || run.created_at);
    const b = Date.parse(run.updated_at);
    if (!a || !b || b < a) return null;
    return Math.round((b - a) / 1000);
  } catch (_) { return null; }
}

/**
 * ★★★ **「러너를 못 받았다」를 무엇으로 아는가.**
 *   단계가 **0개**이고 러너 이름이 **비어 있으면** 그 잡은 시작도 못 한 것이다.
 *   ★ 둘 중 하나만 보면 안 된다 — 단계가 비는 다른 경우가 있고(스킵),
 *     러너 이름이 비는 다른 경우도 있다. **둘이 함께**일 때만 이 갈래다.
 */
function neverStarted(job) {
  if (!job) return false;
  const noSteps = !Array.isArray(job.steps) || job.steps.length === 0;
  const noRunner = !job.runner_name && !job.runner_id;
  return noSteps && noRunner;
}

/** 단계가 돌다 멈춘 자리 — 이름을 그대로 적는다 (「실패했다」만으로는 못 고친다) */
function failedSteps(job) {
  if (!job || !Array.isArray(job.steps)) return [];
  return job.steps
    .filter((s) => s && s.conclusion && s.conclusion !== 'success' && s.conclusion !== 'skipped')
    .map((s) => `${s.number}. ${s.name} (${s.conclusion})`);
}

/**
 * 주석에서 사유를 뽑는다. **이것이 이 도구의 급소다** — 못 시작한 잡은 로그가
 * 아예 없어(404) 사유가 여기에만 남는다.
 */
function annMessages(ann) {
  if (!Array.isArray(ann)) return [];
  return ann
    .filter((a) => a && a.message && a.annotation_level === 'failure')
    .map((a) => String(a.message).trim());
}

/**
 * ★★★ **사유를 «사람이 할 일»로 옮긴다.**
 *   「spending limit」이라는 영어를 그대로 보여 드리면 **어디를 눌러야 하는지**가
 *   안 보인다 (§5 — 어디서·무엇을·어떻게·그러면).
 * ★ 모르는 사유는 **지어내지 않고** 원문을 그대로 남긴다 (§4.6).
 */
function sayDo(msgs) {
  const t = msgs.join(' ');
  if (/payment|spending limit|billing/i.test(t)) {
    return [
      '**결제 자리를 보셔야 합니다 — 코드 문제가 아닙니다.**',
      '  ① 어디서  웹브라우저에서 GitHub 결제 화면 (github.com/settings/billing)',
      '  ② 무엇을  「Payment information」의 카드, 또는 「Spending limit」의 Actions 한도',
      '  ③ 어떻게  카드가 만료·거절됐으면 새로 넣고, 한도가 찼으면 올립니다',
      '  ④ 그러면  그 화면의 빨간·노란 경고가 사라집니다 = 그게 성공 표시입니다',
      '  ★ 개인 계정에 경고가 없으면 **조직(Organization) 결제**를 봅니다.',
    ];
  }
  if (/runner|no hosted|label/i.test(t)) {
    return ['**일을 돌릴 컴퓨터(러너)를 못 받았습니다** — 코드 문제가 아닙니다. GitHub 쪽 상태나 러너 설정을 봅니다.'];
  }
  if (!msgs.length) {
    return ['**사유를 못 받았습니다** — 무엇이 막았는지 이 자리에서는 모릅니다. GitHub 화면의 그 실행을 직접 열어 봐야 합니다.'];
  }
  return ['GitHub 이 적은 사유를 그대로 옮깁니다 (우리말로 바꿀 규칙이 아직 없습니다):'];
}

function main() {
  const run = readJson(arg('--run'));
  const jobsDoc = readJson(arg('--jobs'));
  const ann = readJson(arg('--ann'));

  if (!run) {
    console.log('⚠ 배포 실행을 못 읽었다 — **이 도구는 아무것도 안 쟀다** (--run 에 GitHub 응답 JSON 을 준다)');
    process.exit(2);
  }

  const jobs = (jobsDoc && jobsDoc.jobs) || [];
  const took = secs(run);
  const head = String(run.head_sha || '').slice(0, 8) || '(모름)';
  const st = run.status;
  const cc = run.conclusion;

  console.log('');
  console.log(`배포 ${run.id || ''} · 커밋 ${head}${took != null ? ` · ${took}초` : ''}`);
  console.log('');

  if (st !== 'completed') {
    console.log(`  ⏳ 아직 **도는 중**입니다 (${st}) — 끝난 뒤에 다시 잽니다.`);
    process.exit(0);
  }
  if (cc === 'success') {
    console.log('  ✅ 배포가 **성공**했습니다.');
    console.log('  ★ 다만 「성공」과 「사장님 화면이 새 판」은 다른 사실입니다 — 판 지문을 함께 봅니다 (M-25).');
    process.exit(0);
  }
  if (cc === 'cancelled') {
    console.log('  ◻ **비켜난 것**입니다 (cancelled) — 같은 커밋을 두 번 재지 않으려고 스스로 자리를 내줬습니다.');
    console.log('  ★ **실패가 아닙니다.** 같은 커밋의 다른 실행이 초록인지 봅니다.');
    process.exit(0);
  }

  const bad = jobs.filter((j) => j.conclusion && j.conclusion !== 'success' && j.conclusion !== 'skipped');
  const stalled = bad.filter(neverStarted);

  if (stalled.length) {
    const msgs = annMessages(ann);
    console.log('  ❌ **일이 시작조차 못 했습니다** — 단계가 0개이고 러너가 배정되지 않았습니다.');
    console.log(`     (잡 ${stalled.map((j) => j.name).join(' · ')}${took != null && took < 30 ? ` · ${took}초 만에 끝남` : ''})`);
    console.log('');
    console.log('  ★★★ 검사가 빨개진 것이 **아닙니다.** 코드는 멀쩡할 수 있습니다.');
    console.log('');
    msgs.forEach((m) => console.log(`     GitHub: ${m}`));
    if (msgs.length) console.log('');
    sayDo(msgs).forEach((l) => console.log(`  ${l}`));
    console.log('');
    console.log('  ★ 로그는 **없습니다**(내려받으면 404) — 단계가 하나도 안 돌았기 때문입니다.');
    console.log('    사유는 check-run 의 **주석**에만 남습니다. 그 자리를 이 도구가 읽습니다.');
    process.exit(3);
  }

  console.log('  ❌ 배포가 **돌다가 멈췄습니다** — 코드·설정 쪽입니다.');
  bad.forEach((j) => {
    const fs2 = failedSteps(j);
    console.log(`     잡 ${j.name} (${j.conclusion})`);
    if (fs2.length) fs2.forEach((s) => console.log(`       ✗ ${s}`));
    else console.log('       ⚠ 멈춘 단계를 못 찾았다 — 이 자리는 못 쟀다');
  });
  console.log('');
  console.log('  ★ 멈춘 단계의 로그를 열어 원인을 봅니다. **결제 자리가 아닙니다.**');
  process.exit(1);
}

if (require.main === module) main();
module.exports = { neverStarted, failedSteps, annMessages, sayDo, secs };
