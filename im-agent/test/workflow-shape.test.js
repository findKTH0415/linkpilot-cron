/**
 * **워크플로 자리에 스크립트가 들어간 것을 잡는다.**
 *
 * ★★★ 2026-09-01. `main` 에 `.github/workflows/main.yml` 이 올라왔는데 **내용이
 *   자바스크립트**였다. 원래 `scripts/sacheon-law-fetch.mjs` 로 갈 파일이 워크플로
 *   자리에 들어간 것이다. GitHub 은 그것을 워크플로로 읽으려다 실패하고 **push 때마다
 *   빨간 실행 하나**를 남긴다 (실행 33537096998 — 걸린 시각과 끝난 시각이 같은 초다).
 *
 * ★ 이 실수는 **처음이 아니다.** 8-31 에 `dart-fetch.yml` 도 같은 자리에서 두 번
 *   빨갛게 끝났다. 같은 모양이 두 번 왔으면 사람의 눈이 아니라 장치로 막는다
 *   (CLAUDE.md §7 — 반복 패턴은 그 자리에서 규칙·장치로 만든다).
 *
 * ★★ **왜 안 잡히나** — 이 고장은 **아무 코드도 안 깨뜨린다.** 테스트도 배포도
 *   멀쩡히 초록이고, 빨간 것은 Actions 목록 안쪽 한 줄뿐이라 안 열어 보면 모른다.
 *   그리고 정작 하려던 수집은 **한 번도 안 돈다** — 스크립트가 있어야 할 자리에 없다.
 *
 * ★★★ 여기서는 YAML 을 통째로 해석하지 않는다. 라이브러리를 안 들이기도 하고(§5),
 *   잡으려는 것이 문법 오류가 아니라 **파일 종류가 바뀐 것**이라 그것으로 충분하다.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const WF = path.join(ROOT, '.github', 'workflows');
const SCRIPTS = path.join(ROOT, 'scripts');

const read = (p) => fs.readFileSync(p, 'utf8');
const list = (dir, re) =>
  (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => re.test(f));

/** 주석·빈 줄을 뺀 **첫 알맹이 줄** — 파일이 무엇으로 시작하는지는 이것으로 가른다 */
function firstMeaningful(text, commentPrefix) {
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    if (commentPrefix && l.startsWith(commentPrefix)) continue;
    return l;
  }
  return '';
}

/* JS 라는 것을 드러내는 줄머리. 워크플로 YAML 에는 이런 줄이 최상단에 올 수 없다 */
const JS_HEAD = /^(\/\/|\/\*|import\s|export\s|const\s|let\s|var\s|function\s|await\s|#!)/;

test('워크플로 파일이 실제로 워크플로다 (스크립트가 잘못 들어오면 push 마다 빨간 실행이 남는다)', () => {
  const files = list(WF, /\.ya?ml$/);
  assert.ok(files.length > 0, '.github/workflows 에 파일이 하나도 없습니다');

  const broken = [];
  for (const f of files) {
    const text = read(path.join(WF, f));
    const head = firstMeaningful(text, '#');

    if (JS_HEAD.test(head)) {
      broken.push(`${f} — 자바스크립트로 시작합니다 (\`${head.slice(0, 40)}\`). scripts/ 로 옮기십시오`);
      continue;
    }
    /* 워크플로라면 맨 앞칸에 `jobs:` 가 반드시 있다. 없으면 GitHub 이 못 읽는다 */
    if (!/^jobs:\s*$/m.test(text)) {
      broken.push(`${f} — 맨 앞칸 \`jobs:\` 가 없습니다. GitHub 이 워크플로로 못 읽습니다`);
      continue;
    }
    /* `on:` 은 YAML 이 참(true)으로 읽는 자리라 따옴표가 붙기도 한다 — 셋 다 본다 */
    if (!/^(on:|"on":|'on':)/m.test(text)) {
      broken.push(`${f} — 맨 앞칸 \`on:\` 이 없습니다. 언제 도는지가 없으면 안 걸립니다`);
    }
  }
  assert.deepStrictEqual(broken, [],
    '워크플로 자리에 워크플로가 아닌 것이 있습니다:\n  ' + broken.join('\n  '));
});

test('워크플로 폴더에 워크플로가 아닌 파일이 없다 (GitHub 이 안 읽어 조용히 아무 일도 안 난다)', () => {
  /* ★★★ 2026-09-01 오후. 앞 판이 놓친 자리다.
     `main.yml`(내용은 JS)을 잡아 냈더니 그 파일이 **`main.mjs` 로 이름만 바뀌어**
     같은 폴더에 남았다. GitHub 은 이 폴더에서 `.yml`·`.yaml` 만 읽으므로 **빨간 실행은
     사라진다** — 그래서 고쳐진 것처럼 보인다. 그런데 그 스크립트를 **부르는 워크플로가
     없어** 수집은 여전히 한 번도 안 돈다. 「빨간 것이 없다」와 「도는 것이 있다」는
     다른 사실이다 (M-31 과 같은 결).
     ★ 앞 판 검사는 `*.yml` 만 훑어서 이 상태를 **통과로** 봤다. 폴더 전체를 본다. */
  const files = (fs.existsSync(WF) ? fs.readdirSync(WF) : []);
  const stray = files.filter((f) => !/\.ya?ml$/.test(f) && !/^\./.test(f));
  assert.deepStrictEqual(stray, [],
    '워크플로 폴더에 GitHub 이 안 읽는 파일이 있습니다 — 있는데 안 도는 상태입니다. '
    + 'scripts/ 로 옮기고 부르는 워크플로를 만드십시오: ' + stray.join(', '));
});

test('스크립트 파일에 워크플로가 잘못 들어가지 않았다 (거꾸로 든 경우)', () => {
  const files = list(SCRIPTS, /\.(mjs|cjs|js)$/);
  const broken = [];
  for (const f of files) {
    const text = read(path.join(SCRIPTS, f));
    const head = firstMeaningful(text, '//');
    /* `name:` 으로 시작하고 `jobs:` 가 있으면 워크플로가 통째로 들어온 것이다 */
    if (/^name:\s/.test(head) && /^jobs:\s*$/m.test(text)) {
      broken.push(`${f} — 워크플로 내용이 들어 있습니다. .github/workflows/ 로 옮기십시오`);
    }
  }
  assert.deepStrictEqual(broken, [],
    '스크립트 자리에 워크플로가 있습니다:\n  ' + broken.join('\n  '));
});
