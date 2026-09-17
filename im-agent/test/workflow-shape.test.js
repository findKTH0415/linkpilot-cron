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

/**
 * ★★★ **NAS 에 올리는 워크플로가 둘이면 한쪽만 고쳐진다**
 * 〈2026-09-17 · `deploy-im.yml` 을 내리면서 · CLAUDE.md §12-20〉
 *
 * [왜] 이번 사고의 뿌리가 그것이다. D-99 가 `alert-failure.yml` 을 지울 때
 *   `deploy-nas.yml` 은 제 `alert` 잡을 **함께 지웠는데** `deploy-im.yml` 은
 *   **부르는 자리만 남았다.** 배포 길이 하나였으면 날 수 없는 고장이다
 *   (§6-3 ⑥ 「같은 것을 두 자리에 두지 않는다」).
 *
 * ★ 표지는 `NAS_SSH_HOST` 다 — 접속정보가 있어야 NAS 에 올릴 수 있다.
 * ★★ **0개도 빨갛게 끝낸다.** 배포 길이 통째로 없어진 것이거나 표지 이름이
 *   바뀐 것인데, 둘 다 「이 칸이 눈이 먼 것」이다 (§8 — 못 잰 것은 통과가 아니다).
 */
test('★★★ NAS 에 올리는 워크플로가 **정확히 하나**다 (둘이면 한쪽만 고쳐진다)', () => {
  const found = fs.readdirSync(WF)
    .filter((f) => /\.ya?ml$/i.test(f))
    .filter((f) => fs.readFileSync(path.join(WF, f), 'utf8').includes('NAS_SSH_HOST'));
  assert.strictEqual(found.length, 1,
    `NAS 배포 워크플로가 ${found.length}개입니다 (하나여야 합니다): ${found.join(' · ') || '(없음)'}\n`
    + '  둘이면 한쪽만 고쳐지고, 0개면 이 칸이 눈이 먼 것입니다.');
});

/**
 * ★★ **`deploy-im.yml` 의 마지막 유산 — 「아무도 안 부르는 것」 훑기**
 * 〈2026-09-17〉
 *
 * [왜] 저쪽 16단계 중 이쪽에 없던 것은 `npm run check:reachable` **하나**였다.
 *   `npm test` 는 `reachable.js` 의 **함수 성질**만 잰다(`nas-guard.test.js`) —
 *   저장소 전체를 훑는 것은 그 CLI 뿐이라, 안 옮겼으면 **조용히 없어졌다.**
 *   옮겨 놓고 재지 않으면 다음 사람이 그 줄을 지워도 아무도 모른다.
 */
test('★★ 배포 길이 `check:reachable` 을 지나간다 (M-08 계열 — 옮겨 온 단계)', () => {
  const found = fs.readdirSync(WF)
    .filter((f) => /\.ya?ml$/i.test(f))
    .filter((f) => fs.readFileSync(path.join(WF, f), 'utf8').includes('NAS_SSH_HOST'));
  assert.ok(found.length >= 1, '배포 워크플로를 못 찾았습니다 — 이 칸은 아무것도 안 잽니다');
  const hit = found.filter((f) => {
    /* ★ 주석 줄을 떼고 본다 — 이 고침의 경위 주석에 그 명령을 그대로 적었고,
       안 떼면 **고침이 옳은데 초록으로 통과한다** (§8 「경위를 잘 적어 둘수록
       검사가 눈이 먼다」 — 여기서는 거꾸로, 지워도 주석 때문에 안 빨개진다). */
    const body = fs.readFileSync(path.join(WF, f), 'utf8')
      .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    return /check:reachable/.test(body);
  });
  assert.ok(hit.length >= 1,
    '배포 워크플로에 `npm run check:reachable` 이 없습니다 — '
    + '`deploy-im.yml` 에서 옮겨 온 단계가 사라졌습니다 (M-08 계열이 다시 안 잡힙니다).');
});

/**
 * ★★★ **「썼다」와 「남았다」는 다른 사실이다 — 배포 열쇠 자리** 〈2026-09-17 · D-212〉
 *
 * [무엇이 났나] 배포 #212 가 「써 넣은 열쇠 **25개**」라고 적고 **초록으로 끝났는데**,
 *   같은 초의 로그에 `Permission denied` 가 넉 줄 찍혀 있었고 40초 뒤 진단은
 *   「실제로 읽은 파일: **(없다)**」였다. 곧 **한 글자도 안 실렸다.**
 *   그 결과 지적도·OCR·둘째 읽기가 통째로 꺼진 채 배포가 성공으로 끝났고,
 *   **나는 그 초록을 근거로 사장님께 「열쇠는 들어 있습니다」라고 적었다.**
 *
 * [왜 안 잡혔나] `OUT=$(ssh …)` 의 종료코드는 **ssh 안 마지막 명령의 것**이다.
 *   `cat > linkpilot.env` 가 실패해도 뒤의 `echo` 가 성공하면 0 이 온다.
 *   §12-10 의 「실패를 돌려주는 함수는 부르는 쪽이 본다」와 **같은 고장**이고,
 *   그때는 PHP 였다 (S-53 — 한 칸에서 배운 것을 옆 칸에 안 대면 그대로 남는다).
 *
 * ★ **주석을 떼고 본다.** 위 경위에 옛 글자를 그대로 적었으므로, 안 떼면
 *   되돌려도 주석 때문에 초록이 된다 (§8 그 함정이 거꾸로 온 경우).
 */
const deployWf = () => {
  const found = fs.readdirSync(WF)
    .filter((f) => /\.ya?ml$/i.test(f))
    .filter((f) => fs.readFileSync(path.join(WF, f), 'utf8').includes('NAS_SSH_HOST'));
  assert.strictEqual(found.length, 1,
    `배포 워크플로가 ${found.length}개입니다 — 이 칸이 무엇을 재는지 알 수 없습니다`);
  return read(path.join(WF, found[0]))
    .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
};

test('★★★ 열쇠 파일을 「썼다」로 끝내지 않고 **되읽어 센다** (D-212)', () => {
  const body = deployWf();
  assert.ok(/BACKCOUNT=/.test(body),
    '열쇠 단계가 NAS 에서 **되읽는 자리**가 없습니다 — 「보냈다」만으로 판정하면 '
    + '`Permission denied` 가 나도 초록으로 끝납니다 (배포 #212 가 그랬습니다).');
  assert.ok(/WROTE=/.test(body),
    '쓰기 성패를 돌려받는 자리(`WROTE=`)가 없습니다.');
  /* ★★★ **「그 글자가 있는가」로는 아무것도 안 잰다** 〈사보타주가 빠져나가서 고쳤다〉.
     `BACKCOUNT=` 만 세면 **되읽어 놓고 안 쓰는** 코드가 그대로 통과한다.
     재려던 성질은 **「되읽은 수로 판정하는가」**이므로 **판정 조건 안**을 본다
     (§6-2-5 — 재는 자리를 옮긴 것이지 약하게 고친 것이 아니다). */
  const gate = body.match(/if \[ "\$WROTE"[^\n]*\n/);
  assert.ok(gate, '열쇠가 실렸는지 가르는 조건문을 못 찾았습니다 — 이 칸은 아무것도 안 잽니다.');
  assert.ok(/\$BACK\b|"\$BACK"/.test(gate[0]),
    '판정 조건이 **되읽은 수(`$BACK`)를 안 봅니다** — 「보냈다」만으로 초록이 됩니다.');
  const sed = body.match(/BACK=\$\(printf[^\n]*\n/);
  assert.ok(sed && /BACKCOUNT=/.test(sed[0]),
    '러너가 `BACKCOUNT=` 를 집어 오는 자리가 없습니다.');
  /* ★ 옛 판은 `cat > linkpilot.env` 로 **바로** 썼다 — 옛 파일을 다른 계정이 갖고
     있으면 그 자리에서 거부된다. 임시 이름에 쓰고 `mv` 로 갈아 끼우면
     **폴더에 쓸 수만 있으면** 된다 (같은 폴더에 engine.sh 가 성공한다). */
  assert.ok(!/umask 177 && cat > linkpilot\.env/.test(body),
    '열쇠 파일을 그 자리에 바로 씁니다 — 임시 이름에 쓰고 `mv` 로 갈아 끼워야 합니다.');
  assert.ok(/\.linkpilot\.env\.new-/.test(body) && /mv -f '\.linkpilot\.env\.new-/.test(body),
    '임시 파일 → `mv` 로 갈아 끼우는 자리가 없습니다.');
});

test('★★★ 열쇠가 0개면 배포가 **빨갛게 끝난다** (거짓 초록을 막는 판정 칸)', () => {
  const body = deployWf();
  assert.ok(/LP_OPS enginekeys=none/.test(body),
    '열쇠가 안 실린 것을 `LP_OPS enginekeys=none` 으로 남기는 자리가 없습니다.');
  const m = body.match(/- name: Deploy verdict[\s\S]*?(?=\n      - name: |\n  [a-z_-]+:\n|$)/);
  assert.ok(m, '마지막 판정 칸(`Deploy verdict`)이 없습니다 — 그러면 열쇠 0개가 초록으로 끝납니다.');
  const step = m[0];
  assert.ok(/enginekeys=/.test(step), '판정 칸이 `LP_OPS enginekeys=` 를 안 읽습니다.');
  /* ★★ **「못 쟀다」도 초록으로 안 끝낸다** (§8). 둘 다 exit 1 이어야 한다. */
  for (const w of ['none', 'unmeasured']) {
    const c = step.match(new RegExp(`\\b${w}\\)[\\s\\S]*?;;`));
    assert.ok(c, `판정 칸에 \`${w}\` 갈래가 없습니다.`);
    assert.ok(/exit 1/.test(c[0]),
      `판정 칸의 \`${w}\` 갈래가 빨갛게 끝나지 않습니다 — 그러면 이 칸을 둔 뜻이 없습니다.`);
  }
});

/**
 * ★★★ **「못 쟀다」안에 갈래 셋이 숨어 있었다** 〈2026-09-17 · 실측〉
 *
 * 백업·복원시험이 `EACCES: permission denied` 로 죽었는데 글은
 * 「ssh 가 안 붙었거나 node 가 없다」였다 — **ssh 도 node 도 멀쩡했고**
 * 막은 것은 **자료 파일 한 개의 권한**이다. 그리고 바로 아래 칸이
 * 「붙기: **된다**」를 찍고 있었다 (§8 — 이웃한 두 칸이 다른 말을 하면 사고 신호).
 *
 * ★ **낱말이 아니라 「시키는가」를 잰다** — 「EACCES 면 ssh 를 보라고 말하지 않는가」.
 */
test('★★ 백업·복원시험이 `EACCES` 를 ssh·node 와 **갈라 적는다** (틀린 곳을 가리키지 않는다)', () => {
  const body = deployWf();
  /* ★ 창을 **덩어리(그 `if` 블록)**로 잡는다 — 글자 모양을 박아 두면 코드가
     조금만 움직여도 **고침이 옳은데 빨개진다** (§12-6 에서 세 번 겪은 자리). */
  const blocks = [...body.matchAll(/if ! printf[\s\S]{0,1200}?exit 0\n\s*fi/g)]
    .map((m) => m[0])
    .filter((seg) => /LP_OPS (backup|drill)=unmeasured/.test(seg));
  assert.ok(blocks.length >= 2,
    `「못 쟀다」 갈래를 ${blocks.length}개밖에 못 찾았습니다 — 이 칸은 거의 아무것도 안 잽니다.`);
  for (const seg of blocks) {
    const b = { 1: (seg.match(/LP_OPS (backup|drill)=/) || [])[1] };
    assert.ok(/EACCES/.test(seg),
      `「${b[1]}」의 「못 쟀다」가 EACCES 를 갈라 보지 않습니다 — `
      + '파일 권한 문제를 「ssh 가 안 붙었다」로 적으면 고칠 것이 없는 자리를 보러 가십니다.');
    assert.ok(/ssh·node 문제가 아니다|ssh 문제가 아니다/.test(seg),
      `「${b[1]}」의 EACCES 갈래가 **아니라고 말하지** 않습니다 — `
      + '부정으로 적지 않으면 여전히 ssh 를 보러 가십니다 (§4.6 의 그 잣대).');
  }
});

/**
 * ★★★ **「한 벌 남았다」와 「다 남았다」는 다른 사실이다** 〈2026-09-17 · D-212〉
 *
 * 못 읽는 자료 파일이 있으면 그것만 빼고 뜬다. 지문은 양쪽이 같아 **`ok` 로 보이는데
 * 그 파일은 백업에 없다** — 갈라 적지 않으면 「되살릴 것이 있다」가 반쪽 진실이 된다.
 */
test('★★ 백업이 «일부만» 남은 것을 «다 남은 것»과 갈라 적는다 (D-212)', () => {
  const body = deployWf();
  assert.ok(/LP_OPS backup=partial/.test(body),
    '일부만 뜬 것을 `backup=partial` 로 갈라 적지 않습니다 — `ok` 로 보여 그 파일이 '
    + '백업에 없다는 사실이 사라집니다 (§8 의 거짓 초록).');
  const seg = body.match(/못 읽어 빠진 것[\s\S]{0,700}?backup=partial/);
  assert.ok(seg, '`partial` 을 가르는 잣대(「못 읽어 빠진 것」)가 없습니다.');
  assert.ok(/백업 장치 문제가 아니다|파일 권한 문제이지/.test(seg[0]),
    '무엇이 문제인지 **부정으로** 적지 않습니다 — 그러면 백업 장치를 고치러 가십니다 (§4.6).');
});

/*
 * ★★★ **경고 글이 «없는 길»로 보내지 않는다 — 그리고 폴더 수를 «기계도» 읽는다**
 * 〈2026-09-17 · 실측 · D-213 이음 · 사장님: 「권하는 개선안 대로 진행해」〉.
 *
 *   [무엇이 났나] 백업 경고가 「어느 파일인지는 **위 로그에 있다**」였다. 그 자리는
 *   이 단계 로그의 **가운데**라, 그 한 줄을 읽으려고 내가 로그를 **네 번** 되감았다
 *   (끝에서 320줄). 사장님이라면 못 찾으신다 — 찾다 지치면 「고장」으로 읽힌다.
 *   정작 그 값은 **실행 요약 줄**에 폴더까지 이미 실려 있었다 (§12-19 의 그 자리).
 *
 * ★ **재는 것은 낱말이 아니라 «어디를 가리키는가»다** — 「위 로그」로 보내지 않고
 *   요약을 가리키는지 본다 (§4.6 「낱말이 아니라 시키는가를 잰다」와 같은 잣대).
 * ★★ **기계가 읽는 표에도 폴더 수를 적는가** — 산문 줄은 정기 운영점검이 못 읽는다.
 *   ★ 다만 **폴더 이름은 그 표에 안 넣는다** (§2) — 개수만이다.
 * ★★★ **세는 법이 재려는 것을 다 덮는가**까지 본다. 가운뎃점을 세면 넷을 넘는 순간
 *   「A · B · C 그리고 5곳 더」가 **8곳인데 3 으로** 세진다 — 그래서 정본이 적는
 *   **총수(괄호)**를 읽어야 한다 (§6-2-6 의 46 → 105 와 같은 규칙).
 * ★ **주석을 떼고 본다** — 위 경위에 옛 글자(「위 로그에 있다」)를 그대로 적었으므로,
 *   안 떼면 되돌려도 주석 때문에 빨개진다 (§8 그 함정이 거꾸로 온 경우).
 */
test('★★★ 백업 경고가 **요약을 가리키고**, 폴더 수를 기계용 표에도 적는다 (D-213)', () => {
  const body = deployWf();
  const seg = body.match(/못 읽어 빠진 것[\s\S]{0,1200}?backup=partial[\s\S]{0,600}?\n {12}else/);
  assert.ok(seg, '`partial` 갈래를 못 떼어 냈습니다 — 이 칸은 아무것도 안 잽니다.');
  const one = seg[0];

  /* ① 「위 로그」로 보내지 않는다 — 요약을 가리킨다 */
  assert.ok(!/위 로그에 있다/.test(one),
    '경고가 여전히 「위 로그에 있다」로 보냅니다 — 그 줄은 로그 가운데라 못 찾으십니다 (§12-19).');
  assert.ok(/요약|Summary/.test(one),
    '어디를 보면 되는지(실행 요약)를 안 가리킵니다 — 막다른 길이 됩니다 (§6-3 ⑥).');

  /* ② 기계용 표에 폴더 «수»를 적는다 — 이름은 안 적는다 (§2) */
  assert.ok(/LP_OPS backupdirs=/.test(one),
    '폴더 수를 `LP_OPS` 표에 안 적습니다 — 산문 줄은 정기 운영점검이 못 읽습니다 (D-196).');
  const echo = one.match(/echo "LP_OPS backupdirs=[^"]*"/);
  assert.ok(echo, '`backupdirs` 를 찍는 자리를 못 찾았습니다.');
  assert.ok(/^echo "LP_OPS backupdirs=\$\{?DIRS\}?"$/.test(echo[0]),
    `개수 말고 다른 것이 그 표에 실립니다 — 폴더 이름이 공개 로그로 나갑니다 (§2): ${echo[0]}`);

  /* ③ 세는 법이 다 덮는가 — 정본이 적는 «총수(괄호)»를 읽어야 한다 */
  const pick = one.match(/DIRS=\$\([^\n]*\)/);
  assert.ok(pick, '폴더 수를 세는 자리가 없습니다.');
  assert.ok(/그 자리\(/.test(pick[0]),
    '가운뎃점을 세는 것처럼 보입니다 — 넷을 넘으면 「그리고 N곳 더」가 빠져 **8곳이 3 으로** '
    + `세집니다. 정본이 적는 총수(괄호)를 읽어야 합니다: ${pick[0]}`);

  /* ★ 그리고 그 식이 «실제로» 그 값을 뽑는지 돌려서 잰다 — 글자만 보면 못 잡는다 */
  const sedArg = pick[0].match(/sed -n '([^']+)'/);
  assert.ok(sedArg, `세는 식에서 sed 규칙을 못 읽었습니다: ${pick[0]}`);
  const { execFileSync } = require('node:child_process');
  const run = (line) => execFileSync('sed', ['-n', sedArg[1]], { input: line, encoding: 'utf8' }).trim();
  assert.equal(run('x · 그 자리(3곳): A/02 · B/02 · C/02'), '3', '셋을 3 으로 못 셉니다.');
  assert.equal(run('x · 그 자리(8곳): A/02 · B/02 · C/02 그리고 5곳 더'), '8',
    '잘린 목록에서 총수를 못 읽습니다 — 이것이 이 칸을 둔 까닭입니다.');
  assert.equal(run('  ● 떴다 — 5개 파일 · 1KB · 지문 q'), '',
    '「그 자리」가 없는 줄에서 무언가를 뽑습니다 — 0 을 찍으면 「빠진 폴더가 없다」로 읽힙니다 (§8).');

  /* ★★ 못 셌으면 그 줄을 아예 안 찍는다 — 0 은 `partial` 과 어긋난다 */
  assert.ok(/''\|0\|\*\[!0-9\]\*\)/.test(one),
    '못 셌을 때(빈 값·0·숫자 아님) 건너뛰는 갈래가 없습니다 — 0 으로 찍으면 거짓이 됩니다 (§8).');
});
