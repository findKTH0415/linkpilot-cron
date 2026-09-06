#!/usr/bin/env node
'use strict';
/**
 * build-layouts.js — **반영된 디자인 레이아웃을 만든다**
 *
 *   npm run im:layouts
 *
 * 〈2026-09-06 사장님 지시 「반영된 디자인 레이아웃 구축해줘」 · CLAUDE.md §6-3〉
 *
 * ★★★ **무엇이 없었나.** 디자인은 데이터로 다 있었다 — 토큰·테마 13종·
 *   레이아웃 12종·규칙 12개. 그런데 **그것이 반영된 모습을 볼 자리가 없었다.**
 *   테마 갤러리(`im:themes`)는 **표지 색만** 보여 주고, 레이아웃은 코드를
 *   읽어야 알 수 있었다. 그래서 고르는 사람이 이름만 보고 골랐다.
 *
 * ★★ **세 벌을 한 번에 낸다 — 그리고 셋 다 손으로 안 쓴다.**
 *
 *   ① `im-agent/design/im-design-system.css` — 토큰이 CSS 가 된 것
 *   ② `im-agent/ui/platform/layout-system.html` — 눈으로 보는 견본 (파일 하나로 열린다)
 *   ③ `docs/IM_디자인시스템_적용규칙.md` — 사람이 읽는 규칙
 *
 *   셋 다 `design/tokens.js` · `themes.js` · `layouts.js` · `rules.json` 에서
 *   나온다. **옮겨 적은 값이 하나도 없다** — 두 벌이 되면 한쪽이 옛말을 하고,
 *   그 상태가 아무 오류도 안 낸다 (CLAUDE.md §8-1 · `design-system.test.js`
 *   가 잡아낸 `--lime-deep` 세 값이 그 사고였다).
 *
 * ★ **다시 만들었을 때 달라지면 `guard` 가 빨개진다** (교차검증 「미리보기
 *   재생성」 칸). 소스를 고치고 다시 안 만든 상태로는 배포가 안 나간다.
 *
 * ★ 시각은 `core/kst.js` 한 곳에서만 만든다 (CLAUDE.md §8).
 *   ★★ 다만 **견본에는 시각을 박지 않는다** — 박으면 돌릴 때마다 파일이
 *     달라져 위 「재생성」 칸이 **늘 빨갛다.** 지문 역할은 `build-stamp.js`
 *     가 이미 한다. 여기서는 **소스가 바뀔 때만** 결과가 바뀌어야 한다.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const DESIGN = path.join(__dirname, '..', '..', 'design');

const css = require(path.join(DESIGN, 'css.js'));
const specimen = require(path.join(DESIGN, 'specimen.js'));
const themes = require(path.join(DESIGN, 'themes.js'));
const layouts = require(path.join(DESIGN, 'layouts.js'));
const { COLOR, SIZE, PAGE, FONT, CAPTION_PREFIX } = require(path.join(DESIGN, 'tokens.js'));
const rules = require(path.join(DESIGN, 'rules.json'));

const OUT_CSS = path.join(DESIGN, 'im-design-system.css');
const OUT_HTML = path.join(__dirname, 'layout-system.html');
const OUT_DOC = path.join(ROOT, 'docs', 'IM_디자인시스템_적용규칙.md');

/** 견본에 박는 고정 문구 — 시각이 아니다 (머리말 ★ 참고) */
const STAMP = '생성물 · 손으로 고치지 않는다';

/* ─────────────────────────────────────────────────────────
 * 적용규칙 문서 — rules.json 과 모듈에서 만든다
 * ───────────────────────────────────────────────────────── */
function doc() {
  const L = layouts.LAYOUTS;
  const ids = Object.keys(L);
  const list = themes.list();
  const dec = specimen.decisions();

  const row = (cells) => `| ${cells.join(' | ')} |`;
  const head = (cells) => [row(cells), row(cells.map(() => '---'))].join('\n');

  return `# IM 디자인시스템 적용규칙

> **이 문서는 손으로 고치지 않는다.** \`npm run im:layouts\` 가
> \`im-agent/design/\` 의 \`tokens.js\` · \`themes.js\` · \`layouts.js\` ·
> \`rules.json\` 을 읽어 만든다. 값을 바꾸려면 그 네 곳을 고치고 다시 돌린다 —
> 여기를 직접 고치면 다음 생성 때 조용히 지워진다.
>
> 왜 이렇게 하나: 규칙을 두 벌로 두면 **한쪽이 옛말을 하고, 그 상태가 아무
> 오류도 안 낸다** (CLAUDE.md §8-1). 실제로 \`--lime-deep\` 이 세 값으로
> 갈려 있었고 아무도 몰랐다.

## 1. 무엇이 정해져 있나

${head(['항목', '수', '단일 소스'])}
${[
    ['레이아웃', ids.length, '`design/layouts.js`'],
    ['테마', list.length, '`design/themes.js`'],
    ['문체', Object.keys(themes.WRITING || {}).length, '`design/themes.js` WRITING'],
    ['정보 밀도', Object.keys(themes.DENSITY || {}).length, '`design/themes.js` DENSITY'],
    ['문서 종류', Object.keys(themes.DOC_PROFILE || {}).length, '`design/themes.js` DOC_PROFILE'],
    ['디자인 규칙', (rules.rules || []).length, '`design/rules.json`'],
  ].map((r) => row(r)).join('\n')}

지면은 ${PAGE.format} ${PAGE.widthMm}×${PAGE.heightMm}mm, 여백 ${PAGE.marginMm}mm 이다.

## 2. 레이아웃 ${ids.length}종

${head(['ID', '이름', '쓰는 자리', '필요한 자료'])}
${ids.map((id) => row([
    `\`${id}\``, L[id].label, L[id].use,
    L[id].needs.length ? L[id].needs.join(' · ') : '없음',
  ])).join('\n')}

## 3. 어떤 절이 어떤 레이아웃으로 가는가

아래 표는 **옮겨 적은 것이 아니라** \`layouts.pick()\` 을 실제로 돌린 결과다.
규칙을 고치면 이 표가 따라 바뀐다.

${head(['절의 내용', '고른 레이아웃', '고른 이유'])}
${dec.map((d) => row([d.what, `\`${d.id}\` ${d.label}`, d.reason])).join('\n')}

★ 위에 안 나오는 레이아웃(${ids.filter((id) => !dec.some((d) => d.id === id)).map((i) => `\`${i}\``).join(' · ') || '없음'})은
**자동 판정으로는 안 나온다.** 테마가 \`layouts\` 로 지정할 때만 쓰인다 —
없는 것을 있는 것처럼 적지 않는다.

## 4. 테마 ${list.length}종

${head(['ID', '이름', '쓰는 곳', '문체', '주색'])}
${list.map((t) => {
    const T = themes.get(t.id);
    return row([`\`${t.id}\``, t.label, T.labelKr || '—', T.writing || '—', `\`${T.primary}\``]);
  }).join('\n')}

테마가 바꾸는 것은 **팔레트·타이포·표지 형식·차트 색·강조 KPI·선호 레이아웃**뿐이다.
구조 토큰(지면 기하 · 괘선 두께 · 표 규격)은 **바꾸지 않는다** — 구조까지 테마마다
다르면 문서가 서로 다른 시스템처럼 보인다.

## 5. 바꾸지 않는 값

${head(['이름', '값', '쓰는 곳'])}
${[
    ['body', COLOR.body, '본문'],
    ['muted', COLOR.muted, '보조 설명'],
    ['faint', COLOR.faint, '캡션'],
    ['ruleStrong', COLOR.ruleStrong, '굵은 괘선'],
    ['ruleWeak', COLOR.ruleWeak, '가는 괘선'],
    ['negative', COLOR.negative, '음수 · 경고'],
    ['track', COLOR.track, '차트 트랙'],
  ].map(([k, v, u]) => row([`\`${k}\``, `\`${v}\``, u])).join('\n')}

## 6. 활자

- 제목 \`${FONT.serif}\`
- 본문 \`${FONT.sans}\`

★★ **두 번째 이름을 지우지 않는다.** \`Noto Sans KR\` 만 적으면 그 이름으로
설치된 기계에서만 맞고, 없는 기계에서는 브라우저가 **말없이 아무 CJK 글꼴로
대신 그린다.** 실측(2026-08-17, CI 와 같은 조건)에서 중국어 글꼴(WenQuanYi
Zen Hei)로 나갔다. CI 가 까는 \`fonts-noto-cjk\` 가 심는 이름은
**\`Noto Sans CJK KR\`** 이지 \`Noto Sans KR\` 이 아니다.

${head(['이름', '크기', '쓰는 곳'])}
${[
    ['h1', SIZE.h1, '표지 제목'], ['h2', SIZE.h2, '장 제목'],
    ['h2Small', SIZE.h2Small, '작은 장 제목'], ['h3', SIZE.h3, '절 제목'],
    ['body', SIZE.body, '본문'], ['table', SIZE.table, '표'],
    ['tableHead', SIZE.tableHead, '표 머리'], ['caption', SIZE.caption, '캡션'],
    ['micro', SIZE.micro, '각주 · 페이지번호'],
  ].map(([k, v, u]) => row([`\`${k}\``, `${v}px`, u])).join('\n')}

## 7. 규칙 ${(rules.rules || []).length}개

규칙의 단일 소스는 \`design/rules.json\` 이고, 게이트(\`design/check.js\`)와
이 문서가 **같은 파일**을 읽는다.

${head(['ID', '규칙', '적용', '등급', '왜'])}
${(rules.rules || []).map((r) => row([
    `\`${r.id}\``, r.label, r.applies, r.severity, r.why,
  ])).join('\n')}

## 8. 숫자 표기

- 금액은 원화 **억원 / 조원**, 음수는 **△**
- 캡션은 언제나 \`${CAPTION_PREFIX.trim()}\` 로 시작한다 — 출처 없는 표는 IM 에서 근거가 없는 것과 같다
- 숫자는 \`tabular-nums\` 로 자릿수를 맞춘다
- 표 셀은 한 줄로 두고, 폭이 모자라면 셀을 접는 대신 **표를 가로 스크롤**시킨다 (CLAUDE.md §6-3 ⑤)

## 9. 어디에 쓰나

${head(['자리', '무엇을 읽나'])}
${[
    ['A4 인쇄 산출물', '`design/a4.js` — 핸드오프 규격이라 **인라인 style** 로 간다 (rules.json D7)'],
    ['A4 밖 (견본 · 미리보기 · 화면에 얹는 조각)', '`design/im-design-system.css` — 이 도구가 만든다'],
    ['테마 고르는 화면', '`npm run im:themes` → `theme-gallery.html`'],
    ['레이아웃 견본', '`npm run im:layouts` → `layout-system.html`'],
  ].map((r) => row(r)).join('\n')}

★ 플랫폼 화면 토큰은 \`--lp-\` 이고 **다른 체계다** (브리핑 #C00000 / Arial).
IM 토큰은 \`--im-\` 을 쓴다 — 접두어가 같으면 한 화면에 둘이 섞였을 때
**어느 쪽이 이겼는지 알 수 없다.**
`;
}

/* ─────────────────────────────────────────────────────────
 * 쓰기
 * ───────────────────────────────────────────────────────── */
function build({ themeId = 'institutional' } = {}) {
  const written = [];

  const cssText = css.build(themeId);
  fs.writeFileSync(OUT_CSS, cssText, 'utf8');
  written.push([OUT_CSS, cssText.length]);

  const html = specimen.build({ themeId, stamp: STAMP });
  fs.writeFileSync(OUT_HTML, html, 'utf8');
  written.push([OUT_HTML, html.length]);

  const md = doc();
  fs.mkdirSync(path.dirname(OUT_DOC), { recursive: true });
  fs.writeFileSync(OUT_DOC, md, 'utf8');
  written.push([OUT_DOC, md.length]);

  return written;
}

if (require.main === module) {
  const written = build();
  const ids = Object.keys(layouts.LAYOUTS);
  console.log(`레이아웃 ${ids.length}종 · 테마 ${themes.list().length}종 · 규칙 ${(rules.rules || []).length}개를 반영했습니다.`);
  written.forEach(([f, n]) => {
    console.log(`  ${path.relative(ROOT, f)}  (${n.toLocaleString('ko-KR')}자)`);
  });
  console.log('세 파일 모두 생성물입니다 — 손으로 고치지 않습니다.');
}

module.exports = { build, doc, OUT_CSS, OUT_HTML, OUT_DOC, STAMP };
