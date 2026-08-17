'use strict';
/**
 * flow.test.js — 앱 [보고서 생성] 섹션(report-flow.html)과 4단계 단일 출처.
 *
 * 여기서 지키는 것:
 *   ① 단계 목록이 두 벌이 되지 않는가 (제품과 미리보기가 다른 흐름을 보이면 끝이다)
 *   ② 단계 화면을 복사하지 않았는가 (복사하면 출처 검사가 두 벌이 된다)
 *   ③ 잠긴 단계가 **이유를 말하는가** (이유 없는 회색은 고장으로 보인다)
 *   ④ 문서를 스크립트에 심을 때 화면이 통째로 비지 않는가 (실제로 그랬다)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const F = require('../ui/platform/flow-core.js');
const { buildSection, SCREENS } = require('../ui/platform/build-preview.js');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), 'utf8');

/* ───────────── 단일 출처 ───────────── */

test('★ 4단계 목록이 한 곳에만 있다', () => {
  assert.strictEqual(SCREENS, F.STEPS, '미리보기가 자기 목록을 따로 들고 있다');

  const flow = read('report-flow.html');
  assert.match(flow, /flow-core\.js/, '제품 화면도 같은 파일을 읽어야 한다');
  // 화면이 단계 이름을 직접 적어 두면 flow-core 를 고쳐도 화면은 안 바뀐다
  F.STEPS.forEach((s) => {
    assert.ok(!flow.includes("'" + s.name + "'"),
      `report-flow.html 에 '${s.name}' 이 하드코딩돼 있다 — 목록이 두 벌이 된다`);
  });
});

test('★ 단계 화면을 복사하지 않는다', () => {
  const flow = read('report-flow.html');
  // 실제 화면들의 표시는 그쪽 파일에만 있어야 한다
  ['이 사양으로 확정', '출처 없는 값은 저장', '지원하지 않는 형식'].forEach((needle) => {
    assert.ok(!flow.includes(needle),
      `'${needle}' 이 셸에 복사돼 있다 — 규칙이 두 벌이 되고 한쪽만 고치는 날 갈린다`);
  });
  assert.match(flow, /iframe/, '화면들을 그대로 끼워야 한다');
});

/* ───────────── 잠금과 이유 ───────────── */

test('★ 잠긴 단계는 이유를 말한다', () => {
  const noApi = F.stepState({ api: null, projectId: 'LP-DC-2026-001' });
  noApi.forEach(s => assert.strictEqual(s.why, F.WHY.api, `${s.no}단계에 사유가 없다`));

  const noProject = F.stepState({ api: '/api', projectId: null });
  assert.strictEqual(noProject[0].locked, false, '1단계는 프로젝트 없이도 열려야 한다');
  [1, 2, 3].forEach((i) => {
    assert.strictEqual(noProject[i].locked, true);
    assert.strictEqual(noProject[i].why, F.WHY.project);
  });

  const ok = F.stepState({ api: '/api', projectId: 'LP-DC-2026-001' });
  ok.forEach(s => assert.strictEqual(s.locked, false, `${s.no}단계가 이유 없이 잠겼다`));
});

test('★ 서버 미연결이 프로젝트 없음보다 먼저 나온다', () => {
  // 순서를 바꾸면 "프로젝트를 만드세요"만 뜨고 진짜 원인(미연결)이 가려진다.
  // 그 상태에서는 1단계를 눌러도 프로젝트가 안 만들어져 사용자가 갇힌다
  const s = F.stepState({ api: null, projectId: null });
  assert.strictEqual(s[1].why, F.WHY.api);
});

test('단계 주소에 프로젝트가 붙는다 (화면들이 ?project= 를 읽는다)', () => {
  const ctx = { base: '/im/', projectId: 'LP-DC-2026-001' };
  assert.strictEqual(F.urlFor(F.STEPS[0], ctx), '/im/intake.html', '1단계는 프로젝트가 없다');
  assert.strictEqual(F.urlFor(F.STEPS[1], ctx), '/im/fields.html?project=LP-DC-2026-001');
  assert.strictEqual(F.urlFor(F.STEPS[1], { projectId: null }), 'fields.html');
});

test('화면 파일에서 단계를 되찾는다 (화면이 스스로 넘어가도 레일이 따라간다)', () => {
  assert.strictEqual(F.stepOfFile('/im/fields.html?project=X').id, 'fields');
  assert.strictEqual(F.stepOfFile('intake.html').id, 'intake');
  assert.strictEqual(F.stepOfFile('membership.html'), null);
});

/* ───────────── 끼워 넣기 ───────────── */

test('★ 끼울 때 사이드바를 두 번 그리지 않는다', () => {
  ['.side', '.top'].forEach(sel => assert.ok(F.EMBED_CSS.includes(sel + '{display:none!important}'),
    `${sel} 을 감추지 않으면 앱 안에 사이드바가 두 벌 뜬다`));
  assert.match(F.EMBED_CSS, /overflow-y:hidden!important/, '안쪽 스크롤을 끄지 않으면 창 안을 또 끌게 된다');
  assert.ok(F.EMBED_CSS.includes('.steps{display:none!important}'),
    '셸이 레일을 그리는데 화면 안 단계 칩까지 두면 같은 표시가 두 번 뜬다');
  assert.match(F.EMBED_CSS, /height:auto!important/);
});

/* ───────────── 섹션 미리보기 (CLAUDE.md §8) ───────────── */

test('★ 문서를 심어도 화면이 통째로 비지 않는다', async () => {
  const html = await buildSection();
  const at = html.indexOf('window.LINKPILOT_PREVIEW_DOCS');
  assert.ok(at > 0, '단계 문서를 심는 블록이 없다');
  const end = html.indexOf('\n', html.indexOf('=', at));
  const line = html.slice(at, end);

  // ★ 이 셋 중 하나라도 날것으로 들어가면 브라우저가 스크립트 데이터 상태를
  //   바꿔 버려 블록 전체가 문법 오류가 된다. 오류는 콘솔에만 뜨고 화면은 빈다
  ['</script', '<script', '<!--'].forEach((needle) => {
    assert.ok(!line.includes(needle),
      `심는 문서에 '${needle}' 가 날것으로 들어갔다 — 화면이 통째로 빈다 (실제로 그랬다)`);
  });
  assert.match(line, /\\u003C/, '< 를 깨뜨리지 않았다');
});

test('★ 섹션 미리보기가 파일 하나로 열린다', async () => {
  const html = await buildSection();
  assert.ok(!/<script src=/.test(html), '외부 스크립트가 남으면 파일 하나로 안 열린다');
  assert.ok(!/<link[^>]+stylesheet/.test(html), '외부 스타일시트가 남았다');

  const open = (html.match(/<script\b/g) || []).length;
  const close = (html.match(/<\/script>/g) || []).length;
  assert.strictEqual(open, close, 'script 태그 짝이 안 맞는다 — 화면이 통째로 빈다');
});

test('미리보기임이 화면에 적혀 있다', async () => {
  const html = await buildSection();
  assert.match(html, /미리보기입니다/, '실물로 오해하면 이걸 근거로 판단한다');
  assert.match(html, /서버에 연결되어 있지 않습니다/);
  assert.match(html, /지어낸 것이 아닙니다/, '심은 값의 출처를 밝힌다');
});

test('★ 외부 분석 경로를 지우지 않았다', () => {
  const flow = read('report-flow.html');
  ['LinkPilot AGENT 저장소', '보고서 생성 AGENT 열기'].forEach((label) => {
    assert.ok(flow.includes(label), `${label} 이 사라졌다 — 지금 운영 중인 경로다`);
  });
  // 주소가 없을 때 눌리는 척하면 안 된다
  assert.match(flow, /b\.disabled = true/, '주소가 없으면 잠가야 한다');
});

test('미리보기에 내부 호스트가 들어가지 않는다', async () => {
  const html = await buildSection();
  assert.ok(!/\.ts\.net|synologynas|192\.168\./.test(html), '공개 저장소다');
});

test('★ 커밋된 section-preview.html 이 소스와 같다', async () => {
  const committed = read('section-preview.html');
  assert.strictEqual(await buildSection(), committed,
    '화면이나 단계가 바뀌었다 — `npm run im:section` 으로 다시 만들어라');
});

/**
 * ★★ **위 검사만으로는 부족하다.** 커밋된 산출물에 「빌드한 날」이 박히면
 *   위 검사는 **만든 그날은 통과하고 자정을 넘기는 순간 깨진다.**
 *   그러면 **코드를 하나도 안 고친 사람이 빨간 CI 를 받는다** — 원인이
 *   자기 변경에 있다고 믿고 한참 헤맨다.
 *
 *   2026-08-18 에 실제로 그랬다. 바뀐 줄은 딱 하나였다:
 *     `… · 2026-08-17 읽음 · sha256 c43506c113d3 · 사본 보관 안 함`
 *     `… · 2026-08-18 읽음 · sha256 c43506c113d3 · 사본 보관 안 함`
 *   다시 만들어 커밋해도 **다음 날 또 터진다.** 그래서 시각을 고정했고
 *   (`build-preview.js` 의 `DEMO_AT`), 여기서 그것이 유지되는지 본다.
 *
 * ★ 검사 시점이 중요하다 — 이 검사는 **시계를 넣은 그날** 실패한다.
 *   자정까지 기다렸다가 남의 변경에 붙어 터지지 않는다.
 */
test('★★ 미리보기 산출물에 「빌드한 날」이 박히지 않는다 (자정에 깨지는 검사)', async () => {
  const { kstStamp } = require('../core/kst');
  const today = kstStamp().slice(0, 10);
  const html = await buildSection();

  // [눈으로 확인] 패널만 본다 — 변경이력(changes.js)의 날짜는 **손으로 적은
  // 사실**이라 오늘과 같아도 정상이다. 실행 결과에 시계가 새는 것만 잡는다
  const panels = [...html.matchAll(/<pre class="ev__o">([\s\S]*?)<\/pre>/g)].map(m => m[1]);
  assert.ok(panels.length >= 4, `확인 패널을 못 찾았다 (${panels.length}개) — 선택자가 바뀌었나`);

  const leaked = panels.filter(p => p.includes(today));
  assert.deepStrictEqual(leaked, [],
    `확인 패널에 오늘 날짜(${today})가 들어갔다 — 이 파일은 커밋되므로 **내일 CI 가 깨진다.**\n`
    + '실행 결과를 손으로 적지 말고, 시각만 고정해서 부른다 (build-preview.js 의 DEMO_AT).');
});

test('빌드는 파일을 쓰지 않는다', async () => {
  const before = fs.readdirSync(PLATFORM).sort();
  await buildSection();
  assert.deepStrictEqual(fs.readdirSync(PLATFORM).sort(), before);
});

/* ───────────── 변경 내역 패널 ───────────── */
//
// 화면을 받은 사람이 **바뀐 줄도 모르고 옛 기준으로 보는 것**이 이 패널이 막는 일이다.

test('★ 변경 내역이 미리보기 창에 뜬다', async () => {
  const C = require('../ui/platform/changes.js');
  const html = await buildSection();

  assert.match(html, /이번에 바뀐 것/, '패널 자체가 없다');
  C.CHANGES.forEach((c) => {
    assert.ok(html.includes(c.title), `변경 '${c.title}' 이 화면에 안 뜬다`);
  });
  assert.ok(html.indexOf('이번에 바뀐 것') < html.indexOf('class="wrap"'),
    '화면보다 아래 있으면 스크롤하다 놓친다');
});

test('★ 한 일과 아직 안 된 것을 갈라 놓는다', async () => {
  const C = require('../ui/platform/changes.js');
  const html = await buildSection();

  assert.match(html, /아직 안 된 것/);
  C.PENDING.forEach((p) => {
    assert.ok(html.includes(p.title), `보류 '${p.title}' 이 안 뜬다`);
    assert.ok(html.includes(p.blocked.slice(0, 20)),
      '무엇이 막고 있는지 없으면 "곧 되겠지"로 읽힌다');
  });
  // 섞이면 이미 된 것으로 읽힌다
  assert.ok(html.indexOf('아직 안 된 것') > html.indexOf(C.CHANGES[0].title),
    '보류 항목이 변경 목록보다 앞에 있다');
});

test('내역마다 이유가 붙어 있다', () => {
  const C = require('../ui/platform/changes.js');
  C.CHANGES.forEach((c) => {
    assert.ok(c.why && c.why.length > 20,
      `'${c.title}' 에 이유가 없다 — 무엇이 달라지는지 없으면 목록이 쓸모없다`);
    assert.match(c.at, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(c.where, '어디가 바뀌었는지 없으면 찾아볼 수가 없다');
  });
});

/**
 * ★ "했습니다"만 적힌 목록은 확인할 방법이 없어 믿거나 말거나가 된다.
 *   화면에 안 보이는 작업이면 **안 보인다고 적는 것**도 답이다 —
 *   없는 것을 찾느라 헤매는 쪽이 더 나쁘다.
 */
test('★ 내역마다 어디를 보면 확인되는지 적혀 있다', async () => {
  const C = require('../ui/platform/changes.js');
  const html = await buildSection();
  C.CHANGES.forEach((c) => {
    assert.ok(c.shows && c.shows.length > 5, `'${c.title}' 에 확인할 곳이 없다`);
    assert.ok(html.includes(c.shows), `'${c.title}' 의 확인 위치가 화면에 안 뜬다`);
  });
});

/* ───────────── 눈으로 확인 패널 ───────────── */
//
// 파서·커넥터처럼 화면에 안 나오는 작업은 "됐습니다"라는 말밖에 남지 않는다.
// 받은 사람이 확인할 수단이 없으면 그 말은 아무 값어치가 없다.

test('★ 화면이 없는 작업도 결과를 눈으로 보여준다', async () => {
  const html = await buildSection();
  assert.match(html, /눈으로 확인/, '확인 패널이 없다');
  // 실제로 읽어 낸 글자가 들어 있어야 한다
  assert.ok(html.includes('12,345'), 'PDF 에서 읽은 글자가 안 보인다');
  assert.ok(html.includes('land.area_sqm = 12345'), '읽은 글자에서 뽑은 값이 안 보인다');
  assert.match(html, /텍스트 레이어가 없다/, '못 읽는 경우도 보여줘야 한다');
  assert.match(html, /바꿔서 올립니다|PDF 나 PNG/, '못 읽으면 무엇으로 바꿀지도 보여줘야 한다');
});

/**
 * ★ 이 패널의 값어치는 **실제로 돌린 결과라는 것** 하나다. 손으로 적으면
 *   코드가 바뀐 날부터 화면만 옛말을 하고, 그때는 아무도 눈치채지 못한다.
 */
test('★ 확인 패널의 결과를 손으로 적어 두지 않는다', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'build-preview.js'), 'utf8');
  assert.match(src, /ex\.toText\(/, '실제 파서를 돌려야 한다');
  assert.match(src, /ex\.extractFromLine\(/, '뽑은 값도 실제 추출 결과여야 한다');
  ['인천  남동', 'land.area_sqm = 12345', '텍스트 레이어가 없다'].forEach((t) => {
    assert.ok(!src.includes(t), `'${t}' 가 빌더에 박혀 있다 — 실행 결과가 아니라 적어 둔 글이다`);
  });
});

test('★ 확인 패널의 자료가 예시임을 화면에 적는다', async () => {
  const html = await buildSection();
  assert.match(html, /합성 예시/, '데모 자료를 실제로 오해하면 그것을 근거로 판단한다');
});

test('★ 내역을 화면 HTML 에 손으로 적지 않는다', () => {
  const C = require('../ui/platform/changes.js');
  const src = fs.readFileSync(path.join(PLATFORM, 'build-preview.js'), 'utf8');
  assert.match(src, /require\('\.\/changes\.js'\)/, '단일 출처를 읽어야 한다');
  C.CHANGES.forEach((c) => {
    assert.ok(!src.includes(c.title),
      `'${c.title}' 이 빌더에 복사돼 있다 — 두 벌이 되면 옛 내역을 보여주는 날이 온다`);
  });
});

test('★ 평문에 마크다운 표시를 남기지 않는다', () => {
  const C = require('../ui/platform/changes.js');
  // 화면에서는 글자 그대로 뜬다. 실제로 `**강조**` 가 별표째 나온 적이 있다
  [...C.CHANGES, ...C.PENDING].forEach((x) => {
    [x.title, x.why, x.blocked, x.where].filter(Boolean).forEach((v) => {
      assert.ok(!v.includes('**'), `'${v.slice(0, 24)}…' 에 ** 가 남아 있다`);
    });
  });
});

test('내역 문구가 태그로 해석되지 않는다', async () => {
  const html = await buildSection();
  // esc() 를 거치므로 꺾쇠가 살아 있으면 안 된다 (내역은 사람이 쓴 글이다)
  const at = html.indexOf('이번에 바뀐 것');
  const panel = html.slice(at, html.indexOf('</section>', at));
  assert.ok(!/<script|<img|onerror=/i.test(panel), '내역 문구가 이스케이프되지 않았다');
});

/* ───────────── 미리 그려 넣은 판 ───────────── */
//
// 평소 미리보기는 단계 화면을 브라우저에서 스크립트로 그린다. 보는 쪽에서
// 스크립트가 막히면 위쪽 패널만 뜨고 화면은 빈 칸이 된다 — 그때 쓰는 판이다.

test('★ 미리 그려 넣은 판은 스크립트를 걷어낸다', () => {
  const S = require('../ui/platform/build-static.js');
  const dom = '<html><head><style>a{}</style><script>var x=1;</script></head>'
    + '<body data-rendered-height="1234"><div onclick="go()">본문</div>'
    + '<script src="x.js"></script></body></html>';
  const out = S.stripScripts(dom);

  assert.ok(!/<script/i.test(out), '스크립트가 남으면 다시 돌면서 그린 화면을 지운다');
  assert.ok(!/onclick=/i.test(out), '인라인 핸들러도 걷어내야 한다');
  assert.match(out, /<style>a\{\}<\/style>/, 'CSS 까지 걷어내면 화면이 무너진다');
  assert.match(out, /본문/, '본문이 사라졌다');
});

test('★ 높이를 못 재면 잘라 내지 않고 넉넉히 준다', () => {
  const S = require('../ui/platform/build-static.js');
  assert.strictEqual(S.heightOf('<body data-rendered-height="1234">'), 1234);
  assert.ok(S.heightOf('<body>') >= 2000, '못 쟀을 때 150px 로 잘리면 화면이 없는 것과 같다');
  assert.ok(S.heightOf('<body data-rendered-height="999999">') <= 20000, '상한이 없으면 브라우저가 죽는다');
});

test('★ 두 미리보기가 같은 문서·같은 패널을 쓴다', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'build-static.js'), 'utf8');
  assert.match(src, /require\('\.\/build-preview\.js'\)/,
    '단계 문서를 따로 만들면 두 미리보기가 다른 화면을 보여주는 날이 온다');
  assert.match(src, /buildSectionDocs/);
  assert.match(src, /changePanel|evidencePanel/, '변경 내역·확인 패널도 한 벌만 쓴다');
});

test('★ 접힌 것을 펴고 그린다', () => {
  const S = require('../ui/platform/build-static.js');
  assert.match(S.EXPAND, /aria-expanded="false"/,
    '눌러 볼 수 없는 판인데 접힌 채로 그리면 목록이 영영 안 보인다');
});

test('★ 브라우저가 없으면 빈 파일을 내놓지 않는다', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'build-static.js'), 'utf8');
  assert.match(src, /process\.exit\(2\)/, '못 만들면 실패로 끝나야 한다');
  assert.match(src, /찾지 못했다/, '왜 못 만들었는지 말해야 한다');
});

/* ───────────── 주소로 여는 판 (아티팩트) ───────────── */
//
// 파일로 보내면 다운로드 카드로만 뜨는 환경이 있다. 그때는 한 문서로 이어 붙인
// 조각을 페이지로 올린다 — iframe 도 스크립트도 쓰지 못하는 곳을 전제한다.

test('★ 이어 붙일 때 화면의 CSS 를 그 칸 안에 가둔다', () => {
  const S = require('../ui/platform/build-static.js');
  const css = S.scopeCss('body{margin:0}.card{padding:2px}*{box-sizing:border-box}'
    + '@media (max-width:900px){.side{display:none}}'
    + '@keyframes spin{from{opacity:0}}', '#s');

  assert.match(css, /#s\{margin:0\}/, 'body 는 그 칸 자체가 되어야 한다');
  assert.match(css, /#s \.card/, '평범한 선택자는 칸 안으로 들어가야 한다');
  assert.match(css, /#s, #s \*/, '* 를 안 가두면 다른 칸까지 덮는다');
  assert.match(css, /@media \(max-width:900px\)\{#s \.side/, '미디어쿼리 안쪽도 가둬야 한다');
  assert.match(css, /@keyframes spin\{from\{opacity:0\}\}/, '@keyframes 는 건드리면 깨진다');
});

test('★ 붙인 화면이 화면 밖으로 떠오르지 않는다', () => {
  const S = require('../ui/platform/build-static.js');
  const part = S.inlineScreen('<html><head><style>.save{position:fixed}</style></head>'
    + '<body><div class="save">저장</div></body></html>', 'scr-x');
  assert.match(part.css, /#scr-x \.save\{position:static!important/,
    'position:fixed 는 한 문서에 모으면 다른 칸을 덮는다');
  assert.match(part.html, /id="scr-x"/);
  assert.ok(!/<script/i.test(part.html));
});

test('★ 앱에 끼운 모습으로 그린다', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'build-static.js'), 'utf8');
  assert.match(src, /FLOW\.EMBED_CSS/,
    '따로 열면 화면마다 사이드바·단계 칩이 있다 — 빼먹으면 실제 앱과 다른 그림을 보낸다');
  assert.match(src, /docs\[s\.id\] \+ EMBED/, '두 판 다 끼운 모습으로 그려야 한다');
});

/**
 * ★ 같은 실수를 네 번 했다 — 파일로 보내면 내려받기 카드로만 뜨는 환경에서
 *   파일만 다시 보냈다. 주소로 여는 조각은 조건을 어기면 **빈 화면**이 되고,
 *   빈 화면은 무엇이 잘못됐는지 아무 말도 해 주지 않는다. 그래서 올리기 전에 막는다.
 */
test('★ 올릴 수 없는 조각을 올리기 전에 막는다', () => {
  const S = require('../ui/platform/build-static.js');
  assert.deepStrictEqual(S.publishable('<title>이름</title><div>본문</div>'), []);

  const cases = [
    ['<!doctype html><title>a</title>', /doctype/],
    ['<title>a</title><body>x</body>', /<body>/],
    ['<title>a</title><script>x</script>', /script/],
    ['<title>a</title><iframe srcdoc="x"></iframe>', /iframe/],
    ['<title>a</title><img src="https://x/y.png">', /바깥 주소/],
    ['<div>제목이 없다</div>', /title/],
  ];
  cases.forEach(([frag, re]) => {
    const bad = S.publishable(frag);
    assert.ok(bad.length, `${frag.slice(0, 30)} 를 통과시켰다`);
    assert.ok(bad.some(b => re.test(b)), `사유가 안 맞는다: ${bad.join(' / ')}`);
  });
});

test('★ 내역마다 전과 후가 나란히 적혀 있다', async () => {
  const C = require('../ui/platform/changes.js');
  const html = await buildSection();
  C.CHANGES.forEach((c) => {
    // 한쪽만 있으면 나아진 크기를 알 수 없다 — "19종을 읽는다"는 전이 몇이었는지 없으면 뜻이 없다
    assert.ok(c.was && c.was.length > 5, `'${c.title}' 에 전(前)이 없다`);
    assert.ok(c.now && c.now.length > 5, `'${c.title}' 에 후(後)가 없다`);
    assert.notStrictEqual(c.was, c.now, `'${c.title}' 의 전과 후가 같다`);
    assert.ok(html.includes(c.was), `'${c.title}' 의 전(前)이 화면에 안 뜬다`);
    assert.ok(html.includes(c.now), `'${c.title}' 의 후(後)가 화면에 안 뜬다`);
  });
});

/**
 * ★ 실제로 겪은 사고 — 문서 끝에 덧붙인 스타일은 브라우저가 body 안에 넣는다.
 *   본문만 꺼내 오면 **가두지 않은 사본**이 딸려 오고, 그 안의
 *   `body{overflow-y:hidden}` 이 바깥 페이지의 스크롤을 잠근다.
 *   화면은 멀쩡히 보이는데 아래로 내려가지지 않는다 — 고장으로 읽힌다.
 */
test('★ 붙인 화면이 바깥 페이지의 스크롤을 잠그지 않는다', () => {
  const S = require('../ui/platform/build-static.js');
  const part = S.inlineScreen(
    '<html><head><style>.a{color:red}</style></head>'
    + '<body><div class="a">본문</div><style>body{overflow-y:hidden!important}</style></body></html>',
    'scr-x');
  assert.ok(!/<style/i.test(part.html), '본문에 가두지 않은 스타일 사본이 남았다');
  assert.ok(!/(^|\})\s*body\s*\{/.test(part.css), 'css 에 가두지 않은 body 규칙이 있다');
  assert.match(part.css, /#scr-x\{overflow-y:hidden!important\}/, '가둔 쪽에는 남아 있어야 한다');
  assert.ok(!/#scr-x\{position:relative;overflow:hidden;\}/.test(part.css),
    '칸 자체를 overflow:hidden 으로 두면 안쪽이 잘린다');
});

/* ───────────── 현황 대시보드 ───────────── */

/**
 * ★ 대시보드의 값어치는 **숫자가 지금 코드와 같다는 것** 하나다. 손으로 적으면
 *   코드가 바뀐 날부터 이 화면만 옛말을 하고, 그때는 아무도 눈치채지 못한다.
 */
test('★ 대시보드 숫자를 손으로 적지 않는다', () => {
  const D = require('../ui/platform/build-dashboard.js');
  const dict = require('../core/dictionary');
  const html = D.build();

  assert.ok(html.includes(String(Object.keys(dict.FIELDS).length)), '사전 항목 수가 안 보인다');
  assert.ok(html.includes(String(dict.COMPUTED_KEYS.length)), '계산 항목 수가 안 보인다');

  const src = fs.readFileSync(path.join(PLATFORM, 'build-dashboard.js'), 'utf8');
  assert.match(src, /Object\.keys\(dict\.FIELDS\)\.length/, '사전을 직접 세야 한다');
  assert.match(src, /readdirSync/, '파일 수를 직접 세야 한다');
  assert.ok(!/사전 6\d항목|커넥터 1\d개/.test(src), '숫자가 문장에 박혀 있다');
});

test('★ 미결정 등록부를 이모지로 세되 서로게이트에 속지 않는다', () => {
  const D = require('../ui/platform/build-dashboard.js');
  const p = D.pending();
  assert.ok(p.red > 0, '🔴 를 하나도 못 셌다 — 이모지 매칭이 깨졌다');
  assert.strictEqual(p.items.length, p.red, '센 개수와 목록이 다르다');
  p.items.forEach((i) => assert.match(i.id, /^D-\d+$/));

  // 주석은 뺀다 — 왜 그러면 안 되는지 **설명하는 문장**까지 잡으면
  // 설명을 지우게 된다. 잡으려는 것은 실제 코드다
  const src = fs.readFileSync(path.join(PLATFORM, 'build-dashboard.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(!/\[🔴🟠/.test(src),
    '이모지를 문자 집합으로 쓰면 u 플래그 없이는 서로게이트 반쪽들의 집합이 된다');
  assert.match(src, /gmu\)/, '유니코드 플래그 없이 이모지를 다루면 안 된다');
});

/**
 * ★ 두 작업선이 같은 번호를 서로 다른 뜻으로 쓰다가 병합에서 충돌했다
 *   (D-22·D-23·D-24·D-25 가 두 벌씩 — 2026-08-16 재번호로 해소).
 *   ID 가 겹치면 코드 주석·문서·커밋 메시지의 참조가 전부 모호해지고,
 *   같은 번호가 열린 항목이면서 결정 기록에도 있으면 어느 쪽이 참인지 알 수 없다.
 */
test('★ 미결정 등록부의 ID 는 유일하고, 건수는 손으로 적은 숫자가 아니다', () => {
  const text = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', '미결정-사항.md'), 'utf8');

  const heads = [...text.matchAll(/^### (\S+)\s+(D-\d+)\./gmu)];
  const ids = heads.map((h) => h[2]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepStrictEqual(dup, [], `같은 ID 가 두 번 등록되었다: ${dup.join(', ')}`);

  // 열린(✅ 아닌) 항목은 범위 외·결정 기록 표에 있으면 안 된다
  const tabled = new Set([...text.matchAll(/^\| (D-\d+) \|/gm)].map((m) => m[1]));
  heads.filter((h) => h[1].indexOf('✅') !== 0).forEach((h) => {
    assert.ok(!tabled.has(h[2]), `${h[2]} 가 열린 항목이면서 표에도 있다`);
  });

  // 머리의 건수는 세어서 맞춘다 — 손으로 적은 숫자는 코드가 바뀐 날부터 옛말이 된다
  const head = text.match(/미결정 \*\*(\d+)건\*\* · 범위 외 (\d+)건 · 결정 (\d+)건/);
  assert.ok(head, '머리에 건수 줄이 없다');
  const open = heads.filter((h) => h[1].indexOf('✅') !== 0).length;
  assert.strictEqual(open, Number(head[1]), '미결정 건수가 실제 항목 수와 다르다');
  const decSec = text.slice(text.indexOf('## 결정 기록'));
  const decided = [...decSec.matchAll(/^\| (D-\d+) \|/gm)].length;
  assert.strictEqual(decided, Number(head[3]), '결정 건수가 결정 기록 표와 다르다');
});

test('★ 대시보드도 그대로 올릴 수 있어야 한다', () => {
  const D = require('../ui/platform/build-dashboard.js');
  const S = require('../ui/platform/build-static.js');
  assert.deepStrictEqual(S.publishable(D.build()), []);
});

test('★ 한 것과 아직 안 된 것을 대시보드에서도 가른다', () => {
  const D = require('../ui/platform/build-dashboard.js');
  const html = D.build();
  const done = html.indexOf('규모');
  const todo = html.indexOf('지금 막혀 있는 것');
  assert.ok(done !== -1 && todo !== -1 && done < todo,
    '막힌 것이 위에 오면 다 된 것처럼 읽히거나 반대로 읽힌다');
});

/* ───────────── 인수인계서 ───────────── */

/**
 * ★ 인수인계서는 **받는 사람이 그대로 믿고 붙이는 문서**다. 숫자가 코드와
 *   어긋나면 "커넥터가 9개라던데 13개네" 하고 문서 전체를 안 믿게 된다.
 *   문서는 산문이라 자동 생성하지 않는다 — 대신 **핵심 숫자만 대조**한다.
 */
test('★ 인수인계서의 숫자가 코드와 같다', () => {
  const dict = require('../core/dictionary');
  const doc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', '인수인계서-플랫폼-연동.md'), 'utf8');

  const counts = {
    'agents': fs.readdirSync(path.join(__dirname, '..', 'agents')).length,
    'connectors': fs.readdirSync(path.join(__dirname, '..', 'connectors')).length,
    'core': fs.readdirSync(path.join(__dirname, '..', 'core')).length,
  };

  assert.ok(doc.includes(`| 파이프라인 Agent | ${counts.agents} |`), 'Agent 수가 다르다');
  assert.ok(doc.includes(`| 공공데이터 커넥터 | ${counts.connectors} |`), '커넥터 수가 다르다');
  assert.ok(doc.includes(`| 코어 모듈 | ${counts.core} |`), '코어 모듈 수가 다르다');
  assert.ok(doc.includes(`| 사전 항목 | ${Object.keys(dict.FIELDS).length} |`), '사전 항목 수가 다르다');
  assert.ok(doc.includes(`계산 전용 ${dict.COMPUTED_KEYS.length}개`), '계산 항목 수가 다르다');
});

test('★ 인수인계서가 붙이는 데 필요한 것을 빠뜨리지 않는다', () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', '인수인계서-플랫폼-연동.md'), 'utf8');

  // 이 셋이 없으면 받는 쪽이 붙일 수 없다
  assert.match(doc, /runningFor/, '이걸 빠뜨리면 생성 중 값 저장 금지가 조용히 꺼진다');
  assert.match(doc, /LINKPILOT_REPORT_FLOW/, '화면 설정 블록이 없다');
  assert.match(doc, /IM_AGENT_ROOT/, '필수 환경변수가 없다');

  // 환경변수는 .env.example 과 같아야 한다 — 문서만 옛말을 하면 키가 빠진 채 뜬다
  const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8');
  (env.match(/^[A-Z][A-Z0-9_]*=/gm) || []).forEach((line) => {
    const name = line.slice(0, -1);
    assert.ok(doc.includes(name), `.env.example 의 ${name} 이 인수인계서에 없다`);
  });
});
