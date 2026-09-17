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

/**
 * ★★★ **검사를 돌리는 워크플로는 글꼴 이름도 진짜로 만든다** (2026-09-06 신설 · D-52 세 번째).
 *
 * [사고] `pdf-fonts.test.js` 가 러너에서 「PDF 에 CJKjp 이 박혔다」로 빨개졌다.
 *   글꼴 스택의 **첫 이름**(`Noto Sans KR`)이 apt 꾸러미에 없어 둘째 이름으로 넘어가고,
 *   거기서 러너의 fontconfig 가 **일본어 얼굴**을 골랐다.
 *
 * ★★ **한쪽만 고쳤다.** 고침을 `im-agent-ci.yml` 에 넣고 `deploy-nas.yml` 은 그대로 뒀다.
 *   두 워크플로가 **같은 검사를 돌리는데** 한쪽만 고쳐 배포 게이트는 계속 빨갰고,
 *   그 사실은 배포를 걸어 보고서야 드러났다. 「같은 결함은 한 번에 옮긴다」(§8-1).
 *
 * ★ 그래서 사람의 기억이 아니라 여기서 센다 — **검사를 돌리는 워크플로**(`node --test`)는
 *   반드시 **꾸러미 설치와 이름 확인 둘 다** 있어야 한다. 하나라도 빠지면 빨개진다.
 *   ★★ 꾸러미만 있고 이름 확인이 없는 것이 **바로 이번에 당한 모양**이다 —
 *     그 자리가 초록으로 보이는 것이 이 고장의 급소다.
 */
test('검사를 돌리는 워크플로는 한국어 글꼴을 깔고 **그 이름으로 쓰이는지까지** 확인한다 (D-52)', () => {
  const files = fs.readdirSync(WF).filter(f => /\.ya?ml$/i.test(f));
  const runsTests = [];
  for (const f of files) {
    const body = fs.readFileSync(path.join(WF, f), 'utf8');
    // ★ 검사를 부르는 말이 하나가 아니다 — 한쪽은 `node --test`, 한쪽은 `npm test`.
    //   한 가지만 찾으면 나머지를 놓치고, 그러면 이 검사가 **아무것도 안 재게 된다**
    //   (실제로 처음엔 하나만 찾아 빨개졌다 — 그 빨간 줄이 이 줄을 넓히게 했다).
    if (/node\s+--test|npm\s+(run\s+\w+|test)/.test(body)) runsTests.push([f, body]);
  }
  assert.ok(runsTests.length >= 2,
    `검사를 돌리는 워크플로를 ${runsTests.length}개만 찾았다 — 이 검사가 아무것도 안 재고 있다`);

  const missing = [];
  for (const [f, body] of runsTests) {
    const hasPkg = /fonts-noto-cjk/.test(body);
    // 「깔렸는가」가 아니라 「그 이름으로 쓰이는가」를 재는 자리 — ensureFonts + fc-match
    // ★★ **부르는 자리**를 본다 — 이름만 훑으면 `ensureFontsXX` 같은 것도 통과한다.
    //   실제로 사보타주에서 그렇게 새어 나갔다: 이름을 망가뜨렸는데 검사가 초록이었다.
    //   글자가 들어 있는지가 아니라 **부르는지**를 재야 한다 (이 저장소의 상습 함정).
    const hasName = /ensureFonts\s*\(/.test(body) && /fc-match\b/.test(body);
    if (!hasPkg) missing.push(`${f}: 꾸러미(fonts-noto-cjk) 설치가 없다`);
    if (!hasName) missing.push(`${f}: 이름 확인(ensureFonts · fc-match)이 없다`);
  }
  assert.deepStrictEqual(missing, [],
    '검사를 돌리는데 글꼴 준비가 빠진 워크플로가 있다 — 러너에서만 PDF 가 일본어 글꼴로 나온다:\n  ' +
    missing.join('\n  '));
});

/* ────────────────────────────────────────────────────────────────────
 * `uses:` 가 가리키는 «로컬 워크플로»가 실제로 있는가 — 2026-09-17 실측
 *
 * 무엇이 났나: 사장님 화면에서 `.github/workflows/deploy-im.yml` 이 **1초**에 ❌
 * 였고 결론이 `startup_failure` 였다. 원인은 그 파일의 `alert` 잡이
 * `uses: ./.github/workflows/alert-failure.yml` 을 부르는데 **그 파일이 없는 것**.
 * D-99(`e551ca4`)가 문자 알림과 함께 그 워크플로를 지웠는데 **부르는 자리만 남았다.**
 *
 * ★ **YAML 문법으로는 안 잡힌다** — 실측에서 그 파일은 `yaml.safe_load` 로 멀쩡히
 *   파싱됐다. GitHub 의 워크플로 «스키마»는 따로다 (§12-20).
 * ★★ **한 달 넘게 아무도 몰랐다** — 그 워크플로는 `workflow_dispatch` 전용이라
 *   사장님이 누르실 때까지 **한 번도 안 돌았다**(실행 번호 1). 곧 「도는 것이 없으면
 *   깨진 줄도 모른다」 — 그래서 **누르기 전에** 검사가 잡아야 한다.
 * ★★★ 잡도 단계도 로그도 안 만들어지므로 **열어 볼 로그가 없다**(404).
 * ──────────────────────────────────────────────────────────────────── */

test('★★★ `uses:` 로 부르는 로컬 워크플로가 실제로 있다 (없으면 startup_failure)', () => {
  const files = fs.readdirSync(WF).filter((f) => /\.ya?ml$/i.test(f));
  assert.ok(files.length >= 3, '워크플로를 못 읽었습니다 — 이 칸은 아무것도 안 잽니다');
  const missing = [];
  let seen = 0;
  for (const f of files) {
    const body = fs.readFileSync(path.join(WF, f), 'utf8')
      /* ★ 주석 줄을 떼고 본다 — 이 저장소는 경위 주석이 길어 그 안의 인용이
         코드로 읽힌다 (§8 「경위를 잘 적어 둘수록 검사가 눈이 먼다」).
         실제로 이 고침의 주석에 그 경로를 적었고, 안 떼면 그 줄이 걸린다. */
      .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    /* 로컬 재사용 워크플로만 본다 — `owner/repo/...@ref` 는 바깥이라 여기서 못 잰다. */
    for (const m of body.matchAll(/^\s*uses:\s*(\.\/[^\s'"]+)/gm)) {
      seen++;
      const rel = m[1].replace(/^\.\//, '');
      if (!fs.existsSync(path.join(ROOT, rel))) missing.push(`${f} → ${rel}`);
    }
  }
  assert.deepStrictEqual(missing, [],
    'GitHub 이 못 찾는 워크플로를 부릅니다 — 그 워크플로는 «1초에» startup_failure 로 죽고\n'
    + '  잡도 단계도 로그도 안 만들어집니다(열면 404). 부르는 자리를 지우거나 그 파일을 만드십시오:\n  '
    + missing.join('\n  '));
  /* ★ 「찾은 것이 0개」와 「전부 멀쩡」은 다른 사실이다 — 0 이면 이 칸은 눈이 먼 것이다.
     다만 로컬 재사용 워크플로를 하나도 안 쓰는 것도 정상이므로 실패로는 안 센다. */
  if (seen === 0) console.log('    (로컬 `uses:` 가 0곳 — 지금은 잴 것이 없다)');
});

test('★★ 잡마다 돌 자리가 있다 — `runs-on` 이나 `uses` 중 하나는 있어야 한다', () => {
  /* [왜] 위와 같은 갈래다. 잡에 `runs-on` 도 `uses` 도 없으면 GitHub 이 그 워크플로를
     통째로 거부한다(`startup_failure`). YAML 은 멀쩡히 파싱되므로 그것으로는 안 잡힌다.
     ★ 라이브러리를 안 들인다 (§5) — 잡 머리와 그 아래 들여쓴 줄만 본다. */
  const files = fs.readdirSync(WF).filter((f) => /\.ya?ml$/i.test(f));
  const bad = [];
  let jobs = 0;
  for (const f of files) {
    const lines = fs.readFileSync(path.join(WF, f), 'utf8').split('\n')
      .filter((l) => !/^\s*#/.test(l));
    const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
    if (at < 0) continue;
    for (let i = at + 1; i < lines.length; i++) {
      if (!/^ {2}[A-Za-z_][\w-]*:\s*$/.test(lines[i])) continue;   /* 잡 머리 */
      const name = lines[i].trim().replace(/:$/, '');
      jobs++;
      let body = '';
      for (let j = i + 1; j < lines.length && !/^ {2}\S/.test(lines[j]); j++) body += lines[j] + '\n';
      if (!/^\s{4}(runs-on|uses):/m.test(body)) bad.push(`${f} → ${name}`);
    }
  }
  assert.ok(jobs >= 3, `잡을 ${jobs}개밖에 못 읽었습니다 — 이 칸은 거의 아무것도 안 잽니다`);
  assert.deepStrictEqual(bad, [],
    '`runs-on` 도 `uses` 도 없는 잡이 있습니다 — 그 워크플로는 시작 전에 거부됩니다:\n  '
    + bad.join('\n  '));
});
