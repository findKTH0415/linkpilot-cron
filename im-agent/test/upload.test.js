'use strict';
/**
 * upload.test.js — 자료를 올리는 동안 화면이 무엇을 말하는가, 그리고
 * 단계에서 단계로 넘어가는 길이 실제로 이어져 있는가.
 *
 * 이 둘의 실패는 조용하다. 진행 바가 사라지면 사용자는 멈춘 줄 알고 다시
 * 누르고(두 번 올라간다), 다음 단계 주소에 `api` 가 빠지면 그 화면이
 * 「서버가 없습니다」로 열린다 — 부모가 열어 준 문이 안에서 잠기는 셈이다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const intake = fs.readFileSync(path.join(PLATFORM, 'intake.html'), 'utf8');
const fields = fs.readFileSync(path.join(PLATFORM, 'fields.html'), 'utf8');

/** 주석을 뺀 코드만 본다 — 설명 글이 규칙 위반으로 잡히면 안 된다 */
function codeOf(html) {
  return html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
}

/* ───────────── 업로드 진행률 ───────────── */

/**
 * ★ `fetch` 는 업로드 진행을 알려 주지 않는다. 진행률을 보여 주려면
 *   XMLHttpRequest 의 `upload.onprogress` 밖에 길이 없다.
 */
test('★ 업로드는 진행을 알려 주는 방법으로 보낸다', () => {
  const code = codeOf(intake);
  assert.match(code, /new XMLHttpRequest\(\)/, 'fetch 로는 업로드 진행을 알 수 없다');
  assert.match(code, /xhr\.upload\.onprogress/);
  assert.match(code, /ev\.lengthComputable/, '길이를 모를 때를 가려야 한다');
});

/**
 * ★ **다 보냈다고 끝난 것이 아니다.** 100% 를 찍고 나면 서버가 파일을 열어
 *   읽는 시간이 남아 있다. 거기서 100% 로 두면 「다 됐는데 화면이 멈췄다」가 된다.
 */
test('★ 보내는 중과 서버가 읽는 중을 가른다', () => {
  const code = codeOf(intake);
  assert.match(code, /phase: 'sending'/);
  assert.match(code, /phase = 'reading'/, '다 보낸 뒤의 단계가 없다');
  assert.match(code, /xhr\.upload\.onload/, '언제 다 보냈는지 알아야 단계를 바꾼다');
  // 읽는 단계에서는 진행률을 만들지 않는다 — 얼마나 걸릴지 모른다
  assert.match(code, /state\.upload\.phase = 'reading'; state\.upload\.pct = null/);
});

/** ★ 모르는 값은 0% 막대가 아니라 빗금이다 (진행률을 지어내지 않는다) */
test('★ 길이를 모르면 % 를 만들지 않는다', () => {
  const code = codeOf(intake);
  assert.match(code, /ev\.lengthComputable && ev\.total\s*\?[\s\S]{0,120}: null/);
  assert.match(intake, /up__bar--none/, '모를 때 그릴 빗금 막대가 없다');
});

/** ★ 100% 를 미리 찍지 않는다 — 보내는 동안 최대 99% 다 */
test('★ 보내는 중에는 100% 를 찍지 않는다', () => {
  assert.match(codeOf(intake), /Math\.min\(99,/,
    '보내는 도중 100% 가 뜨면 서버가 읽는 시간이 「멈춘 것」으로 읽힌다');
});

/**
 * ★ 조용히 죽지 않는다. 진행 바가 멈춘 채 남으면 사용자는 계속 기다린다.
 */
test('★ 전송이 끊기면 사유를 남긴다', () => {
  const code = codeOf(intake);
  assert.match(code, /xhr\.onerror/);
  assert.match(code, /전송이 끊겼습니다/);
  assert.match(code, /xhr\.onabort/, '중단도 같은 길로 처리해야 한다');
});

/**
 * ★ 진행 바를 자료 칸 **안**에 두면, 프로젝트가 만들어지는 순간 그 칸이
 *   사라지면서 — 업로드가 시작되는 바로 그때 — 진행 바도 함께 사라진다.
 *   (실제로 그렇게 만들었다가 헤드리스로 잡았다)
 */
test('★ 프로젝트가 만들어져도 진행 바가 사라지지 않는다', () => {
  const code = codeOf(intake);
  const render = code.slice(code.indexOf('function render()'));
  const upAt = render.indexOf('uploadCard()');
  // ★ 「결과 카드만 그리고 return 하는」 그 분기와 견준다. render 안에는
  //   state.created 를 보는 곳이 여럿이라(머리말 표시 등) 첫 번째와 비교하면 헛짚는다
  const returnAt = render.indexOf('body.appendChild(resultCard());');
  assert.ok(upAt !== -1, 'render 가 진행 바를 안 그린다');
  assert.ok(returnAt !== -1, '결과 카드를 그리는 곳을 못 찾았다');
  assert.ok(upAt < returnAt,
    '진행 바가 결과 카드 분기(return) 뒤에 있다 — 업로드가 시작되는 순간 사라진다');

  const drop = code.slice(code.indexOf('function dropCard()'), code.indexOf('function canGo()'));
  assert.ok(drop.indexOf('uploadCard()') === -1, '자료 칸 안에 두면 같은 문제가 다시 난다');
});

/* ───────────── 형식 판정 ───────────── */

/**
 * ★ 앱 실측: PDF·PNG 가 「처음 보는 형식입니다」로 떴다. `supported.text`·
 *   `supported.office` 둘만 봤기 때문이다 — 그 둘에는 pdf·hwp·이미지가 없다.
 *   읽히는 파일을 못 읽는다고 말하면 사용자는 아예 안 올린다.
 */
test('★ 읽는 방법 묶음(formats)으로 판정한다', () => {
  const code = codeOf(intake);
  const fn = code.slice(code.indexOf('function readableOf'), code.indexOf('function addFiles'));
  assert.match(fn, /state\.info\.formats/, '묶음을 안 보고 있다');
  assert.ok(fn.indexOf('supported.text') === -1 && fn.indexOf('s.text') === -1,
    'text·office 만 보면 pdf·hwp·이미지가 전부 「처음 보는 형식」이 된다');
  assert.match(fn, /grp\.id === 'convert'/, '변환이 필요한 형식을 가려야 한다');
  assert.match(fn, /grp\.hint/, '무엇으로 바꿔 올릴지 알려 줘야 한다');
});

test('★ 화면이 확장자를 직접 나열하지 않는다', () => {
  const code = codeOf(intake);
  ['.pdf', '.hwp', '.ifc', '.png'].forEach((e) => {
    assert.ok(code.indexOf(`'${e}'`) === -1, `intake.html 에 ${e} 가 박혀 있다`);
  });
});

/* ───────────── 단계 이동 ───────────── */

/**
 * ★ **api 를 물려주지 않으면** 다음 화면이 서버를 모르는 채로 열린다.
 *   `reports.html` 은 api 가 없으면 데모 데이터를 쓰므로, 앱 안에서
 *   가짜 산출물이 진짜처럼 보일 수 있다.
 */
test('★ 다음 단계 주소가 api 와 project 를 함께 넘긴다', () => {
  [['intake.html', intake], ['fields.html', fields]].forEach(([name, html]) => {
    const code = codeOf(html);
    assert.match(code, /function stepUrl\(/, `${name}: stepUrl 이 없다`);
    const fn = code.slice(code.indexOf('function stepUrl('), code.indexOf('function stepUrl(') + 700);
    assert.match(fn, /here\.get\('api'\)/, `${name}: 지금 주소의 api 를 안 읽는다`);
    assert.match(fn, /'api=' \+ encodeURIComponent/, `${name}: api 를 안 넘긴다`);
    assert.match(fn, /'project=' \+ encodeURIComponent/, `${name}: project 를 안 넘긴다`);
  });
});

test('★ 1단계가 끝나면 2단계로 가는 버튼이 그 자리에 있다', () => {
  const code = codeOf(intake);
  assert.match(code, /가이드 필드 입력으로 →/);
  assert.match(code, /next\.href = stepUrl\('fields\.html', c\.projectId\)/);
  // 올리는 중에는 못 넘어간다 — 넘어가면 업로드가 중간에 끊긴다
  assert.match(code, /if \(state\.busy\) \{ next\.setAttribute\('aria-disabled'/);
});

test('★ 2단계에서 저장하면 3단계로 가는 버튼이 그 자리에 뜬다', () => {
  const code = codeOf(fields);
  assert.match(code, /출력 사양 확정으로 →/);
  assert.match(code, /go\.href = stepUrl\('reports\.html'\)/);
  // 저장 성공 분기 안에 있어야 한다 — 실패했는데 다음으로 보내면 안 된다
  const at = code.indexOf('출력 사양 확정으로');
  const okAt = code.lastIndexOf('if (r.ok) {', at);
  const elseAt = code.lastIndexOf('} else {', at);
  assert.ok(okAt !== -1 && okAt > elseAt, '저장 실패에도 다음 버튼이 뜬다');
});

/**
 * ★ 필수가 덜 찼는데 조용히 넘기지 않는다. 사양을 확정하면 되돌리기 어렵다.
 */
test('★ 필수가 남아 있으면 넘어가기 전에 그렇다고 적는다', () => {
  const code = codeOf(fields);
  assert.match(code, /F\.completeness\(state\.fields, state\.values, C\.docType, classKeys\(\)\)/,
    '자산군 전용 필수까지 함께 세어야 한다');
  assert.match(code, /지금 넘어가도 되지만, 사양을 확정하면 되돌리기 어렵습니다/);
});

/** ★ 자산군을 못 찾으면 아무거나 고르지 않는다 */
test('★ 2단계가 자산군을 서버에서 받아 쓴다', () => {
  const code = codeOf(fields);
  assert.match(code, /function classKeys\(\)/);
  assert.match(code, /state\.assetClass = res\[1\]\.assetClass \|\| null/,
    '프로젝트에 딸린 자산군을 안 읽으면 분모가 공통 필수로만 남는다');
  const fn = code.slice(code.indexOf('function classKeys()'), code.indexOf('function stepUrl('));
  assert.match(fn, /if \(!state\.assetClass\) return null;/, '모르면 null 이어야 한다');
});
