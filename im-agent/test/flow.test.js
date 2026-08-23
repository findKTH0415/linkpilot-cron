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

/** 변경내역 패널의 머리말. 문자열만으로 찾으면 배너의 안내문이 먼저 걸린다 */
const PANEL_HEAD = '<h2 class="upd__t">이번에 바뀐 것</h2>';

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
  /* ★ 앞의 셋(제작 기본정보·무엇을·관련자료)은 **프로젝트를 만들기 전에 채우는
     칸**이다. 잠기면 프로젝트를 만들 길이 없어져 사용자가 갇힌다 */
  [0, 1, 2].forEach((i) => assert.strictEqual(noProject[i].locked, false,
    `${i + 1}단계는 프로젝트 없이도 열려야 한다`));
  [3, 4].forEach((i) => {
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
  assert.strictEqual(F.urlFor(F.STEPS[0], ctx), '/im/intake.html?part=issuer',
    '1단계는 프로젝트가 없다 — 대신 어느 칸을 펼지가 붙는다');
  assert.strictEqual(F.urlFor(F.STEPS[3], ctx), '/im/fields.html?project=LP-DC-2026-001');
  assert.strictEqual(F.urlFor(F.STEPS[3], { projectId: null }), 'fields.html');

  /* ★★ **앞의 셋이 서로 다른 주소여야 한다** 〈2026-08-22〉. 같으면 번호만 다른
     같은 화면이 되고, 2단계를 눌러도 1단계가 그대로 보인다 */
  const three = [0, 1, 2].map(i => F.urlFor(F.STEPS[i], ctx));
  assert.strictEqual(new Set(three).size, 3, `앞의 셋 주소가 겹친다: ${three.join(' · ')}`);
});

test('화면 파일에서 단계를 되찾는다 (화면이 스스로 넘어가도 레일이 따라간다)', () => {
  assert.strictEqual(F.stepOfFile('/im/fields.html?project=X').id, 'fields');
  /* ★★★ **물음표 뒤로 가른다** 〈2026-08-23 · 실제로 여기서 튕겼다〉.
   *   앞의 셋은 같은 파일이고 `?part=` 로만 갈린다. 파일 이름만 보면 늘 첫째가
   *   나와서, 2단계를 눌러도 **1단계로 되돌리며 다시 그린다** — 누른 사람에게는
   *   눌러도 안 열리는 화면으로 보인다. */
  assert.strictEqual(F.stepOfFile('intake.html?part=ask&api=x').id, 'ask');
  assert.strictEqual(F.stepOfFile('/im/intake.html?api=x&part=files').id, 'sources');
  assert.strictEqual(F.stepOfFile('intake.html?part=issuer').id, 'basics');

  /* ★ 못 가르면 **아무거나 고르지 않는다** (§4.9). 틀린 단계로 되돌리는 것보다
     「모르겠다」가 낫다 — 부르는 쪽이 그대로 둔다 */
  assert.strictEqual(F.stepOfFile('intake.html'), null,
    'part 가 없는데 첫 칸을 골랐다 — 그 짐작이 2·3단계를 튕겨냈다');
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

/**
 * ★★ **「외부 분석 환경」 카드는 지웠다** 〈2026-08-22 사용자 지시〉.
 *
 *   앞 판의 이 검사는 「지우지 않았다」를 지켰다 — 운영 중인 경로였기 때문이다.
 *   사용자가 지우라고 했으므로 **검사를 뒤집는다.** 지운 자리에 아무 검사도 안
 *   두면 다음 사람이 **반쯤 되살려** 놓고도 아무 데도 안 걸린다.
 *
 *   ★ 없앤 것은 **이 화면의 카드**다. 같은 일을 하는 「외부 분석 AGENT 로 만들기
 *     — 기반정보 내보내기」는 **앱 껍데기**에 있고 이 저장소에는 없다 — 그래서
 *     여기서는 잴 수 없다. 그쪽까지 없어졌는지는 앱에서 눈으로 본다.
 *   ★ 설정(`external.repoUrl`·`agentUrl`)은 **남긴다.** 앱이 채워 넣는 칸이라
 *     지우면 앱 쪽에서 「모르는 설정」이 된다.
 */
test('★★ 외부 분석 환경 카드를 반쯤 되살려 놓지 않았다', () => {
  const flow = read('report-flow.html');
  const live = flow.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '');

  ['외부 분석 환경', 'LinkPilot AGENT 저장소', '보고서 생성 AGENT 열기', 'ext__b']
    .forEach((k) => {
      assert.ok(live.indexOf(k) === -1,
        `「${k}」 가 화면에 남아 있다 — 카드를 지웠으면 그 조각도 함께 지운다`);
    });

  /* ★ 설정 칸은 그대로 있어야 한다 — 앱이 채워 넣는 자리다 */
  assert.match(flow, /external: \{/, 'external 설정 칸까지 지웠다 — 앱이 모르는 설정이 된다');
});

test('미리보기에 내부 호스트가 들어가지 않는다', async () => {
  const html = await buildSection();
  assert.ok(!/\.ts\.net|synologynas|192\.168\./.test(html), '공개 저장소다');
});

/**
 * ★ 실패 메시지가 **원인을 잘못 짚고 있었다** 〈2026-08-21〉.
 *   「화면이나 단계가 바뀌었다」고만 말했는데, 실제로 두 번 연속 터진 원인은
 *   **모듈이 늘어난 것**이었다 (미리보기의 [눈으로 확인] 패널이 모듈 수를
 *   빌드할 때 실제로 세어 넣는다 — §8). 화면도 단계도 안 건드린 사람이
 *   「내가 뭘 바꿨지」 하고 엉뚱한 데를 뒤진다. **원인 후보를 다 적는다.**
 */
test('★ 커밋된 section-preview.html 이 소스와 같다', async () => {
  const committed = read('section-preview.html');
  assert.strictEqual(await buildSection(), committed,
    '미리보기가 소스와 다르다 — `npm run im:section` 으로 다시 만들어 커밋한다.\n'
    + '  흔한 원인: ① 화면·단계를 고쳤다  ② **모듈(.js)을 새로 넣었다** — '
    + '[눈으로 확인] 패널이 모듈 수를 빌드할 때 실제로 세므로 파일 하나만 늘어도 달라진다');
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
  // ★★ **화면이 위, 변경내역이 아래다** (2026-08-18 사용자 결정으로 뒤집었다).
  //   전에는 반대였다 — 「스크롤하다 놓친다」는 이유로 변경내역을 화면 위에 뒀는데,
  //   확인 패널 다섯까지 위에 쌓이면서 **보러 온 화면이 한참 아래**로 밀렸다.
  //   미리보기를 여는 이유는 「무엇이 바뀌었나」보다 「어떻게 생겼나」인 쪽이 많다.
  //
  // ★ 대신 **놓치지 않게 위에서 가리킨다.** 아래로 내리기만 하고 말을 안 하면
  //   원래 걱정하던 일이 그대로 일어난다 — 그래서 둘을 함께 검사한다.
  // ★ **패널 머리말에 정확히 건다.** 그냥 문자열로 찾으면 위쪽 배너의 안내문
  //   (「이번에 바뀐 것」…은 아래에 있습니다)이 먼저 걸려 순서를 거꾸로 읽는다
  const panelAt = html.indexOf(PANEL_HEAD);
  assert.ok(panelAt > 0, '변경내역 패널 머리말을 못 찾았다 — 마크업이 바뀌었나');
  assert.ok(html.indexOf('class="wrap"') < panelAt,
    '화면이 변경내역보다 아래에 있다 — 보러 온 것이 화면인데 스크롤해야 나온다');
  assert.ok(html.indexOf('「이번에 바뀐 것」과 「눈으로 확인」 패널은 이 화면 아래에 있습니다')
    < html.indexOf('class="wrap"'),
    '아래에 있다는 안내가 화면 위에 없다 — 내려 두기만 하면 아무도 안 본다');
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
  // 배너의 안내문이 아니라 **패널 자체**를 본다 (위 검사와 같은 이유)
  const at = html.indexOf(PANEL_HEAD);
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

/* ═════════ 절 다섯 — 화면의 뼈대 (2026-08-22) ═════════ */

/**
 * ★★ **진행률(live-core)은 레일보다 성기게 센다** 〈2026-08-22 — 단계 다섯〉.
 *
 *   레일은 다섯 칸인데 진행률은 넷이다. 앞의 셋은 **한 번의 「만들기」로 함께**
 *   서버에 가므로 서버가 가진 것으로는 갈라 셀 수가 없다.
 *
 *   ★ 그래서 **같은지**가 아니라 **덮는지**를 잰다. 레일에 칸이 늘었는데
 *     live-core 가 모르면 그 칸은 **진행률에서 통째로 빠진 채** 아무 오류도
 *     안 난다 — 화면은 멀쩡하고 숫자만 조용히 틀린다.
 */
test('★★ 진행률이 레일의 칸을 하나도 빠뜨리지 않는다', () => {
  const L = require('../ui/platform/live-core.js');

  const covered = L.STEPS.flatMap(s => s.covers || []);
  assert.deepStrictEqual([...covered].sort(), F.STEPS.map(s => s.id).sort(),
    'live-core 가 덮는 칸이 레일과 다르다 — 빠진 칸은 진행률에서 사라진다');
  assert.strictEqual(new Set(covered).size, covered.length,
    '한 칸을 두 곳에서 세고 있다 — 합계가 조용히 부풀어 오른다');

  /* ★ 한 칸만 덮는 것은 **이름이 같아야 한다.** 다르면 같은 것을 두 이름으로
     부르게 되고, 어느 쪽이 진짜인지 화면만 봐서는 모른다 */
  L.STEPS.filter(s => (s.covers || []).length === 1).forEach((ls) => {
    const rail = F.STEPS.filter(f => f.id === ls.covers[0])[0];
    assert.strictEqual(ls.label, rail.name,
      `「${ls.covers[0]}」 이름이 진행률과 레일에서 다르다`);
  });

  /* ★ 레일에 없는 칸은 「생성」 하나뿐이다 — 진행률에만 있는 칸이 늘면
     사용자는 레일에서 그것을 찾다가 못 찾는다 */
  assert.deepStrictEqual(L.STEPS.filter(s => !(s.covers || []).length).map(s => s.id), ['make']);
});

/**
 * ★★ **단계 화면의 칩도 같은 이름을 쓴다.** 사본은 갈린다 — 이 저장소는
 *   색(`--lime-deep` 세 값)에서 한 번 겪었다.
 *
 *   ★ `intake.html` 은 **칩을 손으로 적지 않는다** 〈2026-08-22〉. 앞 판은 넷을
 *     박아 두었는데 단계가 다섯이 된 날 그 줄만 옛말이 됐고, 오류는 안 났다.
 *     이제 `flow-core.js` 를 읽는다 — 그래서 여기서는 **읽는지**를 잰다.
 */
test('★★ 단계 이름을 화면이 베껴 쓰지 않는다', () => {
  const fs2 = require('fs');
  const p2 = require('path');
  const PLATFORM = p2.join(__dirname, '..', 'ui', 'platform');

  const intake = fs2.readFileSync(p2.join(PLATFORM, 'intake.html'), 'utf8');
  assert.match(intake, /F\.STEPS\.forEach/,
    'intake.html 이 레일을 flow-core 에서 읽지 않는다 — 사본은 갈린다');
  F.STEPS.forEach((st) => {
    assert.ok(intake.indexOf("'" + st.name + "'") === -1,
      `intake.html 이 「${st.name}」 을 직접 적고 있다`);
  });

  /* ★ `reports.html` 은 아직 제 목록을 갖는다(코어를 안 싣는다). 그래서
     **레일에 있는 만큼은 글자 그대로 같은지** 잰다 */
  const rep = fs2.readFileSync(p2.join(PLATFORM, 'reports.html'), 'utf8');
  const m = rep.match(/\[('[^']*',\s*)+'[^']*'\]\.forEach\(function \(label, i\)/);
  assert.ok(m, 'reports.html 에서 단계 칩 배열을 못 찾았다 — 대조가 불가능해졌다');
  const labels = [...m[0].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.ok(labels.length >= F.STEPS.length, `reports.html 의 단계 칩이 모자라다`);
  F.STEPS.forEach((st, i) => assert.strictEqual(labels[i], st.name,
    `reports.html 의 ${i + 1}번 칩이 정본과 다르다`));
});

/**
 * ★★ **절은 다섯이고 순서가 고정이다** 〈2026-08-22 사용자 지시〉.
 *   ① 제작 기본정보 입력 ② 무엇을 만들까요? ③ 관련자료 업로드
 *   ④ 가이드 필드 ⑤ 출력조건
 *
 * ★ 「새보고서 진행률」 절을 뺐다. 그것이 ①이던 앞 판은 **절 번호와 단계
 *   번호가 하나씩 어긋나** 「1단계」라는 말이 어느 칸을 가리키는지 흐렸다.
 */
test('★★ 절 다섯 — 순서·이름·품은 단계가 고정되어 있다', () => {
  assert.deepStrictEqual(F.SECTIONS.map(s => `${s.no}. ${s.name}`), [
    '1. 제작 기본정보 입력',
    '2. 무엇을 만들까요?',
    '3. 관련자료 업로드',
    '4. 가이드 필드 (자동입력 + 직접입력)',
    '5. 출력조건',
  ]);
  /* ★★ **절 번호와 단계 번호가 같다.** 어긋나면 잠금 사유·안내 문구가 가리키는
     칸이 화면에서 한 칸씩 밀린다 */
  assert.deepStrictEqual(F.SECTIONS.map(s => s.no), F.STEPS.map(s => s.no));
  /* ★ ④ 는 `spec` 하나를 품는다 〈2026-08-22 — 단계는 셋〉. 확정 뒤의 「생성」은
     같은 화면의 다른 상태일 뿐 **옮겨 갈 칸이 아니다.** 칸으로 두었더니
     「3을 끝내고 4로 넘어간다」로 읽혔다. */
  assert.deepStrictEqual(F.SECTIONS.map(s => s.steps),
    [['basics'], ['ask'], ['sources'], ['fields'], ['spec']]);
  // 모든 단계가 **정확히 한 절**에만 속한다 (빠진 단계도, 두 번 실린 단계도 없다)
  const owned = F.SECTIONS.flatMap(s => s.steps).sort();
  assert.deepStrictEqual(owned, F.STEPS.map(s => s.id).sort(),
    '어느 절에도 안 속한 단계가 있거나, 두 절에 실린 단계가 있다');
  F.SECTIONS.forEach((s, i) => assert.strictEqual(s.no, i + 1, '번호가 이어지지 않는다'));
});

test('★ 절 상태 — 잠긴 이유는 그 절이 품은 단계에서 나온다', () => {
  // 서버가 없으면 전부 잠긴다
  const none = F.sectionState({ api: null, projectId: null });
  assert.deepStrictEqual(none.map(s => s.locked), [true, true, true, true, true]);
  assert.match(none[0].why, /서버/, '잠긴 이유를 안 적으면 고장으로 읽힌다');

  // 프로젝트가 없으면 앞의 셋만 열린다 — 거기서 프로젝트를 만든다
  const fresh = F.sectionState({ api: '/x', projectId: null });
  assert.deepStrictEqual(fresh.map(s => s.locked), [false, false, false, true, true]);
  assert.match(fresh[3].why, /프로젝트/);

  // 다 열리면 「지금」이 하나뿐이다 — 둘이면 어디를 보는지 알 수 없다
  const open = F.sectionState({ api: '/x', projectId: 'LP-DC-2026-001', current: 'spec' });
  assert.deepStrictEqual(open.map(s => s.locked), [false, false, false, false, false]);
  assert.strictEqual(open.filter(s => s.current).length, 1);
  assert.strictEqual(open[4].current, true, '출력조건이 지금 절이어야 한다');
  assert.strictEqual(open[4].opensTo, 'spec');
});


/**
 * ★★★ **자기 자신을 안에 또 띄우지 않는다** 〈2026-08-23 · 실제로 그렇게 떴다〉.
 *
 *   1단계 칸 안에 `report-flow.html` 통째가 들어가 절 목록이 두 겹으로 겹쳐
 *   보였다. 겹쳐 보이는 것도 나쁘지만 **더 나쁜 것은 원인이 안 보이는 것**이다
 *   — 어느 쪽이 바깥인지조차 알 수 없어 무엇을 고칠지 판단할 근거가 화면에
 *   남지 않는다.
 */
test('★★★ 단계 칸이 자기 화면을 가리키면 띄우지 않고 그렇다고 적는다', () => {
  const flow = read('report-flow.html');

  assert.match(flow, /이 화면 자신을 가리킨다/, '겹칠 때 아무 말도 안 한다');
  assert.match(flow, /window\.location\.pathname/, '지금 화면이 무엇인지 안 본다');

  /* ★ 물음표 뒤로 가르면 안 된다 — 같은 파일도 `?part=` 때문에 달라 보인다 */
  assert.match(flow, /split\('\?'\)\[0\]/, '물음표 뒤까지 넣어 비교한다 — 같은 파일을 다르게 본다');

  /* ★★ 〈2026-08-23 사장님 지시〉 단계 칸의 머리줄을 지웠다 — 바로 위 절 카드가
     같은 말을 하고 있어 제목이 두 줄 연달아 나왔다. 부르는 화면 이름은 iframe 의
     title 에 남긴다. 물음표 뒤는 넣지 않는다 — 열쇠가 섞인다 (§2) */
  assert.ok(flow.indexOf('stage__bar') === -1, '머리줄이 되살아났다 — 같은 제목이 두 줄이다');
  const t = /fr\.title = step\.no \+ '\. ' \+ step\.name \+ ' \(' \+ (\w+) \+ '\)';/.exec(flow);
  assert.ok(t, '부르는 화면 이름을 어디에도 안 남긴다');
  assert.strictEqual(t[1], 'want', `title 에 ${t[1]} 를 넣는다 — api 키가 새어 나갈 수 있다`);
});

/**
 * ★★★ **레일을 되짚는 쪽도 물음표 뒤를 넘겨야 한다** 〈2026-08-23〉.
 *   `stepOfFile` 만 고치고 부르는 쪽이 경로만 넘기면 아무것도 안 달라진다 —
 *   실제로 그렇게 되어 있었다.
 */
test('★★★ 화면 감시가 주소의 물음표 뒤까지 넘긴다', () => {
  const flow = read('report-flow.html');
  const m = /F\.stepOfFile\(([^)]*)\)/.exec(flow);
  assert.ok(m, 'stepOfFile 을 부르는 자리를 못 찾았다');
  assert.match(m[1], /loc\.search/,
    '경로만 넘긴다 — 앞의 셋이 같은 파일이라 늘 첫 칸으로 판정돼 2·3단계가 튕긴다');
});

/**
 * ★★★ **칸을 나눴으면 나가는 곳도 있어야 한다** 〈2026-08-23 · 사장님 지적〉.
 *
 *   1·2단계를 나눠 놓고 단추는 3단계에만 두었다. 그래서 발행 주체를 적고 나면
 *   **화면에 아무것도 없었다** — 저장이 된 건지, 다음이 어디인지 알 수가 없다.
 */
test('★★★ 1·2단계에 다음으로 가는 단추가 있다', () => {
  const intake = read('intake.html');

  assert.match(intake, /function partNav\(\)/, '칸 사이를 옮기는 단추가 없다');
  assert.match(intake, /'다음 — '/, '다음 단추 문구가 없다');
  assert.match(intake, /'이전 — '/, '이전 단추 문구가 없다');
  assert.match(intake, /body\.appendChild\(nav\)/, '만들어 놓고 화면에 안 붙인다');

  /* ★★ **「저장」이라고 적지 않는다.** 이 단계에서 서버로 가는 것은 없다 —
     3단계에서 함께 간다. 단추 이름이 하는 일과 달라지는 것이 가장 비싼 거짓말이다 */
  const nav = intake.slice(intake.indexOf('function partNav()'), intake.indexOf('function actionsRow()'));
  assert.ok(nav.indexOf('저장') === -1,
    '이 단계 단추에 「저장」이 들어갔다 — 서버에 넣은 줄 알고 창을 닫는다');

  /* ★ 앱 안에서는 부모에게 알린다. 안쪽만 옮기면 바깥 레일과 갈린다 */
  assert.match(intake, /lp-flow-step/, '부모에게 단계 이동을 안 알린다');
  const flow = read('report-flow.html');
  assert.match(flow, /lp-flow-step/, '부모가 그 알림을 안 받는다 — 한쪽만 있으면 갈린다');
  assert.match(flow, /known && known\.id !== state\.current/,
    '모르는 단계 이름을 걸러내지 않는다');
});

/** ★ 칸의 앞뒤는 `flow-core` 차례 그대로여야 한다 — 화면이 따로 정하면 갈린다 */
test('★ 칸의 앞뒤 차례가 단계 차례와 같다', () => {
  const parts = F.STEPS.filter(s => s.file === 'intake.html');
  assert.deepStrictEqual(parts.map(s => s.part), ['issuer', 'ask', 'files']);
  assert.deepStrictEqual(parts.map(s => s.no), [1, 2, 3], '앞의 셋이 이어져 있지 않다');
});

/**
 * ★★★ **머리 글자가 지금 보는 칸을 말한다** 〈2026-08-23 사장님 지시〉.
 *
 *   앞 판은 「보고서 생성 입력 / 무엇을 만들지 적고…」가 박혀 있었다. 칸이 셋이
 *   되면서 **어느 칸을 보든 같은 머리**가 떴고, 바로 아래 카드가 제 이름을 또
 *   달아 **같은 자리에 제목이 둘**이었다.
 */
test('★★★ 머리 글자가 칸을 따라가고, 제목이 두 번 나오지 않는다', () => {
  const intake = read('intake.html');

  /* ① 머리를 정적으로 박아 두지 않는다 */
  assert.match(intake, /id="head-t"><\/h1>/, '머리 제목이 아직 박혀 있다');
  assert.ok(intake.indexOf('<h1 class="head__t">보고서 생성 입력</h1>') === -1,
    '옛 머리가 남아 있다 — 어느 칸을 보든 같은 말을 한다');

  /* ② 칸 셋의 머리 글자가 한 곳에 모여 있다 */
  assert.match(intake, /var HEADS = \{/, '칸별 머리 글자가 없다');
  ['issuer:', 'ask:', 'files:'].forEach((k) => assert.match(intake, new RegExp(k),
    `HEADS 에 「${k}」 가 없다`));

  /* ③ ★ 카드가 같은 문장을 **베껴 쓰지 않는다.** 두 벌이면 한쪽만 고치는 날
     머리와 본문이 다른 말을 한다 */
  const code = intake.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  ['발행 주체', '무엇을 만들까요'].forEach((t) => {
    const hits = (code.match(new RegExp(`'${t}'`, 'g')) || []).length;
    assert.strictEqual(hits, 1, `「${t}」 가 ${hits}곳에 적혀 있다 — HEADS 한 곳이어야 한다`);
  });

  /* ④ 머리로 올라간 칸은 카드에서 제 이름을 뗀다 */
  assert.match(intake, /function cardHead\(/, '카드 제목을 가려 붙이는 자리가 없다');
  assert.match(intake, /if \(PART && PART === part\) return box;/,
    '머리에 있는데 카드에도 또 붙인다');
});

/* ═════════ 완료·진행율 표기 〈2026-08-23 사장님 지시〉 ═════════ */

/**
 * ★★★ 사장님 지시 그대로:
 *     1 제작 기본정보 입력 → [완료] · 2 무엇을 만들까요? → [완료]
 *     3 관련자료 업로드 → 진행율 + [완료] · 4 가이드 필드 → 진행율 + [완료]
 *     5 출력조건 → [완료]
 *
 * ★ 여기서 지키는 것은 **표기가 아니라 정직함**이다. 「완료」는 잰 결과라야
 *   하고, **못 쟀으면 아무 말도 안 해야 한다.** 0% 로 적으면 다 해 놓은 사람이
 *   「아직 아무것도 안 했다」를 보고 처음부터 다시 한다 (§4.9).
 */
test('★★★ 못 쟀으면 완료도 진행율도 말하지 않는다', () => {
  const F = require('../ui/platform/flow-core.js');
  const p = F.sectionProgress({});          // 아무것도 못 쟀다

  assert.strictEqual(p.basics.known, false, '발행 주체를 못 쟀는데 안다고 한다');
  assert.strictEqual(p.basics.done, false, '못 쟀는데 완료라고 한다');
  assert.strictEqual(p.basics.pct, null, '못 쟀는데 숫자를 적었다 — 0% 는 「안 했다」로 읽힌다');
  assert.strictEqual(p.fields.known, false, '필드를 못 쟀는데 안다고 한다');
  assert.strictEqual(p.fields.pct, null, '필드를 못 쟀는데 숫자를 적었다');
  assert.strictEqual(p.output.known, false, '출력조건을 못 쟀는데 안다고 한다');
});

test('★★★ 다섯 절이 각자 맞는 표기를 낸다 (완료 / 진행율)', () => {
  const F = require('../ui/platform/flow-core.js');
  const p = F.sectionProgress({
    issuerSet: true, projectId: 'LP-DC-2026-001',
    sources: { total: 5, read: 3 }, fields: { filled: 7, total: 10 }, specLocked: true,
  });

  assert.strictEqual(p.basics.done, true, '① 발행 주체를 정했는데 완료가 아니다');
  assert.strictEqual(p.ask.done, true, '② 프로젝트가 있으면 요청문은 이미 받은 것이다');
  assert.strictEqual(p.sources.done, true, '③ 프로젝트를 만들었는데 완료가 아니다');
  assert.strictEqual(p.sources.pct, 60, `③ 5건 중 3건이면 60% 여야 한다 (${p.sources.pct})`);
  assert.strictEqual(p.fields.done, false, '④ 7/10 인데 완료라고 한다');
  assert.strictEqual(p.fields.pct, 70, `④ 7/10 이면 70% 여야 한다 (${p.fields.pct})`);
  assert.strictEqual(p.output.done, true, '⑤ 확정했는데 완료가 아니다');

  /* ★ 진행율은 **셋과 넷에만** 있다. 나머지는 중간이 없다 —
     없는 중간을 지어내면 뜻 없는 숫자가 돈다 */
  assert.strictEqual(p.basics.pct, null, '①에 없는 진행율을 지어냈다');
  assert.strictEqual(p.ask.pct, null, '②에 없는 진행율을 지어냈다');
  assert.strictEqual(p.output.pct, null, '⑤에 없는 진행율을 지어냈다');

  /* ★ 숫자만 있으면 무엇의 60% 인지 모른다 — 잰 사실을 함께 낸다 */
  assert.match(p.sources.detail, /5건 중 3건/, '③ 무엇을 셌는지 안 적었다');
  assert.match(p.fields.detail, /10개 중 7개/, '④ 무엇을 셌는지 안 적었다');
  assert.match(p.fields.detail, /출처/, '④ 출처가 있어야 센다는 규칙을 안 알려 준다');
});

test('★★ 자료가 0건인 것을 0% 로 적지 않는다', () => {
  const F = require('../ui/platform/flow-core.js');
  const p = F.sectionProgress({ projectId: 'LP-1', sources: { total: 0, read: 0 } });
  /* 자료 없이도 진행은 된다(값을 직접 넣는 길). 0% 로 적으면 막힌 것으로 읽힌다 */
  assert.strictEqual(p.sources.pct, null, '자료 0건을 0% 로 적었다 — 막힌 것으로 읽힌다');
  assert.strictEqual(p.sources.done, true, '프로젝트가 있으면 이 칸은 지나온 것이다');
  assert.match(p.sources.detail, /직접/, '자료 없이 갈 때 무엇을 해야 하는지 안 알려 준다');
});

test('★★ 화면이 완료·진행율을 실제로 그린다 (규칙은 flow-core 한 곳)', () => {
  const html = fs.readFileSync(path.join(PLATFORM, 'report-flow.html'), 'utf8');

  /* ★ 판정을 화면이 다시 적지 않는다 — 두 벌이 되면 한쪽만 고치는 날이 온다 */
  assert.match(html, /F\.sectionProgress\(/, '화면이 판정을 flow-core 에서 안 가져온다');
  assert.match(html, /'완료'/, '완료 표기가 없다');
  assert.match(html, /sec__bar/, '진행율 막대가 없다');

  /* ★ 재는 값은 **서버에 물어본 것**이라야 한다. 손으로 적으면 코드가 바뀐 날부터
     화면만 옛말을 하고 아무도 눈치채지 못한다 (§8) */
  assert.match(html, /\/intake/, '발행 주체를 안 물어본다');
  assert.match(html, /\/spec/, '출력조건 확정 여부를 안 물어본다');
  assert.match(html, /completeness\(/, '필드 채움을 fields-core 로 안 센다');
  assert.match(html, /fields-core\.js/, 'fields-core 를 안 싣는다 — 부르면 죽는다');

  /* ★★ 처음 값은 전부 null 이어야 한다. false/0 으로 시작하면 대답이 오기 전
     한순간 「아무것도 안 했다」가 뜨고, 다 해 놓은 사람이 그것을 본다 */
  const init = /var facts = \{([^}]*)\}/.exec(html);
  assert.ok(init, 'facts 초기값을 못 찾았다');
  assert.ok(!/:\s*(false|0)\b/.test(init[1]),
    `잰 적 없는 값을 false/0 으로 시작했다 — 「못 쟀다」가 「안 했다」로 보인다: ${init[1]}`);
});
