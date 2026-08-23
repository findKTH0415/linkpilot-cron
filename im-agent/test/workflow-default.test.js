'use strict';
/**
 * workflow-default.test.js — **손대지 않고 눌러도 도는가**
 * 〈2026-08-21 · 실제로 첫 실행에서 죽어서 만들었다〉
 *
 * ★★ 무슨 일이 있었나. `deploy-nas` 를 아무것도 안 고치고 그냥 띄웠더니
 *   **첫 단계에서 죽었다.**
 *
 *       ##[error]파일 없음: im-agent/ui/platform/myinfo.html
 *
 *   그런 파일은 저장소에 없다. 화면 이름을 바꾸면서 워크플로 기본값만
 *   따라오지 않은 것이다. 그 뒤로 **아무도 안 눌러 봐서** 몰랐다.
 *
 * ★★ **기본값은 「아무 값이나」가 아니다.** 사람이 Run workflow 를 누르면
 *   대개 그대로 실행한다. 기본값이 죽으면 **처음 써 보는 사람이 처음에 만나는
 *   것이 오류**다 — 그러면 장치가 고장 났다고 읽는다.
 *
 * ★ 그리고 이 종류는 **문서로는 안 잡힌다.** 안내서에는 「Run workflow 를
 *   누르세요」라고만 적혀 있고, 그 말은 여전히 맞다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const WF = path.join(ROOT, '.github', 'workflows');
const PLATFORM_DIR = path.join(ROOT, 'im-agent', 'ui', 'platform');

/**
 * `default: '...'` 를 뽑는다 — yaml 파서를 들이지 않는다 (§5 의존성 최소)
 *
 * ★★ **고정 폭으로 잘라 보지 않는다** 〈2026-08-22 · 실제로 당했다〉.
 *   앞 판은 이름 뒤 1200자만 훑었다. 그 자리에 주석이 길게 붙자 `default:` 가
 *   창 밖으로 밀려나 **「기본값을 못 찾았다」**가 됐다 — 기본값은 멀쩡한데
 *   검사만 눈이 먼 것이다. 이제 **다음 입력 키가 나올 때까지** 읽는다.
 */
function defaultOf(yml, inputName) {
  const lines = yml.split('\n');
  const head = '      ' + inputName + ':';
  let i = lines.indexOf(head);
  if (i < 0) return null;
  for (i += 1; i < lines.length; i += 1) {
    const ln = lines[i];
    // 같은 깊이의 다음 입력(또는 더 얕은 키)을 만나면 이 입력은 끝났다
    if (/^ {0,6}\S/.test(ln)) break;
    const m = /^\s+default: '([^']*)'\s*$/.exec(ln);
    if (m) return m[1];
  }
  return null;
}

test('★★ deploy-nas 의 기본 파일이 실제로 있다 (첫 실행에서 죽은 자리)', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const def = defaultOf(y, 'files');
  assert.ok(def, 'files 기본값을 못 찾았다');
  def.split(/\s+/).filter(Boolean).forEach((f) => {
    assert.ok(fs.existsSync(path.join(ROOT, f)),
      `기본값이 없는 파일을 가리킨다: ${f} — 손대지 않고 누르면 거기서 죽는다`);
  });
});

/**
 * ★ 있기만 하면 되는 것이 아니다. **올릴 대상**이어야 한다.
 *   저장소 안 아무 파일이나 있으면 검사를 통과하지만, 웹 루트에 올릴
 *   물건이 아니면 기본값으로는 틀린 값이다.
 */
test('★ 기본 파일이 실제로 NAS 로 올라가는 묶음에 들어 있다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const def = defaultOf(y, 'files');
  const set = new Set(require('../ui/platform/build-embed.js').required());
  def.split(/\s+/).filter(Boolean).forEach((f) => {
    assert.ok(set.has(path.basename(f)),
      `${f} 는 배포 묶음에 없다 — 기본값으로 쓰면 엉뚱한 것을 올린다`);
  });
});

/**
 * ★★ 반대쪽 — **열쇠 보고가 파일 목록에 매달리면 안 된다.**
 *   위 사고에서 `Check files` 가 먼저 죽는 바람에 `Check secrets` 가 통째로
 *   건너뛰어졌다. Secret 이 들어왔는지 보려고 띄웠는데 **그것만 못 봤다.**
 *   재는 단계를 앞에 둔다.
 */
test('★★ 열쇠를 먼저 재고 파일을 본다 — 파일이 틀려도 열쇠는 보인다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const sec = y.indexOf('      - name: Check secrets');
  const fil = y.indexOf('      - name: Check files');
  assert.ok(sec > 0 && fil > 0, '두 단계가 다 있어야 한다');
  assert.ok(sec < fil,
    'Check files 가 먼저다 — 파일 목록이 틀리면 열쇠 보고를 통째로 못 본다');
});

/* ═════════ **닿는지만 확인하는 판** — 올려 보는 것이 첫 확인이면 안 된다 ═════════ */

/**
 * ★★ 〈2026-08-21〉 dry run 에서 고친 잘못이 **한 단 아래에 똑같이** 있었다.
 *
 *   dry run 은 Secret 이 들어왔는지만 잰다. 그다음 판은 **곧바로 올리기**였다.
 *   그러면 「이 열쇠가 실제로 통하나」를 확인하는 첫 방법이 **운영 화면을 덮는
 *   것**이 된다. 열쇠·주소·계정·개인키 넷 중 하나만 틀려도 그때 알게 되고,
 *   그때는 이미 NAS 를 건드린 뒤다.
 *
 * ★ `probe` 는 tailnet 에 붙고 ssh 로 `echo ok` 까지만 한다. **읽기만 한다.**
 *   넷이 전부 맞아야 통과하므로 여기가 초록이면 실제 배포도 된다.
 */
/**
 * ★ **다음 단계의 주석까지 삼키지 않는다** 〈2026-08-21 · 실제로 헛걸렸다〉.
 *   YAML 에서 주석은 설명하는 단계 **앞**에 온다. 그래서 단순히 다음
 *   `- name:` 까지 자르면 **다음 단계의 주석이 이 단계 것으로 붙는다.**
 *   `Set up ssh` 안에 `scp` 가 있다며 검사가 걸렸는데, 실제로는 그 아래
 *   `Check destination` 의 설명에 그 낱말이 있었다 — **없는 결함을 만들어
 *   낸 셈이다.** 끝의 주석 줄을 떼어 낸다.
 */
function stepOf(yml, name) {
  const start = yml.indexOf('      - name: ' + name);
  if (start < 0) return null;
  const rest = yml.slice(start + 10);
  const next = rest.indexOf('\n      - name: ');
  const body = next < 0 ? rest : rest.slice(0, next);
  const lines = body.split('\n');
  while (lines.length && /^\s*(#|$)/.test(lines[lines.length - 1])) lines.pop();
  return lines.join('\n');
}

/**
 * ★★★ **올리고 나서 재는 것까지가 배포다** 〈2026-08-23 사장님 지시로 되살림〉.
 *
 *   전날 D-84 로 쓰기를 지웠다가, 「앞으로는 네가 배포해」로 되돌렸다. 되살릴 때
 *   **지웠던 이유가 지워지지 않게** 한다: 쓰는 이는 여전히 하나여야 하고,
 *   올린 뒤에는 반드시 재야 한다.
 *
 *   ★ 저장소 ≠ **디스크** 는 치명이다 — 올리기가 실제로 안 된 것이다.
 *   ★ 디스크 ≠ **HTTP** 는 경고다 — 잰 길(포트 80)과 앱이 쓰는 길(Funnel 443)이
 *     달라 문서 루트가 다를 수 있다(M-25). 치명으로 두면 멀쩡한 배포가 늘 빨갛고,
 *     **그러면 빨간 것을 아무도 안 보게 된다.**
 */
test('★★★ 올린 뒤 반드시 재고, 실패를 삼키지 않는다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');

  const up = stepOf(y, 'Upload');
  assert.ok(up, 'Upload 단계가 없다 — 배포가 아무것도 안 한다');
  const scps = up.split('\n').filter(l => /^\s*scp\s/.test(l));
  assert.ok(scps.length > 0, 'Upload 에 scp 가 없다');
  scps.forEach(l => assert.match(l, /\bscp\s+-O\b/,
    'scp 에 -O 가 없다 — SFTP 로 가면 ssh 가 보는 것과 다른 것을 본다'));
  assert.match(up, /\.bak/, '덮기 전에 백업을 안 뜬다 — 되돌릴 길이 없다');

  const ver = stepOf(y, 'Verify deployed');
  assert.ok(ver, 'Verify deployed 단계가 없다 — 「올렸다」로 끝난다');
  assert.ok(y.indexOf('- name: Upload') < y.indexOf('- name: Verify deployed'),
    '재는 단계가 올리기보다 앞이다 — 올리기 전 상태를 재는 셈이다');
  assert.ok(!/\|\|\s*true/.test(ver), '재는 단계가 실패를 삼킨다 — 초록이 거짓말을 한다');
  assert.match(ver, /FILES: \$\{\{ inputs\.files \}\}/,
    '배포 목록 전부를 안 잰다 — 넷만 재면 나머지가 옛 판이어도 초록이다');

  /* ★ 디스크는 치명, HTTP 는 경고 — 스크립트가 그렇게 갈라야 한다 */
  const sh = fs.readFileSync(path.join(ROOT, 'deploy', 'verify-served.sh'), 'utf8');
  assert.match(sh, /올리기가 실제로 안 됐다/, '디스크가 다를 때를 치명으로 안 본다');
  assert.match(sh, /LP_HTTP_FATAL/, 'HTTP 를 경고로 낼 길이 없다');
  assert.match(sh, /::warning::\$\{NAME\} — 디스크와 HTTP 가 다르다/,
    'HTTP 가 달라도 경고로 말하지 않는다');
});

/**
 * ★★ **쓰는 이는 하나여야 한다** — D-84 로 배운 것은 되살린 뒤에도 유효하다.
 *   이제 이 워크플로가 그 하나이고 `deploy/screens.sh` 는 대비다. 그 사실이
 *   **글로 남아 있어야** 다음 사람이 둘을 같이 쓰지 않는다.
 */
test('★★ 왜 한때 지웠는지가 파일에 남아 있다 (D-84)', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  assert.match(y, /D-84/, '지웠던 결정의 번호가 없다');
  assert.match(y, /쓰는 이는 여전히 하나여야 한다/, '되살린 뒤의 약속이 없다');
  assert.match(y, /screens\.sh/, '대비 경로가 무엇인지 안 적는다');
});

/**
 * ★★ 〈2026-08-21 · 실제 배포 첫 시도에서 죽었다〉
 *
 *     scp: dest open "/volume1/web/report-flow.html": No such file or directory
 *
 *   **연결도 열쇠도 다 맞는데 「어디에 놓을지」가 틀렸다.** 그런데 오류가 scp
 *   안에서 나오는 바람에 「못 붙었나?」와 섞여 보인다.
 *
 * ★ 더 나쁜 것은 **파일이 여럿일 때**다. 앞의 몇 개는 올라가고 중간에서 멈추면
 *   **반쯤 배포된 상태**가 된다 — 화면 일부만 새 판이라 무엇이 깨졌는지
 *   짚기가 가장 어렵다. 그래서 **한 개도 올리기 전에** 목적지를 잰다.
 */
test('★★ 올리기 전에 목적지를 잰다 — 반쯤 배포된 상태를 만들지 않는다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');

  const chk = stepOf(y, 'Check destination');
  assert.ok(chk, 'Check destination 단계가 없다');

  /* ① 지문을 대조하는 단계보다 **앞**이어야 한다. 목적지가 없으면 지문 대조는
     「디스크에서 못 읽었다」로만 나와, 진짜 원인(경로가 틀렸다)이 가려진다 */
  assert.ok(y.indexOf('      - name: Check destination') < y.indexOf('      - name: Upload'),
    'Check destination 이 Upload 뒤에 있다 — 반쯤 올린 뒤에 재는 셈이다');

  // ② ★ 「없다」와 「쓸 수 없다」를 **가려서** 말한다. 둘을 뭉뚱그리면
  //   경로를 고쳐야 할 때 권한을 뒤지게 된다
  assert.match(chk, /NODIR/, '목적지가 없는 경우를 안 가린다');
  assert.match(chk, /NOWRITE/, '쓸 수 없는 경우를 안 가린다');

  // ③ ★★ **읽기만 한다.** 재려고 파일을 만들면 그것이 곧 배포다
  assert.ok(!/\b(scp|touch|mkdir)\b/.test(chk),
    'Check destination 이 NAS 에 무언가를 만든다 — 재기만 해야 한다');

  // ④ 막혔을 때 **다음에 무엇을 볼지** 말한다 (조용히 죽지 않는다 · §2)
  assert.match(chk, /ls \/volume1/, '실제 경로를 어떻게 찾는지 안 알려 준다');

  // ⑤ ★★ 알려 주는 그 명령이 **받는 사람 셸에서 실제로 돌아야** 한다.
  //   `ls -d /volume1/*` 을 안내했다가 zsh 가 `no matches found` 로 거부했다 —
  //   별표를 **내 컴퓨터가 먼저** 풀어 보려 하기 때문이다. 고치라고 준 명령이
  //   또 오류를 내면, 받는 사람은 원인이 둘로 늘어난 채로 헤맨다.
  assert.ok(!/ls[^\n]*\/volume1\/\*/.test(chk),
    '안내하는 명령에 별표가 있다 — zsh 가 no matches found 로 거부한다');
});

/**
 * ★★ 〈2026-08-22 · D-84〉 여기에 **`scp -O` 검사**가 있었다.
 *
 *   Synology 의 SFTP 가둠 설정 때문에 `-O`(옛 방식)가 빠지면 ssh 로는 보이는
 *   경로가 scp 에는 없는 것처럼 보였다 — 그래서 「경로가 틀렸다」로 읽히는
 *   오류가 났다. 그 함정 자체는 사라지지 않았지만, **이 워크플로에 scp 가
 *   없어졌으므로** 여기서 잴 것이 없다.
 *
 *   ★ 다시 쓰기를 넣는 날 이 검사부터 되살린다. 경위는 `MEMORY.md` 와
 *     `deploy/nas.sh` 에 남아 있다.
 */

/**
 * ★★ 〈2026-08-21 · 화면을 여섯 번 올렸는데 하나도 반영되지 않았다〉
 *
 *   `dest` 기본값이 웹 루트(`/volume1/web`)였다. 그런데 앱이 읽는 화면 사본은
 *   **`im-flow` 폴더**에 있다(`build-embed.js` 가 그 이름이 아니면 아예 만들지
 *   않는다). 그래서 올린 파일은 **아무도 안 읽는 자리**에 쌓였다.
 *
 * ★ 이 종류가 가장 비싸다. 배포는 **초록**이고, 지문도 **맞고**, 파일도
 *   **거기 있었다.** 틀린 것은 「어디에」 하나뿐인데 그것은 어느 화면에도
 *   안 나온다 — 사용자는 「반영이 안 된다」만, 나는 「올렸다」만 말할 수 있고
 *   **둘 다 맞는 말이라 겉돈다.**
 */
test('★★ 올릴 자리 기본값이 앱이 읽는 곳(im-flow)이다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const dest = defaultOf(y, 'dest');
  assert.ok(dest, 'dest 기본값을 못 찾았다');
  assert.ok(/\/im-flow$/.test(dest),
    `올릴 자리 기본값이 ${dest} 다 — 화면 사본은 im-flow 로 간다. `
    + '웹 루트에 올리면 배포는 초록인데 앱에는 아무것도 안 바뀐다');

  // ★ 같은 규칙을 만드는 쪽(build-embed)도 쥐고 있다. 둘이 갈리면 한쪽만 고친다
  const be = fs.readFileSync(path.join(PLATFORM_DIR, 'build-embed.js'), 'utf8');
  assert.match(be, /im-flow/, 'build-embed 가 im-flow 를 모른다 — 규칙이 한쪽에만 있다');
});

/**
 * ★★ 〈2026-08-21〉 **올린 것이 「어떻게 서빙되는지」까지 잰다.**
 *
 *   파일이 제자리에 있는 것과, 받는 쪽이 그것을 **어떤 모습으로** 받는지는
 *   다른 이야기다. 특히 압축은 **켜져 있는지 밖에서는 보이지 않는데** 체감
 *   속도를 세 배로 가른다 (122KB → 약 35KB).
 *
 * ★ 사람에게 「터미널에서 curl 해 보세요」라고 시키지 않는다. 러너는 이미
 *   tailnet 안에 있다 — **잴 수 있는 쪽이 잰다.** 두 번 부탁했는데 두 번 다
 *   확인이 안 온 뒤에 이렇게 바꿨다.
 */
test('★★ 서빙 상태를 재는 단계가 있고, 재기만 한다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const s = stepOf(y, 'Check serving');
  assert.ok(s, 'Check serving 단계가 없다');

  // ① dry run 에서는 안 돈다 — 거기서는 NAS 에 닿지도 않는다
  assert.match(s, /if:.*!inputs\.dry_run/, 'Check serving 이 dry_run 을 안 본다');

  // ② ★★ **읽기만 한다.** 헤더만 받고 아무것도 바꾸지 않는다
  assert.match(s, /curl[^\n]*-I/, '헤더만 받지 않는다 — 본문까지 받으면 재는 값이 커진다');
  assert.ok(!/\b(scp|ssh [^\n]*rm|curl[^\n]*(-X\s*(POST|PUT|DELETE)|--upload-file))\b/.test(s),
    'Check serving 이 무언가를 바꾼다 — 재기만 해야 한다');

  // ③ 압축 여부를 **가려서** 말한다. 「응답 왔다」로 뭉뚱그리면 아무것도 안 알려 준다
  assert.match(s, /Accept-Encoding: gzip/, '압축을 요청하지 않는다 — 그러면 늘 「없음」이 나온다');
  assert.match(s, /content-encoding/i, '응답의 압축 표시를 읽지 않는다');

  // ④ ★ 못 쟀을 때 **조용히 넘어가지 않는다** (§2)
  assert.match(s, /::warning::/, '못 쟀을 때 아무 말도 안 한다');
});

/**
 * ★★ 〈2026-08-21 · 실제로 여기서 죽었다〉 **GitHub 의 기본 셸은 `bash -e` 다.**
 *   단계 안에서 `set -uo pipefail` 을 써도 **`-e` 는 그대로 켜져 있다**
 *   (끄려면 `set +e`). 그래서 `grep` 이 못 찾은 순간 단계가 통째로 죽었다.
 *
 * ★ 하필 「못 찾음」이 그 자리에서는 **정상 결과**였다 — 압축 헤더가 없다는
 *   뜻이니까. **답을 찾은 그 순간에 죽은 셈이다.**
 *
 * ★ 재는 단계는 「없음」을 자주 만난다. 없는 것을 오류로 다루면 **가장 알고
 *   싶은 경우에만 아무것도 못 알려 준다.**
 */
test('★★ 재는 단계는 「없음」에 죽지 않는다 (bash -e 를 끈다)', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const s = stepOf(y, 'Check serving');
  assert.ok(s, 'Check serving 단계가 없다');
  assert.match(s, /set \+e/,
    'set +e 가 없다 — GitHub 기본 셸은 bash -e 라 grep 이 못 찾는 순간 죽는다');
  // grep 결과를 값으로 받는 곳은 「없음」을 그대로 받아야 한다
  (s.match(/^\s*\w+=\$\(printf[^\n]*grep[^\n]*$/gm) || []).forEach((l) => {
    assert.match(l, /\|\| true/, `없음을 못 받는다:\n    ${l.trim()}`);
  });
});

/**
 * ★★ **한 파일만 올리면 안 된다** 〈2026-08-22 · 실제로 당했다〉.
 *
 *   앞 기본값은 `report-flow.html` 하나였다. 손대지 않고 누르면 **그 파일만
 *   새것이 되고 옆의 15개는 옛것**으로 남는다. 화면은 서로를 부른다 —
 *   `report-flow.html` 하나가 코어 7개와 `tokens.css` 를 불러온다.
 *
 *   짝이 안 맞으면 **빈 화면**이 뜨고 오류는 안 난다. 실제로 「새 보고서 생성」이
 *   통째로 비어서 나왔고, 그 전에는 「자료 업로드」가 계속 옛 판으로 보였다 —
 *   그것을 캐시라고, 다음엔 dry run 이라고 두 번 잘못 짚었다. **세 번째 원인이
 *   이것이었다.**
 *
 * ★ 그래서 「있는 파일인가」로는 부족하다. **묶음 전체를 덮는가**를 잰다.
 */
test('★★ deploy-nas 기본값이 배포 묶음 전체를 덮는다 (하나만 올리면 짝이 깨진다)', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const def = defaultOf(y, 'files');
  assert.ok(def, 'files 기본값을 못 찾았다');

  const have = new Set(def.split(/\s+/).filter(Boolean).map((f) => path.basename(f)));
  const need = require('../ui/platform/build-embed.js').required();
  const missing = need.filter((f) => !have.has(f));

  assert.deepStrictEqual(missing, [],
    `기본값이 ${missing.length}개를 빠뜨린다 — 그 파일들은 NAS 에 옛 판으로 남고, `
    + '짝이 안 맞으면 화면이 오류 없이 빈다');

  /* ★ 반대쪽도 본다: 묶음에 없는 것을 올리면 웹 루트에 쓰레기가 쌓인다 */
  const extra = [...have].filter((f) => need.indexOf(f) === -1);
  assert.deepStrictEqual(extra, [],
    `묶음에 없는 파일을 올린다: ${extra.join(', ')}`);
});

/**
 * ★ 목록을 **손으로 적어 두지 않았는지** 본다. 적어 두면 화면이 하나 늘 때
 *   `required()` 만 늘고 기본값은 그대로 남는다 — 위 검사가 그때 울지만,
 *   울고 나서 고치는 것보다 **애초에 한 곳에서 나오는 것**이 낫다.
 */
test('★ 배포 묶음의 단일 출처는 build-embed 의 required() 다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  assert.match(y, /required\(\)/,
    '워크플로에 단일 출처가 어디인지 적혀 있지 않다 — 다음 사람이 손으로 고친다');
});

/**
 * ★★★ **탐침이 이 워크플로의 유일한 판정이다** 〈2026-08-22 · D-84〉.
 *
 *   앞 판에는 올리는 단계가 있었고, 그 뒤에 「닿았는지」를 재는 단계가 따로
 *   있었다. 쓰기를 지운 지금은 **재는 것이 하는 일의 전부**다.
 *
 *   ★ 그래서 **실패를 삼키면 안 된다.** 앞 판의 탐침에는 `|| true` 가 붙어
 *     있었다 — 뒤에 올리는 단계가 있을 때는 그것으로 충분했지만, 지금 삼키면
 *     이 워크플로는 **어떤 경우에도 초록**이 된다. 초록이 아무 뜻이 없어진다.
 *
 *   ★ 재는 목록은 `files` 에서 받는다. 스크립트 기본값 넷만 재면, 옛 판인
 *     파일이 나머지 열둘 중에 있을 때 **초록으로 지나간다** (M-22 와 같은 결).
 */
test('★★★ 탐침이 실패를 삼키지 않고, 배포 목록 전부를 잰다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const step = stepOf(y, 'Check served build');
  assert.ok(step, 'Check served build 단계가 없다 — 재는 것이 이 워크플로의 일이다');

  assert.match(step, /verify-served\.sh/, '지문 대조 스크립트를 안 쓴다');
  assert.ok(!/\|\|\s*true/.test(step),
    '탐침이 실패를 삼킨다 (|| true) — 이제 이것 말고 판정이 없다. 초록이 거짓말을 한다');
  assert.match(step, /FILES: \$\{\{ inputs\.files \}\}/,
    '재는 목록을 files 에서 안 받는다 — 기본값 넷만 재면 나머지가 옛 판이어도 초록이다');
  assert.match(step, /basename/, '경로를 파일 이름으로 바꾸지 않는다 — 스크립트가 못 읽는다');

  /* ★ dry run 에서는 돌지 않는다 — 거기서는 NAS 에 닿지도 않는다 */
  assert.match(step, /if:.*!inputs\.dry_run/, 'dry run 에서도 재려고 한다');
});

/**
 * ★★ 재는 규칙은 **한 곳에만** 둔다. 탐침과 배포 확인이 두 벌이면 한쪽만
 *   고쳐지고, 그때 「탐침은 초록인데 배포는 빨갛다」가 되어 어느 쪽을 믿을지
 *   모르게 된다.
 */
test('★★ 탐침과 배포 확인이 같은 스크립트를 쓴다 (두 벌로 갈리지 않는다)', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  /* ★ 〈2026-08-22 · D-84〉 앞 판은 **둘**이었다(탐침 + 배포 뒤 확인). 쓰기를
     지웠으므로 이제 **한 곳**이다. 둘로 늘면 쓰기가 되살아났다는 뜻이다 */
  const uses = (y.match(/verify-served\.sh/g) || []).length;
  assert.strictEqual(uses, 2,
    `verify-served.sh 를 쓰는 자리가 ${uses}곳이다 — 탐침과 배포 뒤 확인 둘이어야 한다`);

  const sh = fs.readFileSync(path.join(ROOT, 'deploy', 'verify-served.sh'), 'utf8');
  /* ★ 세 자리를 **각각** 재는가. 둘만 재면 「어디서 갈렸는지」가 사라진다 */
  ['저장소', '디스크', 'HTTP'].forEach((k) => {
    assert.ok(sh.includes(k), `확인 스크립트가 「${k}」 를 안 잰다`);
  });
  assert.match(sh, /exit "\$BAD"/, '갈렸는데도 0 으로 끝난다 — 초록이 거짓말을 한다');
});

/**
 * ★★ **손대지 않고 눌러도 NAS 는 그대로다** 〈2026-08-22 · D-84〉.
 *
 *   앞 판은 이것을 `probe`·`allow_write` 두 잠금으로 지켰다. 지금은 **쓰는
 *   단계 자체가 없어서** 지킬 잠금이 없다 — 그 사실을 여기서 못 박는다.
 *   입력이 셋으로 줄었는지까지 재는 이유: 넷째가 생기면 그것이 대개
 *   「쓸까 말까」를 묻는 손잡이다.
 */
test('★★ 입력은 셋뿐이다 — 조합이 늘지 않는다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const keys = [...y.matchAll(/^      (\w+):$/gm)].map(m => m[1]);
  assert.deepStrictEqual(keys, ['files', 'dest', 'dry_run'],
    `입력이 ${keys.join(' · ')} 다 — 쓰기를 되살리는 손잡이가 붙지 않았는지 본다`);

  /* ★ dry run 이 기본이다. 손대지 않고 누르면 **NAS 에 닿지도 않는다**.
     `defaultOf` 는 따옴표 친 기본값만 읽는데 이 값은 boolean 이라 직접 본다 */
  const dr = /^      dry_run:$([\s\S]*?)(?=^ {0,6}\S)/m.exec(y);
  assert.ok(dr, 'dry_run 입력을 못 찾았다');
  assert.match(dr[1], /default:\s*true/, 'dry_run 기본이 꺼져 있다');
});

/**
 * ★★★ **화면을 올리는 길을 한 줄로 만들었다** 〈2026-08-23〉.
 *
 *   지금까지 이 일을 손으로 세 줄에 나눠 쳤고 **세 줄 다 한 번씩 틀렸다**:
 *   ① 맥에 없는 NAS 경로를 `--out` 에 줬다 ② 붙여넣은 주석을 zsh 가 명령으로
 *   읽었다 ③ `사용자@주소` 예시를 그대로 넣었다. 셋 다 사람 잘못이 아니라
 *   **안내가 나눠져 있어서** 난 일이다.
 */
test('★★★ 화면 올리기 스크립트가 걸려 넘어질 곳을 먼저 막는다', () => {
  const p = path.join(ROOT, 'deploy', 'screens.sh');
  assert.ok(fs.existsSync(p), 'deploy/screens.sh 가 없다');
  const sh = fs.readFileSync(p, 'utf8');

  /* ① 접속정보를 파일에 적지 않는다 (§2) */
  assert.match(sh, /LP_NAS_HOST/, '접속정보를 환경변수로 안 받는다');
  assert.ok(!/@[a-z0-9.-]+\.(ts\.net|synology|local)\b/i.test(sh.replace(/example\.local/g, '')),
    '주소가 파일에 박혀 있다 — 이 저장소에 접속정보를 두지 않는다');

  /* ② **예시를 그대로 넣은 것**을 잡는다. ssh 는 「hostname contains invalid
     characters」라고만 말해서, 예시를 안 바꿨다는 생각이 안 든다 */
  assert.match(sh, /grep -q '\[\^ -~\]'/, '예시(한글) 주소를 안 걸러낸다');
  assert.match(sh, /바꿔 넣으실 자리/, '무엇이 잘못됐는지 사람 말로 안 적는다');

  /* ③ `-O` 를 뺄 수 없다 — Synology 의 SFTP 가둠 설정 때문이다 */
  const scps = sh.split('\n').filter(l => /^\s*scp\s/.test(l));
  assert.ok(scps.length > 0, 'scp 가 없다');
  scps.forEach(l => assert.match(l, /\bscp\s+-O\b/,
    'scp 에 -O 가 없다 — 「그런 폴더 없음」이 나오고 멀쩡한 경로를 다시 확인하게 된다'));

  /* ④ 낼 곳이 im-flow 인지 본다 — 잘못 적으면 16개가 엉뚱한 곳에 쏟아진다 */
  assert.match(sh, /\*\/im-flow\) : ;;/, '낼 곳을 안 가린다');

  /* ⑤ ★★ **올리고 끝내지 않는다.** 「올렸다」와 「닿았다」는 다른 말이고
     이 저장소는 그 차이로 세 번 헤맸다 (M-20 · M-22 · M-25) */
  assert.match(sh, /sha256sum/, '올린 뒤 지문을 안 잰다');
  assert.match(sh, /exit 1/, '어긋나도 0 으로 끝난다 — 초록이 거짓말을 한다');
  assert.match(sh, /판 \$STAMP/, '어느 판인지 안 알려 준다');
});

test('★★★ 배포는 교차검증을 통과해야만 시작한다 (기억이 아니라 구조로)', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');

  /* ★★ 왜 이 검사가 있나 〈2026-08-23〉. 「배포 전 교차검증」은 규칙으로만
     있었고, 그래서 **하루에 두 번 빨간 채로 밀었다.** 기억에 기대는 규칙은
     바쁠 때 가장 먼저 빠진다. 이제 초록이 아니면 올릴 수가 없다. */
  const guard = /^  guard:$/m.exec(y);
  assert.ok(guard, 'guard 판이 없다 — 검사 없이 배포가 돈다');

  const block = y.slice(guard.index + guard[0].length).split(/^  \w[\w-]*:$/m)[0];

  /* ① 테스트 전체를 다시 돈다 — 내 손의 결과가 아니라 **러너가 잰 것**이라야 뜻이 있다 */
  assert.match(block, /node --test im-agent\/test\/\*\.test\.js/,
    'guard 가 테스트를 안 돌린다');

  /* ② 지문을 맞춰 본다. 화면을 고치고 지문을 다시 안 찍으면 배포는 새 파일을
     올리는데 화면은 옛 판을 말한다 — 그러면 M-25 를 지문으로 가릴 수가 없다 */
  assert.match(block, /im:stamp -- --check/, 'guard 가 판 지문을 안 맞춰 본다');

  /* ③ 실패가 로그에 묻히지 않게 못 지나간 것만 다시 뽑는다 */
  assert.match(block, /if: failure\(\)/, '실패했을 때 무엇이 깨졌는지 안 뽑는다');

  /* ④ ★ **배포가 여기에 매달려 있어야 한다.** 판만 만들고 안 묶으면
     초록이든 빨강이든 그대로 올라간다 — 있으나 마나다 */
  const dep = /^  deploy:\n(?:.*\n)*?    needs: (.+)$/m.exec(y);
  assert.ok(dep, 'deploy 에 needs 가 없다 — 검사를 건너뛰고 올린다');
  assert.match(dep[1], /guard/, `deploy 가 guard 를 안 기다린다: ${dep[1]}`);

  /* ⑤ ★★ **알림이 함께 사라지지 않는다.** guard 가 빨가면 deploy 는
     「실패」가 아니라 「건너뜀」이 된다. 알림이 deploy 만 보고 있으면
     그날은 아무한테도 안 간다 — 조용히 죽는 것이 이 저장소의 금기다 (§2) */
  const al = /^  alert:\n    needs: (.+)$/m.exec(y);
  assert.ok(al, 'alert 의 needs 를 못 찾았다');
  assert.match(al[1], /guard/,
    `alert 가 guard 를 안 본다: ${al[1]} — 검사가 막은 날 알림이 조용히 사라진다`);
});

test('★★★ 올리기 「전」에 재는 것은 재기만 한다 — 바뀐 파일이 배포를 막지 않는다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');

  /* ★★★ 무슨 일이 있었나 〈2026-08-23 · run #44〉.
     올리기 **전** 탐침이 올린 **뒤**와 똑같은 잣대를 썼다. 그래서
     「저장소 ≠ 디스크」를 「올리기가 안 됐다」로 읽고 배포를 세웠다.
     그런데 올리기 전에 그 둘이 다른 것은 **올리는 이유 그 자체**다.
     → **바꿀 것이 있는 날에만 막히는** 장치였다. 16개 중 4개에서 죽고
       Upload·Verify 가 통째로 건너뛰어졌다 — 그리고 나는 사장님께
       「배포했다」고 말할 뻔했다. */
  const before = stepOf(y, 'Check served build');
  assert.ok(before, 'Check served build 단계가 없다');
  assert.match(before, /LP_BEFORE: '1'/,
    '올리기 전 탐침이 「전」이라고 밝히지 않는다 — 바뀐 파일마다 배포가 막힌다');

  /* ★ 올린 **뒤**에는 그대로 치명이다. 여기까지 무르면 초록이 거짓말을 한다 */
  const after = stepOf(y, 'Verify deployed');
  assert.ok(after, 'Verify deployed 단계가 없다');
  assert.ok(!/LP_BEFORE/.test(after),
    '배포 뒤 확인까지 무르게 했다 — 올리기가 안 돼도 초록으로 끝난다');

  /* ★ 스크립트 쪽도 두 잣대를 실제로 가지고 있는가 */
  const sh = fs.readFileSync(path.join(ROOT, 'deploy', 'verify-served.sh'), 'utf8');
  assert.match(sh, /BEFORE="\$\{LP_BEFORE:-0\}"/, '스크립트가 LP_BEFORE 를 안 읽는다');
  assert.match(sh, /LP_BEFORE=1/, '무엇으로 켜는지 파일에 안 적혀 있다');
  assert.match(sh, /exit "\$BAD"/, '뒤 확인이 여전히 치명인지 못 잰다');
});

test('★★ 두 번째 길임을 스스로 밝힌다 (쓰는 곳이 조용히 둘이 되지 않게)', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'deploy', 'screens.sh'), 'utf8');
  /* ★ D-84 의 핵심은 「워크플로냐 맥이냐」가 아니라 **「하나여야 한다」**였다.
     대비 경로가 자기가 대비라고 말하지 않으면, 바쁜 날 둘 다 쓰게 된다 */
  assert.match(sh, /두 번째 길/, '평소 길이 아님을 안 알린다');
  assert.match(sh, /deploy-nas/, '평소에 어디로 올리는지 안 알려 준다');
  assert.match(sh, /D-84/, '왜 하나여야 하는지 근거를 안 남긴다');
});

test('★★ 앱이 쓰는 길로도 재고, 못 쟀으면 못 쟀다고 말한다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const s = stepOf(y, 'Check via app path');
  assert.ok(s, '앱이 쓰는 길로 재는 단계가 없다 — M-25 의 갈림이 그대로 남는다');

  /* ★ 올린 **뒤**라야 뜻이 있다. 앞에 두면 늘 옛 파일을 잰다 */
  const i = y.indexOf('name: Check via app path');
  const u = y.indexOf('name: Upload');
  assert.ok(u !== -1 && i > u, '앱 경로 확인이 Upload 보다 앞에 있다 — 옛 파일을 잰다');

  /* ★★ 주소가 없을 때 **조용히 건너뛰지 않는다.** 「못 쟀다」가 안 보이면
     「쟀는데 맞았다」와 구분이 안 된다 (§2) */
  assert.match(s, /::warning::/, '주소가 없을 때 아무 말도 안 한다');
  assert.match(s, /GITHUB_STEP_SUMMARY/, '요약에 남기지 않는다 — 로그는 안 열어 본다');

  /* ★ 다르면 빨갛게 끝난다 — 여기서 무르면 이 단계가 있으나 마나다 */
  assert.match(s, /exit "\$BAD"/, '어긋나도 0 으로 끝난다');
});
