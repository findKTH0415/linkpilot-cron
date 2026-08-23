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
  assert.match(ver, /FILES: \$\{\{ needs\.plan\.outputs\.files \}\}/,
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
  /* ★ 〈2026-08-23 · D-88〉 자동으로 돌게 되면서 `inputs.dry_run` 을 직접 읽으면
     **push 에서 빈 값**이 된다. 빈 값은 거짓이라 단계가 돌긴 하지만, 그건
     「돌기로 정해서 도는 것」이 아니라 **우연히 도는 것**이다. 판정은 `plan` 이
     한 곳에서 한다 — 여기서도 그 출처를 읽는지 본다 */
  assert.match(s, /if:.*needs\.plan\.outputs\.dry_run/,
    'Check serving 이 plan 의 판정을 안 본다 — push 에서 inputs 는 비어 있다');

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
  assert.match(step, /FILES: \$\{\{ needs\.plan\.outputs\.files \}\}/,
    '재는 목록을 plan 에서 안 받는다 — 기본값 넷만 재면 나머지가 옛 판이어도 초록이다');
  assert.match(step, /basename/, '경로를 파일 이름으로 바꾸지 않는다 — 스크립트가 못 읽는다');

  /* ★ dry run 에서는 돌지 않는다 — 거기서는 NAS 에 닿지도 않는다 */
  assert.match(step, /if:.*needs\.plan\.outputs\.dry_run/, 'dry run 에서도 재려고 한다');
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
  /* ★★ **주석을 떼고 센다** 〈2026-08-23 · 이 검사에 두 번째로 걸렸다〉.
     주석에서 「`verify-served.sh` 가 …라고 적어 둔 그 이유다」라고 **인용만
     했는데** 셋으로 세어 빨개졌다. 세는 것은 **쓰는 자리**이지 언급이 아니다.
     같은 결함을 `fetch-depth` 검사에서도 만났다 — **경위를 잘 적어 둘수록
     검사가 눈이 머는** 구조다. */
  const code = y.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  const uses = (code.match(/verify-served\.sh/g) || []).length;
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
test('★★ 입력은 넷뿐이다 — 조합이 늘지 않는다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const keys = [...y.matchAll(/^      (\w+):$/gm)].map(m => m[1]);
  /* ★★★ 〈2026-08-23 · D-88〉 **넷째가 붙었다 — 그리고 그것이 이 검사가 잡으라던
     바로 그 자리다.** 앞 판의 이유는 「넷째가 생기면 **대개** 쓸까 말까를 묻는
     손잡이다」였다. `engine` 은 그 종류가 아니다: 쓸지 말지는 `dry_run` 하나가
     그대로 쥐고, `engine` 은 **무엇까지 올릴지**를 고른다.
     ★ 그러니 「넷이면 통과」로 무르게 두지 않는다. **이름을 못 박는다** —
       다섯째가 붙는 날 이 검사가 다시 울어야 한다 */
  assert.deepStrictEqual(keys, ['files', 'dest', 'dry_run', 'engine'],
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
  /* ★ 목록을 워크플로에 옮겨 적지 않는다. 손으로 적으면 테스트 폴더가 하나
     늘어난 날 이 판만 옛 목록을 돈다 — `test/alert.test.js`(실패 알림 경로)가
     실제로 그 밖에 있었다. `npm test` 한 곳에서 나오게 둔다 */
  assert.match(block, /npm test/, 'guard 가 테스트를 안 돌린다');
  assert.ok(!/node --test im-agent\/test/.test(block),
    'guard 가 테스트 목록을 손으로 옮겨 적었다 — 폴더가 늘면 이 판만 옛 목록을 돈다');

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

test('★★★ 배포가 라우트까지 잰다 (만들어 두고 안 돌린 검사를 자동으로 돌린다)', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');

  /* ★★★ 무슨 일이 있었나 〈2026-08-23〉.
     2026-08-18 에 본체가 라우팅 표를 손으로 옮기다 **11개를 빠뜨려 404** 가
     났다(M-11). 그것을 잡으라고 `verify:nas` 를 만들었다(M-12).
     ★ 그런데 **사람이 손으로 쳐야 도는 것**이라 아무도 안 쳤고, 오늘 같은
       종류가 다시 났다 — 「＋ 신규프로젝트 → 만들기」가 POST /projects 에서 404.
     ★ 막는 장치는 **돌아야 막는다.** 만들어 둔 것과 도는 것은 다른 말이다. */
  const s = stepOf(y, 'Check routes');
  assert.ok(s, '배포가 라우트를 안 잰다 — 서버가 옛 표를 들고 있어도 초록으로 끝난다');
  assert.match(s, /verify:nas/, '만들어 둔 검사를 안 쓰고 새로 짰다 — 두 벌이 된다');

  /* ★ 못 쟀을 때 **조용히 넘어가지 않는다** (종료코드 2) */
  assert.match(s, /::warning::/, '다 못 쟀을 때 아무 말도 안 한다');
  assert.match(s, /GITHUB_STEP_SUMMARY/, '요약에 안 남긴다 — 로그는 안 열어 본다');

  /* ★ 404 는 치명이다. 여기서 무르면 이 단계가 있으나 마나다 */
  assert.match(s, /::error::/, '404 를 오류로 안 적는다');
  assert.match(s, /exit 1/, '404 인데 0 으로 끝난다');

  /* ★ 어느 길로 쟀는지 적는다 — 안 적으면 「어디가 404 인지」를 또 못 가른다 (M-25) */
  assert.match(s, /잰 길/, '어느 주소로 쟀는지 안 적는다');

  /* ★★ **node 가 있어야 돈다.** 없으면 이 단계만 조용히 죽는데,
     하필 조용히 죽으면 안 되는 단계다 */
  const dep = y.slice(y.indexOf('  deploy:'), y.indexOf('name: Check secrets'));
  assert.match(dep, /actions\/setup-node/,
    '배포 판에 node 가 없다 — 라우트 점검이 조용히 죽는다');
});

/* ═════════ **실시간 자동배포** 〈2026-08-23 사장님 지시 · D-88〉 ═════════ */

/**
 * ★★★ **눌러야 도는 장치는 안 돈다.**
 *
 *   앞 판은 `workflow_dispatch` 전용이었다. 이유는 「아무도 안 보는 사이에
 *   운영 화면을 덮지 않기 위해」였는데, **실제로 일어난 일은 그 반대**였다 —
 *   눌러야 도니까 안 눌렀고, 그 사이 NAS 가 조용히 옛 판으로 남았다 (D-86).
 *   같은 결의 사고가 `verify:nas` 에도 있었다: 만들어 두고 아무도 안 쳐서
 *   같은 404 가 다시 났다 (M-11 · M-12 · D-87).
 *
 * ★ 그래서 **트리거가 있는지**를 잰다. 그리고 아무 브랜치에서나 돌면 안 된다 —
 *   검토를 안 거친 푸시가 곧바로 운영에 닿는 길은 만들지 않는다.
 */
test('★★★ main 에 닿으면 자동으로 돈다 — 그리고 거기서만 돈다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');

  const on = /^on:\n([\s\S]*?)^concurrency:/m.exec(y);
  assert.ok(on, 'on: 블록을 못 찾았다');
  assert.match(on[1], /^  push:$/m,
    'push 트리거가 없다 — 눌러야 도는 장치는 안 돈다 (D-86 · D-87 이 그 이야기다)');

  /* ★ 작업선에서는 돌지 않는다. `claude/**` 푸시마다 운영이 바뀌면
     「검토 뒤에 올린다」가 없어진다 */
  const br = /^    branches: \[([^\]]*)\]/m.exec(on[1]);
  assert.ok(br, 'push 에 branches 제한이 없다 — 아무 작업선에서나 운영이 바뀐다');
  assert.strictEqual(br[1].replace(/['"\s]/g, ''), 'main',
    `자동 배포가 도는 브랜치가 ${br[1]} 다 — main 하나여야 한다`);

  /* ★ 손으로 띄우는 길은 남아 있어야 한다. Actions 가 늦거나 다시 올려야 할
     때 기댈 곳이 없어진다 */
  assert.match(on[1], /^  workflow_dispatch:$/m, '손으로 띄우는 길이 사라졌다');

  /* ★★ `paths` 로 좁히되 **올릴 것이 든 자리를 빠뜨리면 조용히 안 올라간다.**
     빠진 자리는 오류를 안 낸다 — 그냥 배포가 안 도는 날이 된다 */
  ['im-agent/**', 'deploy/**', '.github/workflows/deploy-nas.yml'].forEach((p) => {
    assert.ok(on[1].includes(p), `paths 에 ${p} 가 없다 — 그 자리를 고친 날은 배포가 안 돈다`);
  });

  /* ★★★ 자동이 된 것이지 **검사가 빠진 것이 아니다.** guard 는 그대로다 */
  assert.match(y, /^  guard:$/m, '자동으로 돌면서 교차검증 판이 사라졌다');
});

/**
 * ★★★ **push 로 들어오면 `inputs.*` 는 통째로 빈 값이다** 〈2026-08-23 · D-88〉.
 *
 *   이것이 이번 작업에서 가장 조용한 함정이었다. 아래 단계들은 전부
 *   `inputs.files` 를 읽고 있었으므로, 트리거만 붙이면 **빈 목록을 빈 자리에
 *   올리는** 판이 된다. 그리고 그것은 **오류를 안 낸다** — 초록으로 끝나고
 *   아무것도 안 바뀐다. 이 저장소에서 가장 비싼 상태다 (「초록인데 안 잰 것」).
 *
 * ★ 그래서 판정을 `plan` 한 곳으로 모았다. **`inputs.` 를 직접 읽는 자리가
 *   plan 밖에 남아 있으면 그 자리만 push 에서 빈다.**
 */
test('★★★ push 에서 빈 값이 되지 않는다 — 판정은 plan 한 곳에서만 한다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');

  const plan = /^  plan:$/m.exec(y);
  assert.ok(plan, 'plan 판이 없다 — push 에서 무엇을 올릴지 정하는 곳이 없다');
  ['files', 'dest', 'dry_run', 'engine'].forEach((k) => {
    assert.match(y, new RegExp('^      ' + k + ': \\$\\{\\{ steps\\.p\\.outputs\\.' + k + ' \\}\\}$', 'm'),
      `plan 이 ${k} 를 출력으로 안 넘긴다`);
  });

  /* ★★ **plan 밖에서 `inputs.` 를 읽으면 그 자리가 push 에서 빈다.**
     주석은 뺀다 — 경위를 적은 글까지 걸리면 검사가 글을 못 쓰게 만든다 */
  const planStart = plan.index;
  const planEnd = y.indexOf('\n  guard:');
  assert.ok(planEnd > planStart, 'guard 판을 못 찾았다');
  const outside = (y.slice(0, planStart) + y.slice(planEnd))
    .split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  const leaks = [...outside.matchAll(/\$\{\{\s*inputs\.\w+\s*\}\}/g)].map(m => m[0]);
  assert.deepStrictEqual(leaks, [],
    `plan 밖에서 inputs 를 직접 읽는다: ${leaks.join(' · ')} — push 로 들어오면 그 자리가 빈다`);

  /* ★★★ **주석을 떼고 본다** 〈2026-08-23 · 이 검사를 만들다가 실제로 당했다〉.
     `fetch-depth: 0` 을 검사해 놓고 값을 `1` 로 바꿔 봤더니 **여전히 초록**이었다 —
     바로 위 주석에 「`fetch-depth: 0` 이 필요하다」라고 적어 둔 글자를 코드로
     읽고 있었다. **경위를 잘 적어 둘수록 검사가 눈이 머는** 구조였다.
     ★ 이 저장소의 `stepOf` 가 끝의 주석을 떼는 것과 같은 이유다. */
  const body = y.slice(planStart, planEnd)
    .split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  /* ★ 「`required()` 라는 글자가 있나」로는 부족하다 — 바로 아래 `echo` 줄에도
     그 글자가 있어서, **부르는 자리를 망가뜨려도 초록**이었다(실측).
     `FILES=` 에 그 결과가 실제로 담기는지를 본다 */
  assert.match(body, /FILES=\$\([^\n]*build-embed\.js'\)\.required\(\)/,
    'plan 이 화면 묶음을 required() 에서 안 받는다 — 손으로 적으면 화면이 는 날 짝이 깨진다');
  assert.match(body, /::error::올릴 목록이 비었다/,
    '빈 목록을 그냥 넘긴다 — 초록으로 끝나고 아무것도 안 바뀐다');

  /* ★★ `git diff <이전> <지금>` 을 하려면 이력이 있어야 한다. 기본 checkout 은
     커밋 하나만 받아 와서 「그런 커밋 없음」으로 못 잰다 */
  assert.match(body, /fetch-depth: 0/,
    'plan 이 이력을 안 받아 온다 — 바뀐 것을 못 재고, 못 잰 채로 넘어간다');

  /* ★ 배포가 plan 에 매달려 있어야 한다. 안 매달면 출력이 빈 채로 돈다 */
  const dep = /^  deploy:\n(?:.*\n)*?    needs: (.+)$/m.exec(y);
  assert.ok(dep, 'deploy 에 needs 가 없다');
  assert.match(dep[1], /plan/, `deploy 가 plan 을 안 기다린다: ${dep[1]}`);
});

/**
 * ★★★ **엔진을 올리는 자리가 이 저장소에 없었다** 〈2026-08-23 · D-87 · D-88〉.
 *
 *   화면 열여섯은 워크플로가 올렸다. 엔진(`im-agent/**`)은 **아무도 안 올렸다** —
 *   NAS 에 `im-agent.bak-*` 가 스무 개 쌓여 있는 것이 그 증거다(사람이 손으로
 *   tar 를 말아 왔다). 그래서 화면은 새 판, 서버는 옛 라우팅 표인 상태가 났고
 *   「＋ 신규프로젝트 → 만들기」가 `POST /projects` 에서 404 였다.
 *
 * ★★ **화면만 자동으로 올리면 그 어긋남을 더 빨리 만들 뿐이다.**
 */
test('★★★ 엔진도 올린다 — 그리고 안 살아나면 스스로 되돌린다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');

  const s = stepOf(y, 'Deploy engine (D-87 · D-88)');
  assert.ok(s, '엔진을 올리는 단계가 없다 — 화면만 새 판이 되고 서버는 옛 표를 든다 (D-87)');
  assert.match(s, /deploy\/engine\.sh/, '엔진 배포를 워크플로 안에 손으로 짰다 — 맥에서 돌릴 때는 그 판이 없어진다');
  assert.ok(!/\|\|\s*true/.test(s), '엔진 배포가 실패를 삼킨다 — 되돌린 것은 배포가 된 것이 아니다');

  /* ★★ **화면보다 뒤, 라우트 재기보다 앞**이라야 `Check routes` 가
     방금 올린 엔진을 잰다. 앞에 두면 옛 엔진을 재고, 뒤에 두면 한 판 늦다 */
  const iUp = y.indexOf('- name: Upload');
  const iEng = y.indexOf('- name: Deploy engine');
  const iRt = y.indexOf('- name: Check routes');
  assert.ok(iUp < iEng, '엔진을 화면보다 먼저 올린다');
  assert.ok(iEng < iRt, '라우트를 잰 뒤에 엔진을 올린다 — 그러면 옛 엔진을 잰 것이다');

  /* ★ 안 올린 날에는 **안 올렸다고 말한다.** 아무 줄도 안 남기면
     「올렸는데 조용했다」와 구분이 안 된다 (§2) */
  assert.ok(stepOf(y, 'Engine skipped'), '엔진을 안 올린 날 아무 말도 안 한다');

  /* ── 스크립트 쪽 ── */
  const p = path.join(ROOT, 'deploy', 'engine.sh');
  assert.ok(fs.existsSync(p), 'deploy/engine.sh 가 없다');
  const sh = fs.readFileSync(p, 'utf8');

  /* ① 접속정보를 파일에 두지 않는다 (§2 · D-10 — 이 저장소는 public 이다) */
  assert.ok(!/@[a-z0-9.-]+\.(ts\.net|synology|local)\b/i.test(sh),
    '주소가 파일에 박혀 있다 — 이 저장소에 접속정보를 두지 않는다');

  /* ② ★★★ **자동배포에는 지켜보는 사람이 없다.** 안 살아나면 스스로 되돌려야
     한다 — 여기서 손을 놓으면 서비스가 멈춘 채로 아침까지 간다 */
  assert.match(sh, /되돌린다/, '안 살아났을 때 되돌리지 않는다');
  assert.match(sh, /mv '\$BAK' im-agent/, '되돌리는 명령이 실제로 없다');
  assert.match(sh, /exit 5/, '되돌린 뒤 초록으로 끝난다 — 되돌린 것은 배포가 된 것이 아니다');
  assert.match(sh, /exit 6/, '되돌린 것도 안 살 때를 안 가린다 — 그때는 사람이 봐야 한다');

  /* ③ 「띄웠다」로 끝내지 않는다. 살아났는지 **묻는다** */
  assert.match(sh, /curl[^\n]*healthz/, '살아났는지 안 묻는다');
  assert.match(sh, /api\/linkpilot\/intake/,
    '묻는 길이 하나뿐이다 — healthz 가 없는 판에서 멀쩡한 엔진을 되돌리게 된다');

  /* ④ ★ 되돌릴 자리를 **먼저** 만든다. 갈아 끼운 뒤에 만들면 되돌릴 것이 없다 */
  assert.ok(sh.indexOf("mv im-agent '$BAK'") < sh.indexOf('./start-engine.sh'),
    '백업보다 재시작이 앞이다 — 되돌릴 자리가 없는 순간이 생긴다');

  /* ⑤ ★★ **살아난 뒤에만** 옛 백업을 지운다. 되돌릴 자리를 지우고 죽으면 끝이다 */
  /* ★ 경위를 적은 주석에도 `im-agent.bak-*` 가 나온다. **지우는 명령**을 찾는다 —
     글자만 세면 주석 자리를 코드로 읽는다 */
  const alive = sh.indexOf('if [ "$ALIVE" = "1" ]');
  const prune = sh.indexOf('ls -1d im-agent.bak-*');
  assert.ok(prune > 0, '옛 백업을 지우지 않는다 — 스무 개가 쌓여 있던 자리다');
  assert.ok(alive > 0 && prune > alive,
    '백업 정리가 살아났는지 묻기보다 앞이다 — 되돌릴 자리를 먼저 지운다');
  /* ★★ **지웠다고 말하기 전에 다시 센다** 〈2026-08-23 · 실제로 안 지워지고 있었다〉.
     앞 판은 결과를 안 보고 「N개 지움」이라고 적었는데 NAS 에는 열여섯 개가
     그대로 남아 있었다 — 재는 장치가 아무것도 안 재고 초록으로 끝났다 (M-11) */
  assert.ok(/ls -1d im-agent\.bak-\* 2>\/dev\/null \| wc -l/.test(sh),
    '지운 뒤 다시 세지 않는다 — 안 지워져도 「지움」이라고 말한다');
  assert.ok(sh.indexOf('아직 ${LEFT}개가 남아 있다') !== -1,
    '남아 있는데도 조용히 넘어간다');

  /* ⑥ ★ 자리부터 본다. 없는 자리에 tar 를 풀면 반쯤 풀린 상태가 남는다 */
  assert.match(sh, /NOSTART/,
    '기동 스크립트가 있는지 안 본다 — 내려놓고 못 띄우는 자리가 생긴다');

  /* ⑦ ★ 시각은 KST 로 만든다. 러너는 UTC 라 백업 이름이 아홉 시간 어긋난다 (§5) */
  assert.match(sh, /TZ=Asia\/Seoul/, '백업 이름의 시각이 서버 로컬타임이다');
});

/**
 * ★★★ **404 는 자리가 셋이다 — 갈라 놓고 말한다** 〈2026-08-23 · D-87 정정〉.
 *
 *   실행 #56 에서 둘이 **동시에** 성립했다:
 *     · 엔진 배포 성공 — 새 판을 갈아 끼우고 **1초 만에 HTTP 200** (8181 직행)
 *     · 그런데 바깥(포트 80)의 `/api/linkpilot/intake` 는 **여전히 404**
 *
 *   그러니 「서버가 옛 라우팅 표를 들고 있다」는 **더 이상 유일한 설명이 아니다.**
 *   나는 그 하나로 단정하고 사장님께 「NAS 만 옛 판을 들고 있는 것이 맞습니다」
 *   라고 적었다 — **M-25 가 「셋을 갈라 놓고 말한다」고 적어 둔 그 자리에서 또 그랬다.**
 *
 * ★ 그래서 안팎에서 같은 주소를 두드려 **어디서 끊기는지**를 그 자리에서 가른다.
 */
test('★★★ 404 가 엔진 탓인지 앞단 탓인지 갈라 놓는다 (D-87 정정)', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const s = stepOf(y, 'Split inside vs outside (D-87 · M-25)');
  assert.ok(s, '안팎을 갈라 재는 단계가 없다 — 404 를 또 한 가지 원인으로 단정하게 된다');

  /* ① 안(8181 직행)과 밖(포트 80)을 **둘 다** 잰다. 하나만 재면 갈리지 않는다 */
  assert.match(s, /127\.0\.0\.1:8181/, '엔진에 직접 안 물어본다 — 그러면 앞단과 구분이 안 된다');
  assert.match(s, /http:\/\/\$\{NAS_HOST\}\/api\/linkpilot\/intake/,
    '바깥에서 안 재 본다 — 갈라 낼 반대쪽이 없다');

  /* ② 접두사 있는 길과 없는 길을 **둘 다** 두드린다. 엔진이 접두사 없이
     붙어 있는 경우가 실제 후보다 */
  assert.match(s, /\/api\/linkpilot\/intake/, '접두사 붙은 길을 안 잰다');
  assert.match(s, /probe_in \/intake/, '접두사 없는 길을 안 잰다 — 세 번째 후보가 사라진다');

  /* ③ ★★ **404 가 아니면 길은 있는 것**이다. 200 만 통과로 보면 401 인 길을
     「없다」고 읽는다 — verify:nas 와 같은 잣대를 쓴다 */
  assert.match(s, /alive\(\)/, '404 와 그 밖을 가르는 잣대가 없다');
  assert.ok(!/\[ "\$IN_API" = "200" \]/.test(s),
    '200 만 통과로 본다 — 401 인 길을 「없다」고 읽는다');

  /* ④ 세 자리를 **각각** 이름 붙여 말한다. 뭉뚱그리면 또 엉뚱한 곳을 판다 */
  ['앞단', '접두사', '엔진'].forEach((k) => {
    assert.ok(s.includes('404 의 자리: **' + k + '**'),
      `「${k}」 자리를 안 가린다 — 셋은 화면에서 똑같이 404 로 보인다`);
  });

  /* ⑤ ★ 못 갈랐으면 **못 갈랐다고** 말한다 (§2 — 조용히 넘어가지 않는다) */
  assert.ok(s.includes('**못 갈랐다**'), '갈라 내지 못한 경우를 안 적는다');
  assert.match(s, /GITHUB_STEP_SUMMARY/, '요약에 안 남긴다 — 로그는 안 열어 본다');

  /* ⑥ ★★ **읽기만 한다.** 재려고 무언가를 바꾸면 그것이 곧 배포다 */
  assert.ok(!/\b(scp|rm |mv |touch|mkdir)\b/.test(s),
    '갈라 재는 단계가 NAS 에서 무언가를 바꾼다 — 재기만 해야 한다');

  /* ⑦ ★ 엔진을 올린 **뒤**, 라우트를 재기 **전**이라야 뜻이 있다.
     앞에 두면 옛 엔진을 재고, 뒤에 두면 이미 빨갛게 끝난 뒤다 */
  const iEng = y.indexOf('- name: Deploy engine');
  const iSplit = y.indexOf('- name: Split inside vs outside');
  const iRt = y.indexOf('- name: Check routes');
  assert.ok(iEng < iSplit && iSplit < iRt,
    '갈라 재기가 엔진 배포와 라우트 재기 사이에 없다');
});

/**
 * ★★★ **잰 길이 앱이 쓰는 길이 아니면 빨갛게 끝내지 않는다** 〈2026-08-23 · 실행 #57〉.
 *
 *   갈라 재기가 답을 줬다 — 실측:
 *     엔진 직행 8181  /api/linkpilot/intake → **200**
 *     엔진 직행 8181  /intake               → 404  (접두사로 붙어 있다 · 정상)
 *     바깥 포트 80    /api/linkpilot/intake → 404
 *
 *   **엔진에는 길이 있다.** 404 는 앞단(포트 80 가상호스트)이 그 길을 8181 로
 *   안 넘겨서 나는 것이고, 앱은 Funnel 443 으로 들어온다.
 *
 * ★ 그러면 여기서 빨갛게 끝내는 것은 **멀쩡한 배포를 늘 빨갛게 만드는 것**이다.
 *   그리고 늘 빨가면 **빨간 것을 아무도 안 보게 된다** — `verify-served.sh` 가
 *   HTTP 경고를 두고 똑같이 적어 둔 그 이유다 (M-25).
 *
 * ★★ 다만 **무르게 하는 자리가 하나뿐**이어야 한다. 「404 면 넘어간다」가 되면
 *   이 단계가 통째로 있으나 마나다.
 */
test('★★★ 404 를 무르게 하는 자리는 「앞단」 하나뿐이다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const s = stepOf(y, 'Check routes');
  assert.ok(s, 'Check routes 단계가 없다');

  /* ① 갈라 재기의 판정을 **받아야** 한다. 안 받으면 스스로 짐작하게 된다 */
  assert.match(s, /WHERE: \$\{\{ steps\.split\.outputs\.where \}\}/,
    '갈라 재기의 판정을 안 받는다 — 그러면 404 의 자리를 여기서 또 짐작한다');

  /* ② ★★ 무르는 조건이 **「앞단」이고 LP_BASE 가 없을 때**로 좁혀져 있어야 한다.
     넓히면 엔진에 길이 없는 날도 초록으로 지나간다 */
  assert.match(s, /if \[ "\$\{WHERE:-\}" = "front" \] && \[ -z "\$\{LP_BASE:-\}" \]/,
    '무르는 조건이 「앞단 ＋ LP_BASE 없음」으로 좁혀져 있지 않다');
  ['engine', 'prefix', 'unknown'].forEach((w) => {
    assert.ok(!new RegExp('"\\$\\{WHERE:-\\}" = "' + w + '"').test(s),
      `${w} 도 무르게 한다 — 그 자리는 그대로 치명이어야 한다`);
  });

  /* ③ ★ **조용히 넘어가지 않는다.** 크게 적고 요약에도 남긴다 (§2) */
  const soft = s.slice(s.indexOf('= "front"'), s.indexOf('echo "::error::'));
  assert.match(soft, /::warning::/, '무르게 넘어가면서 아무 말도 안 한다');
  assert.match(soft, /LP_BASE/, '어떻게 하면 제대로 재는지 안 알려 준다');
  assert.match(soft, /GITHUB_STEP_SUMMARY/, '요약에 안 남긴다 — 로그는 안 열어 본다');

  /* ④ ★ 치명 갈래가 **살아 있어야** 한다 */
  assert.match(s, /::error::/, '404 를 오류로 낼 길이 아예 없어졌다');
  assert.match(s, /exit 1/, '어떤 경우에도 빨갛게 끝나지 않는다 — 있으나 마나다');

  /* ⑤ ★ 갈라 재기가 판정을 **실제로 내보내야** 이 모든 것이 돈다 */
  const sp = stepOf(y, 'Split inside vs outside (D-87 · M-25)');
  assert.match(sp, /id: split/, '갈라 재기에 id 가 없다 — 판정을 받을 수가 없다');
  ['front', 'prefix', 'engine', 'ok', 'unknown'].forEach((w) => {
    assert.ok(sp.includes('echo "where=' + w + '" >> "$GITHUB_OUTPUT"'),
      `갈라 재기가 ${w} 판정을 안 내보낸다 — 그 갈래만 판정이 빈다`);
  });
});

/**
 * ★★★ **NAS 가 안 붙을 때 왜인지 말하는가** 〈2026-08-23 · 실제 사고〉.
 *
 *   배포 #67 이 `Process completed with exit code 1` 한 줄만 남기고 죽었다.
 *   원인은 NAS 가 안 붙은 것이었는데, **친절하게 적어 둔 안내가 한 글자도
 *   안 나왔다** — `ssh-keyscan` 이 실패하면서 `set -e` 가 그 자리에서
 *   스크립트를 죽였고, 안내는 그 **아래**에 있었기 때문이다.
 *
 * ★ 잘 적어 둔 안내가 **닿지 않는 자리에** 있으면 없는 것과 같다.
 */
test('★★★ NAS 가 안 붙으면 왜인지 말하고 죽는다 (안내가 닿는 자리에 있다)', () => {
  const wf = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const step = wf.slice(wf.indexOf('- name: Set up ssh'));
  const body = step.slice(0, step.indexOf('- name:', 10));

  assert.ok(/if ! ssh-keyscan/.test(body),
    'ssh-keyscan 이 맨몸으로 있다 — 실패하면 set -e 가 안내 전에 죽인다');
  assert.ok(body.indexOf('호스트키를 못 받았다') !== -1,
    '호스트키를 못 받은 경우의 안내가 없다');
  assert.ok(body.indexOf('ssh 로 못 붙었다') !== -1,
    'ssh 가 막힌 경우의 안내가 없다');

  /* ★ 둘을 **가려서** 말해야 한다 — 「기계가 안 켜졌다」와 「열쇠가 안 맞다」는
   *   고치는 사람이 다르다 */
  assert.ok(body.indexOf('기계가 지금 안 붙는다') !== -1
    && body.indexOf('기계는 켜져 있다') !== -1,
    '두 경우를 같은 말로 하면 어디를 봐야 할지 모른다');

  /* ★ 「아무것도 안 건드렸다」를 **양쪽 다** 말한다. 이 말이 없으면 사람은
   *   NAS 가 반쯤 덮인 줄 알고 겁을 낸다 */
  const said = body.split('아무것도 안 건드렸다').length - 1;
  assert.ok(said >= 2, `안 건드렸다는 말이 ${said}곳에만 있다 — 두 갈래 다 있어야 한다`);
});

/**
 * ★★★ **자료를 읽는 힘이 켜져 있는지 배포가 말한다** 〈2026-08-23 · 사장님 화면〉.
 *
 *   자료 11건 중 7건이 「못 읽었습니다 — GEMINI_API_KEY 가 필요합니다」로
 *   끝났다. 스캔 이미지와, 글자가 코드값으로만 든 PDF 둘이 거기 있었고
 *   **딜의 핵심 자료가 그쪽이었다.**
 *
 * ★ 배포는 초록이고 화면도 멀쩡하다. 빠진 것은 **품질**뿐이라 아무도 오류를
 *   안 본다 — 그래서 배포할 때마다 이 자리에서 말하게 했다.
 */
test('★★★ 배포가 OCR 이 켜져 있는지 말한다 (품질은 조용히 빠진다)', () => {
  const wf = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const at = wf.indexOf('- name: Check reading power (OCR)');
  assert.ok(at > -1, 'OCR 확인 단계가 없다 — 꺼져 있어도 아무도 모른다');
  const step = wf.slice(at, wf.indexOf('- name: Why is the key not read'));

  assert.ok(/ocrReady/.test(step), '엔진이 주는 값을 안 본다');
  assert.ok(step.indexOf('꺼짐') !== -1 && step.indexOf('켜짐') !== -1,
    '켜짐·꺼짐을 갈라 말하지 않는다');
  assert.ok(/::warning::/.test(step),
    '꺼져 있는데 경고를 안 낸다 — 요약 줄만으로는 안 읽힌다');
  /* ★ 못 잰 것을 **꺼진 것으로 세지 않는다** — 앞단이 /intake 를 안 넘겨줄 수 있다 */
  assert.ok(step.indexOf('못 쟀다') !== -1,
    '못 잰 것과 꺼진 것을 안 가른다 — 엔진 탓으로 읽힌다');
  /* ★★ **앞단이 아니라 엔진에 직접 물어야 한다** 〈2026-08-23 · 첫 판이 헛돌았다〉.
   *   tailnet 포트 80 은 /api/linkpilot/* 를 404 로 돌려준다(D-87). 앞단으로
   *   물으면 늘 「못 쟀다」가 나와 이 확인이 있으나 마나가 된다 */
  assert.ok(/127\.0\.0\.1:8181/.test(step),
    '앞단으로 묻고 있다 — 늘 「못 쟀다」가 나온다');
  /* ★★ **세 갈래를 전부 로그에 찍는다** 〈2026-08-23 · 실제로 답답했다〉.
   *   「꺼짐」만 경고로 나가면, 경고가 없을 때 「켜졌다」인지 「못 쟀다」인지
   *   구분이 안 된다 — 재는 장치인데 결과를 못 읽는다 */
  const notices = (step.match(/::(notice|warning)::/g) || []).length;
  assert.ok(notices >= 3,
    `세 갈래 중 ${notices}개만 로그에 남는다 — 나머지는 요약에만 있어 안 보인다`);
  /* ★ 키 값은 절대 찍지 않는다 (CLAUDE.md §2) */
  assert.ok(!/\$\{\{ secrets\.GEMINI/.test(step),
    '키 값이 워크플로에 들어왔다 — 로그에 남을 수 있다');
});

/**
 * ★★★ **「꺼짐」은 원인을 하나도 안 말한다** 〈2026-08-23 · 실제로 막혔다〉.
 *
 *   사장님이 `linkpilot.env` 를 엔진 루트에 제대로 놓으셨는데도 배포 #75 는
 *   **「OCR: 꺼짐」**이었다. 그런데 그 한 마디로는 **다음에 무엇을 봐야 할지
 *   알 수가 없다** — 파일이 폴더인 것, 서식 문서(RTF)로 저장된 것, 값에
 *   따옴표가 섞인 것, BOM 이 붙은 것이 전부 같은 「꺼짐」이다.
 *
 * ★ 오늘 이 결로만 세 번 헤맸다. **재는 장치는 만들었는데 「그래서 왜」를
 *   안 말했다.** 그래서 배포가 엔진 자신에게 같은 파서로 묻게 했다.
 */
test('★★★ 꺼져 있으면 **왜 꺼졌는지**까지 배포가 말한다', () => {
  const wf = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const at = wf.indexOf('- name: Why is the key not read');
  assert.ok(at > -1, '원인 진단 단계가 없다 — 「꺼짐」만 보고 사람이 다시 손으로 뒤진다');
  const step = wf.slice(at, wf.indexOf('- name: Probe summary'));

  assert.ok(step.indexOf('env-doctor.js') !== -1,
    '엔진의 파서로 안 묻는다 — 워크플로가 따로 판 것은 본문과 갈린다');
  /* ★★★ **「켜짐」이 「살아 있다」는 뜻이 아니었다** 〈2026-08-23 · 마지막 구멍〉.
     지금까지 켜짐은 **글자가 들어 있다**는 뜻일 뿐이었다. 폐기된 열쇠도
     똑같이 켜짐으로 나오고, 그러면 자료를 올리는 그 순간에야 실패한다 */
  assert.ok(/env-doctor\.js --live/.test(step),
    '열쇠가 실제로 받아들여지는지 안 물어본다 — 죽은 열쇠도 「켜짐」으로 나온다');
  /* ★ node 가 PATH 에 없을 수 있다. 그때 「진단이 못 돈 것」과 「꺼진 것」을 가른다 */
  assert.ok(step.indexOf('NONODE') !== -1,
    'node 를 못 찾은 것을 안 가른다 — 진단 실패가 꺼짐으로 읽힌다');
  /* ★ 진단이 배포를 죽이면 안 된다 */
  assert.ok(/set \+e/.test(step), '진단이 실패하면 배포가 죽는다');
  /* ★★ 키 값은 한 글자도 워크플로에 안 들어온다 (CLAUDE.md §2) */
  assert.ok(!/secrets\.GEMINI/.test(step), '키가 워크플로에 들어왔다');
});

test('★★★ 진단이 **값을 안 찍는다** — 로그는 남는다 (§2)', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'im-agent', 'tools', 'env-doctor.js'), 'utf8');
  /* ★ 주석은 떼고 본다 (CLAUDE.md §8) */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  /* ★ 찍는 줄(`say(...)`)에 열쇠 변수가 통째로 실리면 안 된다.
   *   길이·앞 네 글자를 재는 것은 값이 아니므로 먼저 지우고 본다 */
  const printed = (code.match(/say\([^\n]*\)/g) || [])
    .map((l) => l.replace(/key\.length|key\.slice\(0, 4\)/g, 'X'));
  const leaks = printed.filter((l) => /\bkey\b/.test(l));
  assert.deepStrictEqual(leaks, [], `열쇠 값을 그대로 찍는 줄이 있다: ${leaks.join(' / ')}`);
  assert.ok(code.indexOf('KEY_SHAPES') !== -1,
    '앞머리를 보는 검사가 없다 — 자리표시자·따옴표를 못 가른다');
  /* ★★ 아는 모양이 아니라고 **틀렸다고 단정하지 않는다** 〈2026-08-23 · §4.9〉.
     구글은 `AIza…` 말고 `AQ.…` 열쇠도 준다. 하나만 알고 있으면 멀쩡한 열쇠를
     틀렸다고 말하고, 사장님은 맞는 것을 다시 만드느라 시간을 쓴다 */
  assert.ok(/KEY_SHAPES = \['AIza', 'AQ\.'\]/.test(code),
    '아는 열쇠 모양이 하나뿐이다 — 새 모양 열쇠를 틀렸다고 말한다');
  assert.ok(code.indexOf('틀렸다는 뜻은 아니다') !== -1,
    '모르는 모양을 「틀렸다」로 적는다 (§4.9)');
  assert.ok(code.indexOf('IM_AGENT_OFFLINE') !== -1,
    '강제 오프라인을 안 본다 — 열쇠가 멀쩡해도 꺼져 있을 수 있다');

  /* ★★★ 살아 있는지 묻는 쪽도 **값을 안 찍고**, 못 물어본 것을 죽은 것으로
     세지 않는다 (§4.9) */
  assert.ok(code.indexOf('x-goog-api-key') !== -1, '열쇠가 살아 있는지 안 물어본다');
  assert.ok(code.indexOf('못 물어봤다') !== -1,
    '못 물어본 것과 거절당한 것을 안 가른다 — 그물이 막힌 것을 열쇠 탓으로 읽는다');
  assert.ok(code.indexOf('API_KEY_INVALID') !== -1,
    '거절 이유를 안 가른다 — 「열쇠가 죽었다」와 「API 를 안 켰다」가 같아 보인다');
  assert.ok(/setTimeout\(\(\) => ctl\.abort\(\), 10000\)/.test(code),
    '시간 제한이 없다 — 진단이 배포를 붙잡는다');
});

/**
 * ★★★ **열쇠를 배포가 놓는다** 〈2026-08-23 · 사람 손으로 세 번 실패했다〉.
 *
 *   ① `.env` 라는 **폴더**가 만들어졌다 (File Station 의 [생성] 에는 폴더뿐)
 *   ② 이름이 `linkpilot.env.env` 가 됐다 (맥이 확장자를 또 붙인다)
 *   ③ **서식 문서(RTF)로 저장됐고**, 고치신 뒤에도 NAS 의 파일은 지문까지
 *      그대로였다 — 새 파일이 아예 안 올라갔다
 *
 * ★ 실패한 자리가 매번 달랐다. **길 자체에 함정이 넷**이라서다. 안내를 더 잘
 *   쓰는 것으로 될 일이 아니고, **그 길을 안 쓰게 하는 것이 고치는 것**이다.
 */
test('★★★ Secret 이 있으면 배포가 열쇠 파일을 대신 놓는다', () => {
  const wf = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const at = wf.indexOf('- name: Write engine key (GEMINI_API_KEY)');
  assert.ok(at > -1, '열쇠를 놓는 단계가 없다 — 사람이 File Station 과 싸우게 된다');
  const step = wf.slice(at, wf.indexOf('- name: Deploy engine'));

  /* ★★ **엔진보다 앞이어야 한다.** 엔진은 뜰 때 열쇠를 읽으므로, 뒤에 두면
   *   이번 판이 아니라 다음 배포부터 켜진다 */
  assert.ok(at < wf.indexOf('- name: Deploy engine (D-87'),
    '열쇠를 엔진 재시작 뒤에 놓는다 — 이번 판에는 안 켜진다');

  /* ★★★ **값이 로그로도 프로세스 목록으로도 안 샌다** (CLAUDE.md §2) */
  assert.deepStrictEqual(step.match(/echo[^\n]*\$GEMINI_API_KEY/g) || [], [],
    '열쇠 값을 로그에 찍는다');
  assert.deepStrictEqual(step.match(/ssh[^\n|]*\$GEMINI_API_KEY/g) || [], [],
    '열쇠를 명령줄 인자로 넘긴다 — NAS 의 프로세스 목록에 잠깐 뜬다');
  assert.ok(/printf[^\n]*\|\s*ssh/.test(step),
    '값이 stdin 으로 흐르지 않는다');

  /* ★★ Secret 이 없으면 **아무것도 안 건드린다** — 빈 값으로 덮으면 손으로
   *   놓아 둔 파일이 사라진다 (§4.9) */
  assert.ok(/if \[ -z "\$\{GEMINI_API_KEY:-\}" \]/.test(step),
    'Secret 이 비었는지 안 본다 — 빈 값으로 덮는다');
  assert.ok(step.indexOf('안 건드렸다') !== -1, '안 건드렸다는 것을 말하지 않는다');

  /* ★ 되돌릴 자리를 먼저 만든다 */
  assert.ok(step.indexOf('linkpilot.env.bak-') !== -1,
    '덮기 전에 되돌릴 자리를 안 만든다');
  /* ★ 남이 읽으면 안 되는 파일이다 */
  assert.ok(step.indexOf('umask 177') !== -1, '파일 권한을 안 좁힌다');
  /* ★ 못 놓았으면 **빨갛게 끝난다** — 조용히 넘어가면 진단이 옛 파일을 말한다 */
  assert.ok(step.indexOf('::error::') !== -1, '못 놓아도 초록으로 끝난다');
});

test('★★ OCR 켜는 법이 문서로 있다 (사장님이 손으로 하실 일이다)', () => {
  const doc = fs.readFileSync(
    path.join(ROOT, 'docs', '자료를-더-읽게-하는-법-OCR-켜기.md'), 'utf8');
  /* ★ 낯선 말은 풀어 준다 · 어디를 눌러야 하는지 적는다 (CLAUDE.md §5) */
  assert.ok(doc.indexOf('File Station') !== -1, '마우스로 되는 길을 안 준다');
  /* ★★★ **손으로 파일을 만드는 길은 폐기했다** 〈2026-08-23 · 세 번 실패〉.
     이제 Secret 칸에 붙여 넣으면 배포가 파일을 대신 놓는다. 문서가 그 길을
     **어디를 눌러야 하는지까지** 적어야 한다 (§5) */
  assert.ok(doc.indexOf('Secrets and variables') !== -1,
    'Secret 을 어디서 넣는지 메뉴 이름으로 안 적었다');
  assert.ok(doc.indexOf('New repository secret') !== -1, '누를 단추 이름이 없다');
  assert.ok(/Name.*칸에 정확히: `GEMINI_API_KEY`/.test(doc),
    '이름을 정확히 무엇으로 적어야 하는지가 없다 — 한 글자만 달라도 안 읽힌다');
  /* ★★ **여기서 실제로 한 번 헛돌았다** — dry_run 기본값이 true 라 그냥 누르면
     아무것도 안 올라간다. 미리 짚지 않으면 「했는데 안 된다」가 된다 */
  assert.ok(/`dry_run` 을 `false` 로/.test(doc),
    'dry_run 기본값이 true 인 것을 안 짚는다 — 눌러도 아무것도 안 올라간다');
  assert.ok(doc.indexOf('따옴표로 감싸지 않습니다') !== -1,
    '따옴표를 감싸면 인증만 실패하고 이유가 안 보인다');
  /* ★ 왜 길을 바꿨는지를 남긴다 — 안 적으면 반년 뒤에 손으로 놓는 길로 되돌린다 */
  assert.ok(doc.indexOf('세 번 다 실패했습니다') !== -1,
    '앞 길이 왜 폐기됐는지가 없다');
  /* ★ 붙여 넣을 명령에 「바꿔 넣을 자리」를 두지 않는다 — 터미널 명령이 없어야 한다 */
  assert.ok(!/^\s*ssh /m.test(doc), '터미널 명령이 들어 있다 — 마우스 길만 준다');
});
