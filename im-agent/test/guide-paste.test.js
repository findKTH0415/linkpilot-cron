'use strict';
/**
 * guide-paste.test.js — **안내서의 명령을 그대로 붙여 넣으면 도는가**
 * 〈2026-08-21 · 실제로 네 번 넘어뜨린 뒤 만들었다〉.
 *
 * ★★ 무슨 일이 있었나. 안내서에 이렇게 적어 보냈다:
 *
 *     npm run im:embed -- --out <앱 폴더>/im-flow
 *     "acls": [ ... ],
 *     ssh <계정>@<NAS주소> 'echo ok'
 *
 *   `<…>` 와 `...` 는 **「여기에 당신의 값을 넣으세요」**라는 뜻이었는데,
 *   받은 사람은 **그대로 붙여 넣었다.** 셸이 죽고, 정책 파일이 깨지고,
 *   그것을 고치다 닫는 괄호까지 지워졌다. **네 번 넘어졌다.**
 *
 * ★★ **자리표시인 줄 몰랐던 것이 읽는 사람 잘못이 아니다.** 붙여 넣으라고
 *   준 칸에 붙여 넣을 수 없는 것을 적어 둔 쪽이 잘못이다.
 *
 * ★ 그래서 규칙은 하나다: **코드 블록 안에는 자리표시를 두지 않는다.**
 *   설명하는 글에서는 「`<…>` 는 자리표시입니다」처럼 얼마든지 말해도 된다 —
 *   **붙여 넣는 칸**에만 없으면 된다. 그래서 이 검사는 코드 블록만 본다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', '..', 'docs');

/** 사람이 그대로 붙여 넣는 문서들 — 늘어나면 여기에 더한다 */
const GUIDES = [
  '자동배포-켜는-법.md',
  '본체-종합인수인계-교차검증-2026-08-21.md',
  '작업인계-지시서-2026-08-21.md',
];

/** ```…``` 안쪽만 뽑는다. 설명하는 글은 보지 않는다 */
function codeBlocks(text) {
  const out = [];
  const re = /```([a-z]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    // 줄 번호를 함께 담는다 — 걸렸을 때 어디인지 바로 알 수 있게
    out.push({ lang: m[1], body: m[2], line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}

/**
 * ★ **붙여 넣는 칸**만 본다. 응답 예시(json)·구조 그림은 치는 것이 아니라
 *   보는 것이다 — 거기까지 잡으면 검사가 시끄러워지고, 시끄러운 검사는
 *   결국 아무도 안 본다.
 */
const PASTEABLE = new Set(['bash', 'sh', 'zsh', 'jsonc', 'js', '']);

test('★★ 안내서의 붙여넣는 칸에 자리표시가 없다 (네 번 넘어진 자리)', () => {
  const found = [];
  GUIDES.forEach((name) => {
    const full = path.join(DOCS, name);
    if (!fs.existsSync(full)) return;      // 문서가 없어졌으면 그냥 넘어간다
    codeBlocks(fs.readFileSync(full, 'utf8')).forEach((b) => {
      if (!PASTEABLE.has(b.lang)) return;
      // `<무엇>` 꼴 · 점 세 개 — 둘 다 실제로 그대로 붙여 넣어졌다
      const hits = b.body.match(/<[^>\n]{1,24}>|\.\.\./g) || [];
      hits.forEach((h) => found.push(`${name} ${b.line}행 부근: ${h}`));
    });
  });
  assert.deepStrictEqual(found, [],
    '붙여 넣는 칸에 자리표시가 있다 — 받는 사람은 그대로 붙여 넣는다:\n  '
    + found.join('\n  '));
});

/**
 * ★ 반대쪽. 자리표시를 없앤다고 **값을 문서에 박아 넣으면** 더 나쁘다 —
 *   이 저장소는 public 이다 (CLAUDE.md §2 · D-10).
 *   그래서 「한 번만 정해 두고 이름으로 부른다」가 정답이다.
 */
test('★★ 자리표시를 없애면서 실제 접속정보를 박아 넣지 않았다', () => {
  GUIDES.forEach((name) => {
    const full = path.join(DOCS, name);
    if (!fs.existsSync(full)) return;
    const text = fs.readFileSync(full, 'utf8');
    assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(text.replace(/100\.101\.102\.103/g, '')),
      `${name}: IP 주소로 보이는 것이 있다`);
    assert.ok(!/ts\.net|\.synology\.me/i.test(text), `${name}: NAS 주소가 적혔다`);
    assert.ok(!/(KEY|TOKEN|SECRET)\s*[=:]\s*['"]?[A-Za-z0-9_-]{12,}/.test(text),
      `${name}: 키 값처럼 보이는 것이 적혔다`);
  });
});

/**
 * ★★ 자리표시를 없앴으면 **대신 무엇을 하라는 말**이 있어야 한다.
 *   그냥 지우기만 하면 읽는 사람은 자기 값을 어디에 넣을지 모른다.
 */
test('★ 자기 값을 어디에 넣는지 안내서가 말한다', () => {
  const g = fs.readFileSync(path.join(DOCS, '자동배포-켜는-법.md'), 'utf8');
  // 「한 번만 정해 두고 이름으로 부른다」 꼴이 실제로 있는가
  assert.match(g, /여기에NAS계정이름/, '자기 값을 넣을 자리를 안 보여 준다');
  assert.match(g, /자기 값으로 바꾼다/, '무엇을 바꿔야 하는지 말하지 않는다');
  // 바꾼 값이 맞는지 **확인하는 줄**이 함께 있어야 한다
  assert.match(g, /echo "\$NAS_USER@\$NAS_HOST"/,
    '자기 값이 맞는지 확인하는 줄이 없다 — 틀리면 그 아래가 전부 헛돈다');
});

/* ═════════ ④ tailnet 열쇠는 **두 길 다** 살아 있어야 한다 ═════════ */

/**
 * ★★ **실측으로 알았다** 〈2026-08-21〉. 콘솔 `Settings › Keys` 에 **Auth keys 와
 *   API access tokens 둘뿐**이고 OAuth client 자리가 없었다. 워크플로가 OAuth 만
 *   받으면, **만들 수 있는 열쇠가 있는데도 배포를 못 한다.**
 *
 * ★ 그래서 둘 다 받는다. 안내서와 워크플로가 **같은 이름**을 말해야 한다 —
 *   여기서 갈리면 사용자는 넣었는데 안 읽히는 Secret 을 넣게 된다.
 */
test('★★ 워크플로가 OAuth 와 auth key 를 **둘 다** 받는다', () => {
  const WF = path.join(__dirname, '..', '..', '.github', 'workflows');
  ['deploy-nas.yml', 'deploy-im.yml'].forEach((name) => {
    const y = fs.readFileSync(path.join(WF, name), 'utf8');

    // ① 두 길이 다 있다
    assert.ok(y.includes('TS_OAUTH_CLIENT_ID'), `${name}: OAuth 길이 없다`);
    assert.ok(y.includes('TS_AUTHKEY'), `${name}: auth key 길이 없다`);

    // ② ★ `if:` 에서 secrets 를 보지 않는다 — 그 자리에서 읽히는지 확실치 않고,
    //   안 읽히면 **두 단계가 다 건너뛰어져 조용히 안 붙는다**
    const ifLines = (y.match(/^\s*if:.*$/gm) || []);
    ifLines.forEach((l) => {
      assert.ok(!/secrets\./.test(l),
        `${name}: if 에서 secrets 를 본다 — 조용히 건너뛸 수 있다\n    ${l.trim()}`);
    });

    // ③ ★★ **붙었는지 재는 단계**가 있다. 없으면 두 단계가 다 건너뛰어져도
    //   워크플로는 초록으로 계속 가고, 다음 단계에서 엉뚱한 오류로 죽는다
    assert.ok(/tailscale status/.test(y),
      `${name}: tailnet 에 실제로 붙었는지 재지 않는다`);

    // ④ 열쇠가 아예 없으면 **이름으로** 말하고 멈춘다
    assert.ok(/TS_OAUTH_CLIENT_ID \+ TS_OAUTH_SECRET 이나 TS_AUTHKEY/.test(y),
      `${name}: 열쇠가 없을 때 무엇을 넣어야 하는지 안 말한다`);
  });
});

test('★ 안내서와 워크플로가 같은 Secret 이름을 말한다', () => {
  const g = fs.readFileSync(path.join(DOCS, '자동배포-켜는-법.md'), 'utf8');
  ['TS_OAUTH_CLIENT_ID', 'TS_OAUTH_SECRET', 'TS_AUTHKEY',
    'NAS_SSH_HOST', 'NAS_SSH_USER', 'NAS_SSH_KEY'].forEach((k) => {
    assert.ok(g.includes(k), `안내서에 ${k} 가 없다 — 넣어도 안 읽히는 Secret 이 생긴다`);
  });
  // ★ auth key 는 만료가 있다는 것을 **반드시** 말한다. 안 말하면 90일 뒤
  //   아무도 모르는 채로 배포가 죽는다
  assert.match(g, /만료/, 'auth key 에 만료가 있다는 것을 안 말한다');
  // ★ 셋을 켜야 한다는 것도 (하나만 빠져도 붙고 나서 안 된다)
  ['Reusable', 'Ephemeral'].forEach((k) => {
    assert.ok(g.includes(k), `auth key 만들 때 ${k} 를 켜라는 말이 없다`);
  });
});
