/**
 * **없는 목적지 폴더를 «한 칸만» 만들어 준다** 〈2026-09-08〉
 *
 * ★ 무엇이 있었나. 새 문서 한 장을 `/volume1/web/<새폴더>/` 로 내려는데
 *   `Check destination` 이 「목적지 폴더가 없다」로 **빨갛게 끝냈다.** 그런데 바로
 *   다음 단계인 `Upload` 는 첫 줄에서 `mkdir -p` 를 한다 — **만들 수 있는 폴더를
 *   앞 단계가 막고 있었다.** 그래서 사람이 DSM 을 열어 폴더부터 만들어야 했고,
 *   그 한 걸음 때문에 「반영이 안 된다」가 며칠씩 갔다.
 *
 * ★★ 검사를 지우지 않았다 (§8 — 검사를 약하게 고치지 않는다). 이 검사가 잡으려던
 *   것은 **오타 난 경로**인데, 오타는 부모까지 틀리고 새 폴더는 부모가 맞다.
 *   그래서 **부모를 묻는 것**으로 성질을 지켰다 — 재려던 것이 그대로 남는다.
 *
 * ★★★ 여기서는 NAS 에 못 붙는다. 그러니 **워크플로 글자**를 잰다. 대신
 *   CLAUDE.md §8 대로 **주석을 떼고 본다** — 이 저장소는 주석이 길어서 경위에
 *   적어 둔 낱말을 코드로 읽고 헛통과하는 자리가 실제로 네 번 났다.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WF = path.join(__dirname, '..', '..', '.github', 'workflows', 'deploy-nas.yml');

/** `#` 로 시작하는 줄을 뺀 알맹이 — 경위 주석이 코드로 읽히지 않게 한다 */
function code() {
  return fs.readFileSync(WF, 'utf8')
    .split('\n')
    .filter(l => !/^\s*#/.test(l))
    .join('\n');
}

test('목적지가 없으면 **부모를 묻는다** — 곧바로 빨갛게 끝내지 않는다', () => {
  const c = code();
  assert.match(c, /PARENT=\$\(dirname "\$DEST"\)/, '부모 경로를 안 구한다');
  assert.match(c, /test -d '\$PARENT'/, '부모가 있는지 안 묻는다');
  assert.match(c, /test -w '\$PARENT'/, '부모에 쓸 수 있는지 안 묻는다');
});

test('부모가 쓸 수 있으면 **지나가고, 올릴 때 생긴다고 적는다**', () => {
  const c = code();
  const dest = c.slice(c.indexOf('Check destination'), c.indexOf('Check serving'));
  assert.match(dest, /올릴 때 새로 생긴다/, '지나간다는 사실을 안 적는다 — 원래 있던 자리와 구분이 안 된다');
  /* ★ 재는 자리는 **만들지 않는다** — 재려고 무언가를 만들면 그것이 곧 배포다.
     만드는 일은 `Upload` 의 `mkdir -p` 가 한다. 그 둘을 여기서 함께 잰다. */
  assert.ok(!/\b(scp|touch|mkdir)\b/.test(dest),
    'Check destination 이 NAS 에 무언가를 만든다 — 재기만 해야 한다');
  const up = c.slice(c.indexOf('- name: Upload'), c.indexOf('- name: Verify deployed'));
  assert.match(up, /mkdir -p '\$DEST'/, 'Upload 가 목적지를 안 만든다 — 그러면 새 폴더가 영영 안 생긴다');
});

test('부모까지 없거나 못 쓰면 **여전히 빨갛게 끝난다** (검사가 약해지지 않았다)', () => {
  const c = code();
  const dest = c.slice(c.indexOf('Check destination'), c.indexOf('Check serving'));
  assert.ok(dest.length > 200, 'Check destination 단계를 못 찾았다 — 못 쟀다');
  assert.match(dest, /PNOWRITE/, '부모에 못 쓰는 경우를 안 가른다');
  assert.ok((dest.match(/exit 1/g) || []).length >= 4,
    '빨갛게 끝나는 길이 줄었다 — 오타 난 경로가 그냥 지나간다');
});

test('원래 막던 둘은 그대로다 — 있는데 못 쓰는 경우와 알 수 없는 경우', () => {
  const c = code();
  const dest = c.slice(c.indexOf('Check destination'), c.indexOf('Check serving'));
  assert.match(dest, /NOWRITE\*\)/, '목적지에 못 쓰는 경우 판정이 사라졌다');
  assert.match(dest, /목적지를 확인하지 못했다/, '알 수 없는 응답 판정이 사라졌다');
});
