'use strict';
/**
 * upload-unread.test.js — **받은 것과 읽은 것은 다르다** (2026-08-22).
 *
 * ★★ 실제 신고: 「1번 첨부하여 수집한 파일들 모이는곳 파일업로드하면 오류가 발생
 *   깨짐」. 재현해 보니 오류 상자도 없었고 예외도 없었다. 화면은 초록 칸에
 *   「2개를 올렸습니다」만 띄웠다 — 그런데 **둘 다 읽히지 않았다.**
 *
 *   서버는 세 가지를 따로 준다:
 *     rejected          — 아예 안 받았다 (빈 파일·용량 초과)
 *     read.unsupported  — **받았는데 못 읽었다** (엑셀·한글 문서·손상된 ZIP)
 *     read.facts        — 읽어서 값이 됐다
 *   화면은 첫째만 그리고 **가운데를 통째로 빼먹고 있었다.** 그래서 사용자는
 *   성공 표시를 본 뒤 다음 칸이 비어 있는 것을 고장으로 읽었다.
 *
 * ★ 1회성(파일업로드)은 여기서 한 겹 더 나쁘다 — 서버가 읽어 보고 **원본을
 *   이미 지웠다.** 못 읽었다고 말하지 않으면 자료가 사라진 것도 모른다.
 *
 * 그래서 이 시험은 **실제로 눌러 본다.** 문자열 검사로는 「그리기는 하는데
 *   그 자리까지 안 간다」를 못 잡는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), 'utf8');

test('★★ 받았지만 못 읽은 자료를 화면이 말한다 (올려 보고 잰다)', async () => {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  if (!findBrowser()) return;   // 크로미움이 없는 서버가 실제로 있다

  const { buildLive } = require(path.join(PLATFORM, 'build-files.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-unread-'));
  const frag = path.join(dir, 'frag.html');
  await buildLive(frag);

  /* ★ 올리는 손은 **미리 그리는 판과 같은 것**을 쓴다 (`uploadDriver`).
       둘로 갈리면 한쪽만 고쳐지고, 그때 시험은 실제와 다른 것을 재게 된다.
       ★ 그 손은 정해진 시간을 기다리지 않고 **다음 것이 나타날 때까지** 되묻는다 —
         시험을 여럿 한꺼번에 돌리면 고정 대기는 가끔 못 끝냈다. */
  const { uploadDriver } = require(path.join(PLATFORM, 'build-files.js'));
  const probe = '<div id="probe"></div><script>(function () {'
    + 'var $ = function (s) { return document.querySelector(s); };'
    + 'var $$ = function (s) { return [].slice.call(document.querySelectorAll(s)); };'
    + 'var out = { err: [] };'
    + 'window.onerror = function (m) { out.err.push(String(m)); };'
    + 'window.addEventListener("unhandledrejection", function (e) {'
    + '  out.err.push("rejected: " + ((e.reason && e.reason.message) || e.reason)); });'
    + 'var n = 0;'
    + 'var t = setInterval(function () {'
    + '  var d = window.__lpDrove || {};'
    + '  out.step = d.step || null; out.ticks = d.ticks || 0;'
    /* 2026-08-23 병합: 갈래 토글이 없어졌다. 파일업로드 칸이 늘 보인다 */
    /* ★ **끈끈하게 잰다** 〈2026-08-27 · D-146〉. 올리기가 끝나면 ②칸이 접히므로
     *   마지막 틱만 보면 「칸이 없다」가 된다 — 재려는 것은 **올리기 전에 있었는가**다.
     *   접는 것은 일부러 한 것이고, 이 검사가 재려는 것은 그것이 아니다. */
    + '  out.sawTile = out.sawTile || !!$$(".ways2__t").filter(function (b) { return /파일업로드/.test(b.textContent); })[0];'
    + '  out.hasTile = out.sawTile;'
    + '  out.hasDrop = out.hasDrop || !!$(".drop input");'   /* 같은 까닭으로 끈끈하게 */
    + '  out.headings = $$(".sub__n").map(function (x) { return x.textContent; });'
    + '  out.rows = $$(".row__n").map(function (x) { return x.textContent; });'
    + '  out.phase = ($(".up__h b") || {}).textContent || null;'
    + '  out.lines = $$(".up__d").map(function (x) { return x.textContent; });'
    + '  out.bad = $$(".up__d--bad").map(function (x) { return x.textContent; });'
    + '  out.errBox = $$(".err").length;'
    + '  document.getElementById("probe").textContent = JSON.stringify(out);'
    /* ★★ **손이 끝났다고 화면이 다 그려진 것은 아니다** 〈2026-08-22 · CI 에서 잡혔다〉.
     *   앞 판은 `d.done` 만 보고 멈췄다. 손과 탐침이 둘 다 50ms 마다 도는데,
     *   같은 틱에서 **탐침이 먼저 돌면** 손이 방금 만든 칸을 못 보고 멈춘다 —
     *   ③ 번호가 없다며 CI 만 간헐 실패했다(로컬 3회 연속 통과).
     *   ★ 그래서 **재려는 것이 실제로 보일 때까지** 돈다. 끝내 안 나오면
     *     한도(700틱)에서 멈추고, 그때는 단언이 사실대로 실패한다. */
    /* ★★ **되묻는 한도가 그리기 예산보다 작아야 한다** 〈2026-08-22 · 두 번째 CI 실패〉.
     *   앞 판은 700틱(=35초 가상시간)까지 되물었는데 예산이 30초였다. 그러면
     *   **크로미움이 먼저 화면을 뱉고 끝낸다** — 탐침은 아직 못 봤는데 그때까지
     *   본 것만 남는다. 로컬은 손이 빨라 그 전에 끝나서 늘 통과했다.
     *   ★ 500틱(=25초) 으로 낮추고 예산을 60초로 올린다. 이제 **먼저 멈추는 쪽이
     *     탐침**이라, 못 본 것은 「못 봤다」로 단언에 사실대로 나온다. */
    /* ★★ **손이 늘어나면 탐침도 늘려야 한다** 〈2026-08-22 · 세 번째로 같은 자리〉.
     *   `uploadDriver` 가 3600틱까지 되묻도록 늘었는데 탐침은 500틱에 멈춰 있었다.
     *   그러면 손이 아직 일하는 중에 탐침이 먼저 끝나서 「③ 번호가 없다」가 된다.
     *   ★ 셋의 크기는 **한 방향으로 줄 세운다** — 손(180초) ≤ 탐침(180초) < 예산(240초).
     *     하나만 고치면 다음에 또 같은 자리에서 흔들린다. */
    + '  var ready = d.done && out.phase === "올렸습니다" && (out.headings || []).length >= 3;'
    + '  if (ready || ++n > 3600) clearInterval(t);'
    + '}, 50);'
    + '}());<' + '/script>';

  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'
    + fs.readFileSync(frag, 'utf8') + uploadDriver() + probe + '</body></html>');

  // 예산 > 되묻는 한도(3600 × 50ms = 180초). 반대면 화면이 먼저 잘린다
  const dom = renderDom(findBrowser(), page, 240000, 430);
  const m = dom.match(/<div id="probe">([^<]*)<\/div>/);
  assert.ok(m && m[1], '탐침이 아무것도 안 남겼다 — 화면이 그 자리까지 못 갔다');
  const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

  assert.deepStrictEqual(r.err, [], '올리는 동안 예외가 났다');
  assert.ok(r.hasTile, '「파일업로드」 칸이 없다');
  assert.ok(r.hasDrop, '파일 고르기가 없다');

  // ① 번호 붙은 칸이 실제로 그려진다 — 사용자가 손으로 그려 알려 준 그 구분
  /* ★ ①②는 늘 있고, **올린 뒤에는 ③(이관)이 붙는다** 〈2026-08-22〉.
   *   ③ 이 없으면 넘어가는 것이 말없이 일어난다 — 그것이 「화면이 사라진다」였다. */
  assert.deepStrictEqual(r.headings, ['1', '2', '3'],
    '① 자료 수집 · ② 자료 스캔 · ③ 넘기기 번호가 화면에 없다 — '
    + '어디까지가 모으는 일이고 언제 떠나는지가 안 보인다 '
    /* ★ 걸음과 되물은 횟수를 함께 적는다 — 「아직 못 갔다」와 「가 놓고 안 그렸다」는
     *   고치는 곳이 다른데, 숫자가 없으면 둘이 같아 보인다 */
    + `(마지막 걸음 ${r.step} · ${r.ticks}번 되물었다 · 단계 ${r.phase})`);

  assert.deepStrictEqual(r.rows, ['[붙임3]산출근거.xlsx', '사업계획서(초안).pdf'],
    '고른 파일 이름이 그대로 안 나온다');
  assert.strictEqual(r.phase, '올렸습니다',
    `올리기가 끝나지 않았다 — 마지막 걸음 ${r.step} · ${r.ticks}번 되물었다`);
  assert.strictEqual(r.errBox, 0, '빨간 오류 상자가 떴다 — 이건 고장이 아니다');

  // ★★ 핵심: **못 읽은 것을 말한다.** 이 줄이 없던 것이 신고의 원인이다
  const all = r.lines.join('\n');
  assert.match(all, /읽지 못했습니다/,
    '못 읽은 자료를 한 줄도 안 말한다 — 「올렸습니다」만 보고 다음 칸이 빈 것을 고장으로 읽는다');
  assert.match(all, /\[붙임3\]산출근거\.xlsx/,
    '어느 파일이 안 읽혔는지 이름을 안 적는다 — 무엇을 다시 올려야 할지 모른다');
  assert.ok(r.bad.length >= 2,
    '나쁜 소식이 초록 칸 안에서 눈에 안 걸린다 (up__d--bad 가 안 붙었다)');

  // ★ 1회성은 **원본이 남아 있지 않다.** 그 말까지 해야 사용자가 판단할 수 있다
  assert.match(all, /원본을 지웁니다|남아 있지 않습니다/,
    '1회성이라 원본이 사라졌다는 말이 없다 — 자료를 잃은 것도 모른다');

  // ★ 읽힌 것까지 싸잡아 실패로 말하지 않는다
  assert.match(all, /2개를 올렸습니다/, '올린 개수를 안 말한다');

  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * ★★★ **올리기가 실패했다고 화면을 통째로 갈아치우지 않는다**
 *   〈2026-08-22 · 실제 신고 「화면이 사라지는 오류」〉.
 *
 * 신고 순서가 결정적이었다: 목록이 멀쩡히 뜨고 → 8.7MB 를 올리다 멈추고 →
 * **그다음에** 「로그인이 필요합니다」가 떴다. 목록이 떴다는 것은 로그인이
 * 되어 있었다는 뜻이다. 그런데 화면은 로그인을 의심하게 만들었고, 게다가
 * `paint()` 가 게이트에서 `return` 하는 바람에 **고른 파일도 진행 그래프도
 * 전부 사라졌다.** 그것이 「화면이 사라진다」의 정체다.
 */
test('★★★ 올리기 401 을 화면 전체 게이트로 올리지 않는다', () => {
  const code = read('files.html').replace(/\/\*[\s\S]*?\*\//g, '');
  const m = code.match(/onFail:\s*function[\s\S]{0,700}?\n      \},/);
  assert.ok(m, 'doUpload 의 onFail 을 못 찾았다');
  assert.doesNotMatch(m[0], /state\.gate\s*=/,
    '올리기 실패가 화면 전체 게이트를 세운다 — 고른 파일·그래프가 통째로 사라진다');
  assert.match(m[0], /state\.uploadFail\s*=/,
    '실패 사유를 올리기 칸에 남기지 않는다 — 무엇이 잘못됐는지 자리가 없다');
  // 그리고 그 사유가 **화면에 그려져야** 한다
  assert.match(code, /uploadFail[\s\S]{0,900}?401/,
    '401 을 올리기 칸에서 설명하지 않는다');
});

/** ★ 멈춤은 화면까지 와야 뜻이 있다 — 모듈만 알고 있으면 사용자는 못 본다 */
test('★★ 멈춤 경고를 화면이 그린다', () => {
  const code = read('files.html').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(code, /u\.stalled/, '화면이 멈춤 표시를 안 읽는다');
  assert.match(code, /u\.stallWhy/, '멈춘 사유를 안 그린다');
});
