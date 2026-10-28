'use strict';
/**
 * workorder.test.js — 작업지시서가 **코드와 같은 말을 하는가** (2026-08-18).
 *
 * ★★ 지시서는 받는 사람이 **그대로 따라 하는** 문서다. 여기 적힌 파일 목록·
 *   탭 이름·API 개수·한도가 코드와 갈리면, 갈린 줄 모르고 따라 하다가
 *   **빠뜨린 파일 하나 때문에 화면이 색 없이 뜨거나 탭이 안 열린다.**
 *   그리고 그 원인은 문서를 의심하기 전까지 안 보인다.
 *
 * ★ 초판(2026-08-15)이 실제로 그렇게 됐다 — 탭 구조가 생기기 전 순서가 그대로
 *   남아 있었고, 아무도 모르고 있었다. 그래서 **세어서 맞추는 검사**를 둔다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const DOC = fs.readFileSync(path.join(ROOT, 'docs', '작업지시서-플랫폼-연동.md'), 'utf8');
const F = require('../ui/platform/flow-core.js');

/**
 * 배포가 **실제로 요구하는** 파일 — 손으로 적지 않는다.
 *
 * ★★★ **여기서 다시 훑지 않는다** 〈2026-08-22 · 실제로 갈렸다〉. 앞 판은 이
 *   파일 안에 `required()` 를 **한 벌 더** 갖고 있었다. 그러다 자료 업로드가
 *   탭에서 1단계 안(iframe)으로 옮겨 가자, 본체는 그 화면을 세는데 이 사본은
 *   못 세서 **14개 대 16개**로 갈렸다. 사본은 이렇게 조용히 갈린다.
 *   ★ 정본은 `build-embed.js` 의 `required()` 하나다.
 */
const { required } = require('../ui/platform/build-embed.js');

test('★★ 작업지시서의 파일 목록이 실제로 필요한 것과 같다', () => {
  const need = required();
  const missing = need.filter(f => !DOC.includes(f));
  assert.deepStrictEqual(missing, [],
    `지시서에 없는 파일: ${missing.join(', ')} — 이대로 배포하면 그 파일이 빠진다`);
  assert.ok(DOC.includes(`**${need.length}개**`),
    `지시서가 적은 개수가 실제(${need.length})와 다르다`);
});

test('★ 작업지시서의 탭 이름이 flow-core 와 같다', () => {
  F.TABS.forEach((t) => {
    assert.ok(DOC.includes(t.tab), `지시서에 탭 「${t.tab}」 이 없다`);
  });
  // 탭마다 채우는 전역이 하나씩 있어야 한다 — 빠지면 그 탭만 빈 화면이 된다
  ['LINKPILOT_OUTPUTS', 'LINKPILOT_REPORT_FLOW', 'LINKPILOT_FILES'].forEach((g) => {
    assert.ok(DOC.includes('window.' + g), `지시서에 ${g} 가 없다`);
  });
});

test('★ 작업지시서의 API 개수·한도가 코드와 같다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-'));
  try {
    process.env.IM_AGENT_ROOT = tmp;
    const agent = path.join(__dirname, '..');
    const w = Object.keys(require('../ui/report-api.cjs').createHandlers(
      { agentRoot: tmp, agentModulePath: agent, authenticate: () => ({ planId: 'pro' }) })).length;
    const r = Object.keys(require('../ui/api-router.cjs').createHandlers(
      { agentModulePath: agent })).length;
    assert.ok(DOC.includes(`**${w + r}개** (읽기 ${r} · 쓰기 ${w})`),
      `API 개수가 다르다 — 실제 읽기 ${r} · 쓰기 ${w}`);

    const ar = require('../ui/api-router.cjs');
    const mb = (b) => b / 1048576;
    assert.ok(DOC.includes(`${mb(ar.MAX_FILE_BYTES)}MB · 한 번에 ${mb(ar.MAX_REQUEST_BYTES)}MB`),
      '자료 한도가 코드와 다르다');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

/**
 * ★ 지시서가 **왜 그렇게 하는지**까지 적혀 있어야 한다. 「이렇게 하세요」만 있으면
 *   빠뜨렸을 때 무슨 일이 나는지 몰라서, 급할 때 제일 먼저 건너뛴다.
 */
test('★ 조용히 무너지는 것들이 지시서에 적혀 있다', () => {
  ['runningFor', 'tokens.css', 'inTab', 'authenticate'].forEach((k) => {
    assert.ok(DOC.includes(k), `지시서에 ${k} 가 없다`);
  });
  assert.ok(DOC.includes('조용히 무너지는'), '무엇이 조용히 깨지는지 모아 놓은 곳이 없다');
  // 글꼴은 **산출물로** 확인해야 한다 — 「설치했다」로 끝나면 D-52 가 되살아난다
  assert.ok(DOC.includes('grep CJK'), '글꼴을 PDF 로 확인하는 방법이 없다');
});
