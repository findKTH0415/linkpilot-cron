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

/** `default: '...'` 를 뽑는다 — yaml 파서를 들이지 않는다 (§5 의존성 최소) */
function defaultOf(yml, inputName) {
  const at = yml.indexOf('\n      ' + inputName + ':\n');
  if (at < 0) return null;
  const m = /^\s+default: '([^']*)'/m.exec(yml.slice(at, at + 1200));
  return m ? m[1] : null;
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

test('★★ probe 는 올리지 않는다 — 확인이 곧 덮어쓰기가 되면 안 된다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');

  // ① 입력이 있다
  assert.ok(/^      probe:$/m.test(y), 'probe 입력이 없다');

  // ② ★★ 올리는 단계는 probe 일 때 **돌지 않는다**
  const up = stepOf(y, 'Upload');
  assert.ok(up, 'Upload 단계가 없다');
  assert.match(up, /if:.*!inputs\.dry_run.*&&.*!inputs\.probe/,
    'Upload 가 probe 를 안 본다 — 「확인만」이 실제 배포가 된다');

  // ③ ★ 파일을 실제로 옮기는 것은 Upload 안에만 있다. probe 쪽에 scp 가
  //   섞여 들어오면 「읽기만 한다」가 거짓말이 된다
  const ssh = stepOf(y, 'Set up ssh');
  const probe = stepOf(y, 'Probe summary');
  assert.ok(ssh && probe, '두 단계가 다 있어야 한다');
  [['Set up ssh', ssh], ['Probe summary', probe]].forEach(([n, b]) => {
    assert.ok(!/\bscp\b/.test(b), `${n} 에 scp 가 있다 — 확인만 한다더니 옮긴다`);
    assert.ok(!/cp '/.test(b), `${n} 이 NAS 에서 파일을 만든다`);
  });

  // ④ ★ 그래도 **닿는지는 실제로 재야 한다.** 안 재면 probe 가 초록인데
  //   실제 배포에서 죽는다 — 확인해 준 것이 아무것도 없는 셈이다
  assert.match(ssh, /echo ok/, 'ssh 로 실제로 닿아 보지 않는다 — 재지 않은 초록이다');

  // ⑤ probe 도 tailnet 을 지난다 (dry_run 이 아닐 때만 붙으므로)
  assert.match(stepOf(y, 'Verify tailnet'), /if:.*!inputs\.dry_run/,
    'Verify tailnet 조건이 바뀌었다 — probe 가 tailnet 을 안 지나면 재는 뜻이 없다');
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

  // ① 올리는 단계보다 **앞**이어야 한다. 뒤면 재는 뜻이 없다
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
 * ★★ 〈2026-08-21 · 실제 배포 두 번째 시도에서 죽었다〉
 *
 *   `/volume1/web` 은 **있었다.** 권한도 `drwxrwxrwx+` 로 활짝 열려 있었다.
 *   그런데 scp 는 「그런 폴더 없다」고 했다. **둘 다 참이었다.**
 *
 *     ssh ... ls -ld /volume1/web  →  drwxrwxrwx+  (보인다)
 *     scp ...                      →  No such file or directory
 *
 *   OpenSSH 9 부터 scp 는 속으로 **SFTP** 를 쓴다. Synology 에는 「SFTP 사용자를
 *   홈 폴더 안에만 가둔다」는 설정이 있고, 그러면 **SFTP 쪽 시야에서는 그
 *   경로가 없다.** 보는 창구가 다른 것이다.
 *
 * ★ 이 종류가 특히 나쁜 이유: 오류가 「경로가 틀렸다」로 읽힌다. 그래서
 *   **멀쩡한 경로를 몇 번이고 다시 확인하게 된다.** 실제로 그랬다.
 *
 * ★★ 그리고 `Check destination` 은 ssh 로 잰다. `-O` 가 빠지면 **재는 눈과
 *   하는 눈이 달라져서** 확인은 통과하고 다음 단계에서 죽는다 — 확인이
 *   확인 노릇을 못 한다.
 */
test('★★ scp 가 ssh 와 같은 눈으로 본다 (-O) — 잰 것과 하는 것이 어긋나지 않게', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const up = stepOf(y, 'Upload');
  assert.ok(up, 'Upload 단계가 없다');

  const scps = up.split('\n').filter(l => /^\s*scp\s/.test(l));
  assert.ok(scps.length > 0, 'Upload 에 scp 가 없다');
  scps.forEach((l) => {
    assert.match(l, /\bscp\s+-O\b/,
      'scp 에 -O 가 없다 — SFTP 로 가면 ssh 가 보는 것과 다른 것을 본다:\n    ' + l.trim());
  });
});

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
