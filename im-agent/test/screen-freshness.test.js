'use strict';
/**
 * screen-freshness.test.js — **화면이 「서버의 지금 판」인지 스스로 묻는지** 잰다
 * 〈2026-09-07 · M-77 · 사장님 화면에서 여드레 옛 판을 보고 계셨다〉.
 *
 * ★★★ 왜 만들었나. 사장님 보고서 화면의 판이 942097fb 였다. 그것은 이 저장소가
 *   **8월 30일**에 낸 판이고, NAS 에는 그날 판이 실려 있었다. 여드레 옛 화면을
 *   보고 계셨는데 **경보가 한 번도 안 울렸다.**
 *
 *   이미 있던 짝 확인은 「화면 ↔ 형제 스크립트」를 잰다 — 그것은 **묶음 안의**
 *   일관성이다. 사장님 경우는 둘 다 8월 30일 것이라 **서로 맞았다.**
 *   「이 화면이 지금 서버에 있는 그 판인가」는 **아무도 안 물었다.**
 *   둘은 다른 사실인데 하나만 재고 있었다.
 *
 * ★★ 이 검사는 글자를 대조하지 않는다 — **조각을 떼어 내 실제로 돌린다.**
 *   가짜 document·sessionStorage·location·fetch 위에서 네 경우를 센다.
 *
 * ⚠ 주석에 판 지문(942097fb)이 글자로 있다. 이 검사는 **HTML 안의 조각만** 떼어
 *   보므로 이 파일의 주석과는 무관하다 — 그래도 다른 검사가 이 파일을 훑을 때를
 *   위해, 여기서는 화면 파일을 이름으로만 가리키고 판을 글자로 못박지 않는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'ui', 'platform');
/* 실제로 배포되는 화면 일곱. 여기에만 「같은 코드여야 한다」가 걸린다. */
const SCREENS = ['fields.html', 'files.html', 'index.html', 'intake.html',
  'outputs.html', 'report-flow.html', 'reports.html'];
/* ★ 미리보기는 화면을 **문자열로 박아** 넣는다(`\n`·`\u003C` 로 이스케이프된다).
   소스로 댈 대상이 아니라, **들어 있기는 한지**만 센다 — 미리보기가 제품과 다른 것을
   보여 주면 그것이 M-05(옛말 하는 확인 화면)다. */
const PREVIEW = 'section-preview.html';
const HEAD = '/* ★★★ **「화면↔스크립트」가 맞아도 옛 판일 수 있다**';

function snippet(name) {
  const s = fs.readFileSync(path.join(DIR, name), 'utf8');
  const i = s.indexOf(HEAD);
  if (i < 0) return null;
  const j = s.indexOf('}());', i);
  return j < 0 ? null : s.slice(i, j + 5);
}

/* ── ① 여덟 화면 모두 갖고 있고, 모두 **같아야** 한다 ─────────────────────── */
test('★ 판 확인 조각이 여덟 화면에 다 있다 — 하나라도 빠지면 그 화면만 조용히 옛 판이 된다', () => {
  const missing = SCREENS.filter((n) => !snippet(n));
  assert.deepStrictEqual(missing, [],
    '★ 위 화면에 서버 판 확인 조각이 없다. 짝 확인(화면↔스크립트)만으로는 '
    + '**둘 다 옛 판일 때** 안 울린다 — 실제로 그래서 여드레를 못 잡았다');
});

/* ★ **주석을 걷고 본다** (CLAUDE.md §8). 이 조각의 주석에는 경위가 길게 적혀 있어,
   안 걷으면 주석 한 줄만 고쳐도 「코드가 갈렸다」로 빨개진다. 재려는 것은
   **도는 코드가 같은가**이지 주석이 아니다. */
const nocomment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();

test('★★ 여덟 벌이 **같은 코드다** — 복제본 하나만 고쳐지는 날이 온다', () => {
  const bodies = SCREENS.map((n) => nocomment(snippet(n)));
  const first = bodies[0];
  const drift = SCREENS.filter((n, k) => bodies[k] !== first);
  assert.deepStrictEqual(drift, [],
    '★ 조각이 화면마다 달라졌다. 이 조각은 **딴 파일로 뺄 수 없다**(그 파일 자체가 '
    + '옛 판일 수 있어 재는 뜻이 사라진다) — 그래서 복제가 일부러이고, '
    + '**같은지는 검사가 지킨다** (CLAUDE.md §8 「두 벌이 되면 한쪽이 옛말을 한다」)');
});

/* ── ② 떼어 내 **실제로 돌린다** ──────────────────────────────────────────── */
function run({ want, served, fetchFails = false, alreadyFixed = false }) {
  const log = [];
  const store = {};
  if (alreadyFixed) store['lp-freshfix-' + want] = '1';

  const el = () => ({
    _t: '', children: [],
    setAttribute() {}, appendChild(c) { this.children.push(c); },
    set textContent(v) { this._t = v; }, get textContent() { return this._t; },
    set onclick(f) { this._click = f; }, get onclick() { return this._click; },
  });
  const body = el();
  const doc = {
    documentElement: { getAttribute: () => want },
    body,
    createElement: () => el(),
    addEventListener() {},
  };
  const ss = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); log.push('set:' + k); },
  };
  const loc = {
    href: 'https://x/im-flow/report-flow.html',
    replace: (u) => log.push('replace:' + u),
  };
  const fetchFn = () => (fetchFails
    ? Promise.reject(new Error('no net'))
    : Promise.resolve({ ok: true, text: () => Promise.resolve(
      served ? '<html data-lp-build="' + served + '">' : '<html>') }));

  /* ★ 괄호로 감싸지 않는다 — 조각은 `(function(){…}());` 로 **끝나는 문장**이라
     감싸면 그 세미콜론에서 깨진다. 실제로 다섯 칸이 그렇게 빨갰다. */
  new Function('document', 'sessionStorage', 'location', 'fetch',
    snippet('report-flow.html'))(doc, ss, loc, fetchFn);
  return { log, body, wait: () => new Promise((r) => setTimeout(r, 0)) };
}

test('★ 미리보기에도 그 검사가 들어 있다 — 확인 화면이 제품과 다른 것을 보여 주면 M-05 다', () => {
  const t = fs.readFileSync(path.join(DIR, PREVIEW), 'utf8');
  assert.ok(t.includes('lp-freshfix-'),
    `★ ${PREVIEW} 에 서버 판 확인이 없다 — 미리보기로 확인해도 제품의 동작을 못 본다. `
    + '`npm run im:section` 으로 다시 만든다');
});

test('판이 같으면 아무 말도 안 한다 — 멀쩡한 화면에 띠를 띄우지 않는다', async () => {
  const r = run({ want: 'aaaaaaaa', served: 'aaaaaaaa' });
  await r.wait(); await r.wait();
  assert.strictEqual(r.body.children.length, 0, '판이 같은데 띠가 떴다');
  assert.ok(!r.log.some((x) => x.indexOf('replace:') === 0), '판이 같은데 다시 받았다');
});

test('★★★ 서버가 새 판이면 **한 번은 스스로 고친다** — 사람에게 떠넘기지 않는다', async () => {
  const r = run({ want: 'aaaaaaaa', served: 'bbbbbbbb' });
  await r.wait(); await r.wait();
  const go = r.log.find((x) => x.indexOf('replace:') === 0);
  assert.ok(go, '★ 서버가 새 판인데 다시 받지 않는다 — 사장님이 옛 화면에 갇힌다');
  assert.match(go, /lpfresh=\d+/, '★ 주소에 표가 없으면 브라우저가 같은 캐시본을 또 준다');
});

test('★★ 고치고도 그대로면 **두 판을 나란히 적은 띠**를 띄운다', async () => {
  const r = run({ want: 'aaaaaaaa', served: 'bbbbbbbb', alreadyFixed: true });
  await r.wait(); await r.wait();
  assert.strictEqual(r.body.children.length, 1, '★ 두 번째인데 띠가 안 뜬다 — 조용히 옛 판에 남는다');
  const band = r.body.children[0];
  const text = band.children.map((c) => c.textContent).join(' ');
  assert.match(text, /aaaaaaaa/, '지금 화면 판이 안 적혔다');
  assert.match(text, /bbbbbbbb/, '서버 판이 안 적혔다 — 둘을 대야 사장님이 가리실 수 있다');
  const btn = band.children.find((c) => typeof c.onclick === 'function');
  assert.ok(btn, '★ 단추가 없다 — 읽고 나서 할 수 있는 일이 없으면 띠는 잔소리다');
  btn.onclick();
  assert.ok(r.log.some((x) => /replace:.*lpfresh=\d+/.test(x)), '★ 단추가 아무 일도 안 한다');
});

test('못 물어봤으면 **아무 말도 안 한다** — 못 잰 것을 옛 판이라고 하지 않는다', async () => {
  const r = run({ want: 'aaaaaaaa', served: null, fetchFails: true });
  await r.wait(); await r.wait();
  assert.strictEqual(r.body.children.length, 0, '★ 연결이 안 됐을 뿐인데 「옛 판」이라고 적었다');
});

test('판을 안 박은 화면에서는 그냥 지나간다', async () => {
  const r = run({ want: '', served: 'bbbbbbbb' });
  await r.wait();
  assert.strictEqual(r.body.children.length, 0);
  assert.strictEqual(r.log.length, 0, '잴 것이 없는데 저장소를 건드렸다');
});
