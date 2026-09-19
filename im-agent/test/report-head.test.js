'use strict';
/**
 * report-head.test.js — **보고서 생성 화면의 머리는 이 화면이 단다** 〈2026-08-30 · D-200〉.
 *
 * ★★★ 왜 있나. 같은 일을 하는 자리가 둘이었다 — 앱이 사진 배너를 그리고, 이 화면은
 *   `inTab` 이면 제목을 안 그렸다. 그 둘이 어긋나 **배너가 두 벌로 보이고 사이가 떴다.**
 *   사장님 지시로 앱 쪽 배너를 지웠는데, 그 순간 이 화면의 `if (!C.inTab)` 한 줄이
 *   **앱 안에서 이름을 지우는 줄**이 되었다 — 오류는 안 나고 이름만 사라진다.
 *
 * ★ 그래서 세 가지를 잰다: ① 조건 없이 그리는가 ② 이름을 여기 옮겨 적지 않았는가
 *   ③ 앱이 얹을 때 덮어쓰는 규칙이 이 머리를 감추지 않는가.
 *
 * ★★ **주석을 떼고 본다** (CLAUDE.md §8 — 경위를 잘 적어 둘수록 검사가 눈이 먼다).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const P = path.join(__dirname, '..', 'ui', 'platform');
const RAW = fs.readFileSync(path.join(P, 'report-flow.html'), 'utf8');

/* 주석(블록·줄·HTML)을 떼어 낸 「진짜 코드」만 남긴다 */
const CODE = RAW
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ');

test('★★★ 머리를 조건 없이 그린다 — `inTab` 이 이름을 지우지 않는다', () => {
  assert.ok(/view\.appendChild\(hd\)/.test(CODE),
    '머리를 그리는 줄이 없다 — 앱 안에서 **이름 없는 화면**이 된다');
  assert.ok(!/if\s*\(\s*!\s*C\.inTab\s*\)\s*view\.appendChild/.test(CODE),
    '`inTab` 이면 제목을 안 그리는 줄이 살아 있다 — 앱은 이제 배너를 안 그린다 (D-200)');
});

/* ★★ **재는 자리를 옮겼다** 〈2026-09-14〉 — 재려던 성질은 그대로다.
 *   배너 조립이 `flow-core` 의 `headEl` 한 곳으로 들어갔다(세 화면이 같은 얼굴을 쓰려면
 *   그래야 한다). 그러니 이 화면에 `F.SECTION.title` 이라는 **글자**는 더 없다 —
 *   앞 판의 검사는 그 글자를 찾고 있었다. **성질은 「이름을 옮겨 적지 않는가」**이고
 *   그것은 지금 더 강하게 참이다. 그래서 **양쪽을 다 본다**: 화면이 공유 배너를 부르는가,
 *   그리고 그 배너가 값에서 이름을 읽는가 (§6-2-5 「약하게 고치는 것과 자리를 옮기는 것」). */
test('★★ 이름은 한 곳에서만 읽는다 — 화면에 글자로 옮겨 적지 않는다', () => {
  const F = require(path.join(P, 'flow-core.js'));
  assert.ok(/F\.headEl\(\s*F\.SECTION/.test(CODE),
    '화면이 공유 배너(`flow-core` 의 headEl)를 안 부른다 — 화면마다 따로 조립하면 한 곳만 고쳐진다');
  const CORE = fs.readFileSync(path.join(P, 'flow-core.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  assert.ok(/sec\.title/.test(CORE),
    '공유 배너가 제목을 값에서 안 읽는다 — 글자로 박으면 SECTION 을 고쳐도 안 따라온다');
  /* ★ **`flow-core` 에는 그 글자가 «있어야» 맞다** — 거기가 단일 출처다.
     처음에 양쪽 다 없는지 봤는데 그것은 검사가 틀린 것이었다. 여기서 없어야 하는 곳은
     **화면**이고, `flow-core` 는 「값에서 읽는가」로 본다(위 `sec.title`). */
  assert.ok(!CODE.includes("'" + F.SECTION.title + "'"),
    '제목 글자가 화면 코드에 박혀 있다 — SECTION 을 고쳐도 여기가 안 따라온다');
});

/* ★★★ **그림이 실제로 들어오는가** 〈2026-09-14 사장님 지시: 「배너를 일관성있게
 *   이미지넣어 만들어줘」〉.
 *
 * ★ **「그림이라는 낱말이 있는가」는 아무것도 안 재는 것이다** (§12 와 같은 결).
 *   **돌려서** 잰다 — 배너를 실제로 만들어 `background-image` 에 그림이 있는지 본다.
 * ★★ **자리마다 달라야 한다.** 셋이 같은 그림이면 「일관성」이 아니라 그냥 한 장이다.
 * ★★★ **남의 사진을 안 쓴다** — 바깥 주소를 물면 §6-2-6(공식 API·출처 표기)에 걸리고
 *   미리보기의 자체 완결도 깨진다 (§8). data URI 인지까지 센다. */
test('★★★ 배너에 그림이 들어간다 — 자리마다 다르고, 바깥 주소를 안 문다', () => {
  const F = require(path.join(P, 'flow-core.js'));
  const ids = ['make', 'done', 'files'];
  const urls = ids.map((id) => F.heroSvg(id));
  for (let i = 0; i < ids.length; i++) {
    assert.ok(/^data:image\/svg\+xml/.test(urls[i]),
      ids[i] + ' 의 그림이 data URI 가 아니다 — 바깥 주소를 물면 자체 완결이 깨진다 (§8)');
    assert.ok(urls[i].length > 400, ids[i] + ' 의 그림이 너무 짧다 — 사실상 빈 그림이다');
  }
  assert.strictEqual(new Set(urls).size, ids.length,
    '자리 셋이 같은 그림을 쓴다 — 「일관성있게」는 «같은 얼굴»이지 «같은 한 장»이 아니다');

  /* 실제로 조립해 본다 — 값이 있어도 배너에 안 실리면 화면에는 안 나온다 */
  const made = [];
  const doc = {
    createElement: (t) => {
      const n = { tag: t, style: {}, className: '', children: [], attrs: {},
        appendChild(c) { this.children.push(c); },
        setAttribute(k, v) { this.attrs[k] = v; } };
      made.push(n); return n;
    },
  };
  for (const sec of [F.SECTION, F.OUTPUTS_SECTION, F.FILES_SECTION]) {
    const hd = F.headEl(sec, doc);
    assert.ok(hd, sec.id + ' 의 배너를 못 만들었다 — 머리 없는 화면은 이름 없는 틀이 된다');
    const bg = hd.style.backgroundImage || '';
    assert.ok(bg.includes('data:image/svg+xml'),
      sec.id + ' 배너에 그림이 안 실렸다 — 그림을 만드는 것과 «싣는» 것은 다른 사실이다');
    assert.ok(/linear-gradient/.test(bg) && bg.indexOf('linear-gradient') < bg.indexOf('url('),
      sec.id + ' 배너에 스크림이 없거나 그림 뒤에 있다 — 흰 제목이 그림 위에 얹혀 안 읽힌다 (§6-1-2)');
    assert.strictEqual(hd.children[0].textContent, sec.title,
      sec.id + ' 배너의 제목이 그 자리의 이름이 아니다');
  }
});

test('★ 앱이 얹을 때 덮어쓰는 규칙이 이 머리를 감추지 않는다', () => {
  const F = require(path.join(P, 'flow-core.js'));
  const css = F.EMBED_CSS;
  assert.ok(/\.side\{display:none/.test(css.replace(/\s/g, '')),
    '재려는 규칙 자체가 사라졌다 — 표본이 거짓말을 하면 잡히는 것도 거짓이다 (M-30)');
  assert.ok(!/\.head\s*\{[^}]*display:\s*none/.test(css),
    '앱이 얹을 때 머리를 감춘다 — **앱 안에서만 조용히 사라진다**');
  /* 모양도 있어야 한다 — 클래스만 있고 규칙이 없으면 줄이 안 보인다.
     ★ **재는 자리를 옮겼다** 〈2026-09-14〉: 규칙이 `flow-core` 의 HEAD_CSS 한 벌로
       모였다(세 화면이 복사하지 않게). 그래서 화면 파일이 아니라 **심어지는 것**을 본다 —
       재려던 성질(「규칙이 실제로 있는가」)은 그대로이고, 이제 **심는 것까지** 잰다. */
  assert.ok(/\.head\s*\{/.test(F.HEAD_CSS) && /\.head__d\s*\{/.test(F.HEAD_CSS),
    '`.head` · `.head__d` 모양 규칙이 HEAD_CSS 에 없다');
  const styles = [];
  const doc = {
    head: { appendChild: (n) => styles.push(n) },
    querySelector: () => null,
    createElement: () => ({ style: {}, children: [], attrs: {}, textContent: '',
      appendChild(c) { this.children.push(c); }, setAttribute(k, v) { this.attrs[k] = v; } }),
  };
  F.headEl(F.SECTION, doc);
  assert.ok(styles.some((n) => /\.head\s*\{/.test(n.textContent || '')),
    '배너를 만들어도 모양 규칙이 안 심어진다 — 「있다」와 「심어진다」는 다른 사실이다');
});

/* ★★★ **세 화면이 같은 배너를 쓰는가** 〈2026-09-14 사장님 지시: 「배너를 «일관성있게»」〉.
 *
 * ★ **이것이 사장님이 보신 것의 본체였다** 〈실측〉 — 배너가 report-flow 에만 있고
 *   「완성 보고서」·「자료 업로드」에는 **아예 없었다**. 한 앱인데 자리를 옮기면 얼굴이 바뀐다.
 * ★★ 그 두 화면은 `if (!C.inTab)` / `if (!embedded)` 로 **앱 안에서만** 이름을 지우고
 *   있었다 — D-200 이 report-flow 에서 고친 바로 그 줄인데 **옆 화면에 안 댔다**.
 *   그래서 「그리는가」가 아니라 **「조건 없이 그리는가」**를 잰다. */
test('★★★ 세 화면이 같은 배너를 쓴다 — 자리를 옮겨도 얼굴이 안 바뀐다', () => {
  const strip = (t) => t.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  const screens = [
    ['report-flow.html', 'F.SECTION'],
    ['outputs.html', 'F.OUTPUTS_SECTION'],
    ['files.html', 'F.FILES_SECTION'],
  ];
  for (const [file, sec] of screens) {
    const code = strip(fs.readFileSync(path.join(P, file), 'utf8'));
    assert.ok(code.includes('F.headEl(' + sec + ', document, C.hero)'),
      file + ' 이 공유 배너를 안 부른다 — 화면마다 얼굴이 달라진다');
    assert.ok(!/if\s*\(\s*!\s*(C\.inTab|embedded)\s*\)\s*view\.appendChild\(el\('h1'/.test(code),
      file + ' 이 앱 안에서 이름을 지우는 줄을 아직 갖고 있다 — 앱은 이제 배너를 안 그린다 (D-200 · S-39)');
  }
});

/* ★★★ **앱이 그림을 넘기면 그것이 이긴다** 〈2026-09-14 사장님 지시: 「배너 이미지
 *   만들어줘 · 다른 섹션과 동일하게」〉.
 *   앱의 다른 섹션 배너는 앱이 가진 **한 생성기**로 그린다. 여기서 따로 그리면 얼굴이
 *   다르다 — 그래서 **앱이 넘겨 준 것을 쓴다**(생성기를 베끼면 두 벌이 된다 · §8-1).
 * ★ 다만 **바깥 주소는 안 받는다** — 받으면 남의 사진을 출처 없이 싣는 길이 열린다 (§6-2-6).
 * ★★ 안 넘어오면 **우리 그림**으로 간다 — 빈 배너로 두면 미리보기가 제품과 달라진다 (§8). */
test('★★★ 앱이 넘긴 그림이 이긴다 — 다만 바깥 주소는 안 받는다', () => {
  const F = require(path.join(P, 'flow-core.js'));
  const appPic = 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E';
  assert.strictEqual(F.heroFrom(F.SECTION, appPic), appPic,
    '앱이 넘긴 그림을 안 쓴다 — 다른 섹션과 얼굴이 달라진다');
  assert.strictEqual(F.heroFrom(F.SECTION, ''), F.heroSvg('make'),
    '안 넘어왔는데 우리 그림으로 안 간다 — 배너가 빈다');
  for (const bad of ['https://images.unsplash.com/photo-1', 'http://x/y.jpg', 'javascript:1', '//cdn/x.png']) {
    assert.strictEqual(F.heroFrom(F.SECTION, bad), F.heroSvg('make'),
      '바깥 주소(' + bad + ')를 그대로 받는다 — 남의 사진을 출처 없이 싣는 길이 열린다 (§6-2-6)');
  }
  /* 세 화면이 실제로 넘기는가 — 계약을 만들어 놓고 «안 넘기면» 아무 일도 안 일어난다 */
  for (const f of ['report-flow.html', 'outputs.html', 'files.html']) {
    assert.ok(/F\.headEl\([^)]*,\s*document,\s*C\.hero\)/.test(fs.readFileSync(path.join(P, f), 'utf8')),
      f + ' 이 앱이 넘긴 그림을 배너에 안 넘긴다 — 계약만 있고 안 쓰인다');
  }
});

/* ★★★ **배너 «크기»가 앱의 것과 같다** 〈2026-09-14 사장님 지시: 「플렛폼 배너와 크기가 다름 ·
 *   보고서생성 배너를 일관성 있게 동일하게 만들어줘」〉.
 * [무엇이었나] 앱의 `SectionHero` 는 170px, 이쪽은 120px 이었다. 앱 안에서 화면을 오가면
 *   **배너만 껑충거려** 같은 앱으로 안 읽힌다.
 * ★ 저쪽 값은 다른 저장소(`linkpilot-platform`)에 있어 여기서 직접 못 읽는다 — 그러니
 *   **못 읽는다고 적고**, 이쪽 값이 그 수(170)인지만 잰다 (§8 「못 잰 것을 통과로 안 적는다」).
 *   저쪽이 바뀌면 이 칸이 «자동으로» 알려 주지는 못한다. 그 사실을 여기 남긴다.
 * ★★ 모서리·아래 여백도 함께 본다 — 높이만 맞추고 모서리가 다르면 여전히 다른 배너다. */
test('★★★ 배너 크기가 앱 배너(SectionHero 170px)와 같다', () => {
  const F = require(path.join(P, 'flow-core.js'));
  const css = String(F.HEAD_CSS || '');
  assert.ok(css, 'HEAD_CSS 를 못 읽었다 — 이 칸은 아무것도 안 잰다');
  assert.match(css, /min-height:170px/,
    '배너 높이가 앱의 170px 과 다르다 — 화면을 오갈 때 배너만 껑충거린다');
  assert.match(css, /border-radius:16px/, '모서리가 앱(16px)과 다르다');
  assert.match(css, /margin:0 0 14px/, '아래 여백이 앱(marginBottom 14)과 다르다');
  assert.ok(!/min-height:120px/.test(css), '옛 값(120px)이 아직 남아 있다');
});
