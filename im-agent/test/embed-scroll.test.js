'use strict';
/**
 * embed-scroll.test.js — **틀 안 화면이 스크롤을 끊지 않는다 · 여섯 벌을 한꺼번에 받는다**
 *   〈2026-09-15 사장님 지시: 「보고서 생성 스크롤이 부드럽지 않고 끊김 ·
 *   그리고 아직도 느리고 늦게 로딩됨 · 교차검증하여 개선해줘」〉.
 *
 * ★★★ [끊김의 정체] 높이를 알리는 조각이 **문서의 모든 바뀜**을 보고 있었다
 *   (`attributes:true` · `characterData:true`). 이 화면은 만지는 동안 딱지·진행률·
 *   `data-` 표시가 쉬지 않고 바뀌는데, **높이와 상관없는 그 바뀜마다**
 *   `getBoundingClientRect()` 로 **레이아웃을 강제**하고 부모에게 높이를 보냈다.
 *   부모는 그때마다 iframe 높이를 다시 잡는다(React 상태 갱신) — 그리는 프레임이
 *   버려지고, 그 버려진 프레임이 눈에는 **「끊김」**으로 보인다.
 *
 * ★★★ [느림의 정체] 화면이 부르는 스크립트 여섯이 전부 **막는(blocking)** 스크립트다.
 *   파서가 한 벌씩 기다렸다 다음 것을 부르므로, 폰에서 터널을 지나면 **왕복 여섯 번을
 *   줄 서서** 기다린다. 파일이 커서가 아니라 **차례로 기다려서** 느렸다.
 *   ★ 미리받기(`preload`)는 **받는 차례만** 바꾸고 **도는 차례는 안 바꾼다** —
 *     그래서 인라인 조각이 `F.` 를 바로 쓰는 지금 구조를 한 글자도 안 건드린다.
 *     (`defer` 로 하면 그 구조가 깨진다 — 그래서 안 썼다.)
 *
 * ★★ [재는 법] 「빠른가」를 초로 잴 수는 없다(이 자리에 망도 폰도 없다).
 *   **「헛도는 바퀴를 없앴는가」**를 잰다 — 무엇을 보고 있는가 · 몇 번을 줄 서는가.
 *   못 잰 것은 못 쟀다고 적는다 (CLAUDE.md §8).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const P = path.join(__dirname, '..', 'ui', 'platform');
const BRIDGE = fs.readFileSync(path.join(P, 'embed-bridge.js'), 'utf8');
/** 주석을 떼고 본다 — 주석에 적은 경위를 코드로 읽으면 헛돈다 (§8) */
const NC = BRIDGE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');

test('★★★ 높이를 «높이와 상관있는 바뀜»에서만 다시 잰다 — 딱지가 바뀔 때마다 재지 않는다', () => {
  const m = NC.match(/observe\(document\.documentElement,\s*\{([^}]*)\}/);
  assert.ok(m, '높이를 다시 재는 자리를 못 찾았다 — 이 칸은 아무것도 안 잰다');
  const opt = m[1];
  assert.ok(!/characterData:\s*true/.test(opt),
    '글자 한 자 바뀜까지 본다 — 만지는 내내 레이아웃이 강제되어 스크롤이 끊긴다');
  assert.ok(/attributeFilter:/.test(opt),
    '모든 속성 바뀜을 본다 — 진행률·data- 표시가 바뀔 때마다 부모를 깨운다');
  for (const k of ['style', 'class', 'hidden', 'open']) {
    assert.ok(new RegExp("'" + k + "'").test(opt),
      "펴고 접는 속성 '" + k + "' 이 빠졌다 — 펼쳐도 iframe 이 안 커진다");
  }
  assert.ok(/childList:\s*true/.test(opt), '칸이 생기고 없어지는 것을 안 본다 — 높이가 안 따라간다');
});

test('★★★ 재는 일을 «프레임 사이»로 옮긴다 — 레이아웃 강제가 그리던 프레임을 안 버린다', () => {
  assert.ok(/requestAnimationFrame/.test(NC),
    '아무 때나 재고 있다 — getBoundingClientRect 가 그 자리에서 레이아웃을 강제한다');
  const i = NC.indexOf('function tell()');
  const seg = NC.slice(i, i + 700);
  assert.ok(/requestAnimationFrame\(run\)/.test(seg), '높이를 재는 그 자리가 프레임 사이가 아니다');
  assert.ok(/requestAnimationFrame\)\s*window\.requestAnimationFrame/.test(seg) || /else run\(\)/.test(seg),
    '옛 브라우저에서 아예 안 재게 된다 — 물러설 길이 없다');
});

test('★★ 잔떨림을 한 번으로 합친다 — 문턱 8px · 기다림 120ms', () => {
  assert.ok(/Math\.abs\(h - last\) < 8/.test(NC),
    '문턱이 8px 이 아니다 — 부모가 8px 을 더해 잡으므로 그보다 작으면 왕복이 끝없이 난다');
  assert.ok(/setTimeout\(tell, 120\)/.test(NC), '합치는 시간이 120ms 가 아니다');
});

test('★★★ 「높이가 내용을 따라간다」는 그대로다 — 약하게 고친 것이 아니다', () => {
  assert.ok(/window\.addEventListener\('load', soon\)/.test(NC), '다 뜬 뒤에 한 번 안 잰다');
  assert.ok(/window\.addEventListener\('resize', soon/.test(NC), '창 크기가 바뀔 때 안 잰다');
  assert.ok(/lp-embed-height/.test(NC), '부모에게 알리는 계약이 사라졌다');
});

test('★★★ 스크립트 여섯을 «한꺼번에» 받는다 — 여섯 번 줄 서지 않는다', () => {
  const html = fs.readFileSync(path.join(P, 'report-flow.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"?]+)(\?v=[0-9a-f]*)?"/g)].map((m) => [m[1], m[2] || '']);
  const pre = [...html.matchAll(/<link rel="preload" as="script" href="([^"?]+)(\?v=[0-9a-f]*)?"/g)]
    .map((m) => [m[1], m[2] || '']);
  assert.ok(srcs.length >= 5, '부르는 스크립트를 못 읽었다 (' + srcs.length + ') — 이 칸은 아무것도 안 잰다');
  for (const [n, v] of srcs) {
    const hit = pre.find((x) => x[0] === n);
    assert.ok(hit, n + ' 을 미리 안 받는다 — 그 한 벌만큼 더 줄 선다');
    /* ★★★ 글자까지 같아야 한다 — 다르면 «같은 파일을 두 번» 받아 오히려 느려진다 */
    assert.strictEqual(hit[1], v, n + ' 의 미리받기 주소 판이 다르다 — 두 번 받는다');
  }
  console.log('     · 미리받기 ' + pre.length + '벌 · 부르는 스크립트 ' + srcs.length + '벌');
});

test('★ 미리받기 주소에도 지문을 찍는다 — 안 찍으면 판이 갈려 두 번 받는다', () => {
  const st = fs.readFileSync(path.join(P, 'build-stamp.js'), 'utf8');
  assert.ok(/rel="preload" as="script" href="/.test(st),
    'build-stamp.js 가 미리받기 주소를 모른다 — 고칠 때마다 판이 갈린다');
});

/* ★★ 여기서 «못 잰 것»을 적어 둔다 — 초록을 「빨라졌다」로 읽지 않기 위해서다 */
test('★ 실제로 몇 초 걸리는지는 이 자리에서 «못 잰다»', () => {
  console.log('     · 폰도 터널도 없는 자리다 — 잰 것은 「헛도는 바퀴를 없앴는가」뿐이다');
  console.log('     · 「부드러워졌다」는 사장님 화면에서만 확인된다 (§8 — 못 잰 것은 통과가 아니다)');
  assert.ok(true);
});

/* ★★★ **미리받기 줄이 «단벌 문서»에 따라 들어가면 안 된다** 〈2026-09-15 · 실제로 났다〉.
 *   미리보기·조각은 형제 스크립트를 본문에 통째로 넣는다 — 그러면 부를 파일이 옆에 없어
 *   미리받기 줄이 **404** 를 만들고, 화면의 「필요한 파일을 못 받았습니다」 빨간 띠가
 *   **멀쩡한 미리보기 위에** 찍혀 나갔다.
 * ★ 교차검증이 그것을 잡았다 — 초록이었으면 그 띠가 박힌 조각을 사장님께 드렸을 것이다. */
test('★★★ 단벌 문서(미리보기·조각)에는 미리받기 줄이 없다', () => {
  for (const f of ['section-preview.html', 'section-artifact.html', 'section-static.html']) {
    const p = path.join(P, f);
    if (!fs.existsSync(p)) { console.log('     · ' + f + ' 이 없다 — 이 칸은 그 화면을 못 쟀다'); continue; }
    const s = fs.readFileSync(p, 'utf8');
    assert.ok(!/<link rel="preload" as="script"/.test(s),
      f + ' 에 미리받기 줄이 남았다 — 옆에 없는 파일을 불러 빨간 띠가 뜬다');
    assert.ok(!/data-lp-fail=""/.test(s),
      f + ' 에 「파일을 못 받았습니다」 띠가 찍혀 있다 — 그대로 내보내면 고장으로 읽힌다');
  }
});
