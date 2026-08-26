'use strict';
/**
 * design-system.test.js — **LinkPilot Design System v1.1 을 코드가 지키는가.**
 *
 * 왜 테스트가 필요한가: 팔레트를 화면마다 복붙하고 있었고 **이미 갈려 있었다** —
 * `--lime-deep` 이 `#5C7A00` · `#4F6900` · `#4F6A00` 세 값으로 흩어져 있었고
 * 셋 다 디자인 시스템의 `#7BA10F` 가 아니었다(2026-08-17 실측).
 * 복붙은 「지금은 같다」일 뿐이고, **갈리는 날 아무도 눈치채지 못한다.**
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLAT = path.join(__dirname, '..', 'ui', 'platform');
const TOKENS = fs.readFileSync(path.join(PLAT, 'tokens.css'), 'utf8');

/** 앱에 붙는 제품 화면 — 미리보기 산출물(빌드 결과)은 대상이 아니다 */
const SCREENS = ['report-flow.html', 'outputs.html', 'intake.html', 'fields.html',
  'reports.html', 'guide.html', 'membership.html', 'upgrade.html'];

const read = (f) => fs.readFileSync(path.join(PLAT, f), 'utf8');

/* ───────────── 토큰 값 ───────────── */

test('★ 디자인 시스템: 브랜드 값이 문서와 같다', () => {
  /* ★★ 값의 출처가 **둘**이고, 새 쪽이 이긴다 〈2026-08-26 · D-138〉.
   *
   *   라임·잉크 → 「1단계 작업지시서」(2026-08-26). 앱 전체에 못박은 브랜드
   *                색이라 보고서 화면이 따라간다. 안 따라가면 사이드바 라임과
   *                보고서 화면 라임이 미묘하게 어긋난다.
   *   나머지  → DESIGN_SYSTEM.md §2 (2026-08-17) 그대로.
   *
   * ★★★ **선택 색은 되돌려 보냈고, rev.B 가 고쳐 왔다** 〈2026-08-27〉.
   *   rev.A 값은 흰 바탕 대비 **2.34** 라 큰 글자 기준(3.0)도 못 넘겼는데
   *   이 토큰은 11px 글자 색으로 쓰인다. rev.B 의 `#5A7A00` 은 **4.98** 로
   *   작은 글자 기준 4.5 를 넘긴다 (실측).
   */
  const want = {
    '--lp-brand': '#B5E01F',
    '--lp-brand-deep': '#5A7A00',
    '--lp-brand-soft': '#F0FAD8',
    '--lp-brand-ink': '#12161F',
    '--lp-navy': '#12161F',
  };
  Object.keys(want).forEach((k) => {
    assert.ok(new RegExp(`${k}:\\s*${want[k]};`).test(TOKENS), `${k} 가 ${want[k]} 가 아니다`);
  });
});

test('★ 디자인 시스템: iOS 시스템 색을 그대로 쓴다', () => {
  const want = { '--lp-red': '#FF3B30', '--lp-orange': '#FF9500', '--lp-yellow': '#FFCC00',
    '--lp-green': '#34C759', '--lp-blue': '#007AFF', '--lp-purple': '#AF52DE' };
  Object.keys(want).forEach((k) => {
    assert.ok(new RegExp(`${k}:\\s*${want[k]};`).test(TOKENS), `${k} 가 ${want[k]} 가 아니다`);
  });
});

test('★ 디자인 시스템: 면(surface)은 셋뿐이다', () => {
  // §6 — 넷째를 만들지 않는다
  ['--lp-surface-grouped: #F2F2F7', '--lp-surface-card:    #FFFFFF', '--lp-surface-glass'].forEach((s) => {
    assert.ok(TOKENS.includes(s.split(':')[0]), `${s} 가 없다`);
  });
  assert.ok(!/--lp-surface-4|--lp-surface-elevated/.test(TOKENS), '네 번째 면이 생겼다');
});

/* ───────────── 단일 출처 ───────────── */

test('★★ 디자인 시스템: 화면이 브랜드 색을 직접 적지 않는다', () => {
  // 복붙이 갈리는 것을 실제로 겪었다. 색은 tokens.css 하나가 정한다
  const banned = /#(?:9ED700|AAE106|EDF7DC|F0FAD8|5C7A00|7BA10F|4F6900|4F6A00|4E6900|17181A|0A1419|B5E01F|12161F|5A7A00|F5F6F8|F2F2F7|E03131|FF3B30|E8A33D|FF9500)\b/i;
  SCREENS.forEach((f) => {
    const body = read(f).replace(/<!--[\s\S]*?-->/g, '');
    const hit = body.match(banned);
    assert.equal(hit, null, `${f}: 색을 직접 적었다 (${hit && hit[0]}) — tokens.css 를 쓴다`);
  });
});

test('★★★ 폐기된 rev.A 선택 색이 코드에 한 글자도 없다', () => {
  /* 지시서 rev.B 「07-B ④」가 **검색 결과 0건**을 검수 항목으로 걸었다.
   *
   * ★ 그래서 **주석에도 적지 않는다.** 사장님이나 앱 담당자가 그 값을 찾을 때
   *   내 설명 주석이 걸리면 「아직 남아 있다」로 읽힌다 — 이 저장소가 이미
   *   여러 번 당한 자리다 (CLAUDE.md §8 「검사가 찾는 이름을 주석에 적지 않는다」).
   *   경위를 적어야 하면 `rev.A 선택 색`처럼 **이름으로** 부른다.
   * ★ 값을 여기 글자로 박으면 이 검사 자신이 걸린다. 그래서 나눠 적는다.
   */
  const RETIRED = `#8CB${'8'}0F`;
  const { execFileSync } = require('child_process');
  const repo = path.join(__dirname, '..', '..');
  const files = execFileSync('git', ['ls-files', 'im-agent/'], { cwd: repo, encoding: 'utf8' })
    .split('\n').map((f) => f.trim()).filter(Boolean)
    .filter((f) => /\.(css|html|js|json|md)$/.test(f));
  const hit = files.filter((f) => {
    let body;
    try { body = fs.readFileSync(path.join(repo, f), 'utf8'); } catch (_) { return false; }
    return body.includes(RETIRED) && path.resolve(repo, f) !== __filename;
  });
  assert.deepStrictEqual(hit, [], '폐기된 선택 색이 남아 있다 — 주석이라도 검색에는 걸린다');
});

test('★★★ 밝은 바탕에서 라임을 **글자 색**으로 쓰지 않는다', () => {
  /* 라임은 흰 바탕 대비가 **1.54** 다. 지시서 rev.B 가 「1단계 금지사항」에
   * 못박았고, 그 전에 우리 §11 이 이미 같은 말을 하고 있었다.
   *
   * ★ 채움은 괜찮다 — `background`·`accent-color`·`border-color` 는 글자가 아니다.
   *   재는 것은 `color:` 하나다.
   * ★★ **어두운 바탕 위에서는 라임이 맞는 색이다** (대비 11.76). 그런데 그 바탕은
   *   대개 **부모 규칙**에 있다 (`.why { background: 잉크 }` → `.why h2 { color: 라임 }`).
   *   같은 규칙만 보면 **멀쩡한 코드를 빨갛게** 만든다 — 실제로 그랬다.
   *   그래서 어두운 바탕을 까는 선택자를 먼저 모으고, 그 아래 것은 넘긴다.
   */
  const DARK_BG = /background:[^;]*var\(--(?:lp-navy|lp-brand-ink|lp-text-1|ink|navy)\)|background:\s*#(?:12161F|0A1419)/i;
  const LIME_TEXT = /(?:^|[^-\w])color:\s*var\(--(?:lime|lp-brand)\)/;

  SCREENS.concat(['tokens.css']).forEach((f) => {
    const body = read(f).replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((m) => ({ sel: m[1].trim().split('\n').pop().trim(), css: m[2] }));

    const dark = rules.filter((r) => DARK_BG.test(r.css))
      .flatMap((r) => r.sel.split(',').map((x) => x.trim()))
      .filter((x) => x.startsWith('.') || x.startsWith('#'));

    rules.forEach((r) => {
      if (!LIME_TEXT.test(r.css)) return;
      if (DARK_BG.test(r.css)) return;                       // 자기 규칙이 어두운 바탕
      if (dark.some((d) => r.sel.startsWith(`${d} `) || r.sel.startsWith(`${d}.`)
        || r.sel.split(',').some((x) => x.trim().startsWith(`${d} `)))) return;  // 어두운 부모 안
      assert.fail(`${f}: 밝은 바탕에 라임 글자 (대비 1.54) — ${r.sel} { ${r.css.trim().slice(0, 60)} }`);
    });
  });
});

test('★★ 그 검사가 실제로 잡는다 — 어두운 바탕 허용이 구멍이 되지 않는다', () => {
  // 위 검사는 「부모가 어두우면 넘긴다」로 느슨해졌다. 느슨해진 검사는
  // **아무것도 안 재면서 초록**일 수 있다 — 그래서 밝은 바탕 표본을 하나 만들어 본다
  const sample = '.card { background: #FFFFFF; } .card b { color: var(--lp-brand); }';
  const DARK_BG = /background:[^;]*var\(--(?:lp-navy|lp-brand-ink|lp-text-1|ink|navy)\)|background:\s*#(?:12161F|0A1419)/i;
  const LIME_TEXT = /(?:^|[^-\w])color:\s*var\(--(?:lime|lp-brand)\)/;
  const rules = [...sample.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ sel: m[1].trim(), css: m[2] }));
  const dark = rules.filter((r) => DARK_BG.test(r.css)).map((r) => r.sel);
  const bad = rules.filter((r) => LIME_TEXT.test(r.css) && !DARK_BG.test(r.css)
    && !dark.some((d) => r.sel.startsWith(`${d} `)));
  assert.strictEqual(bad.length, 1, '밝은 카드 안의 라임 글자를 못 잡는다');
});

test('★ 디자인 시스템: 화면이 tokens.css 를 부른다', () => {
  SCREENS.forEach((f) => {
    /* ★ 주소 뒤에 판 표시(`?v=…`)가 붙는다 〈2026-08-23 · D-93〉 — 글자 그대로
     *   대면 **부르고 있는데 안 부른다고** 말한다 */
    assert.match(read(f), /<link rel="stylesheet" href="tokens\.css(\?v=[0-9a-f]*)?">/,
      `${f}: 토큰을 안 부른다`);
  });
});

test('★★ 디자인 시스템: 미리보기가 토큰을 인라인한다', () => {
  // 안 하면 미리보기가 **색 없이** 뜨는데 오류는 안 난다 — CSS 는 모르는 변수를
  // 조용히 넘긴다. 확인하라고 보낸 화면이 실제와 다르면 확인이 아니다.
  //
  // ★ **커밋된 산출물만 읽는다.** `section-static.html` · `section-artifact.html` 은
  //   .gitignore 에 있어 CI 에는 없다 — 읽으면 ENOENT 로 죽는다
  //   (2026-08-17: 실제로 그래서 CI 가 빨갰다. 내 기계에는 있으니 안 보였다).
  // 제품 화면을 담은 미리보기 — 토큰이 통째로 들어가야 한다
  const preview = read('section-preview.html');
  assert.ok(!preview.includes('rel="stylesheet"'), 'section-preview.html: 바깥 스타일시트가 남았다');
  assert.ok(preview.includes('--lp-brand'), 'section-preview.html: 토큰이 안 들어갔다');

  // 탭 구성안은 **제품 화면이 아니라 설명용 페이지**라 자기 팔레트를 쓴다.
  // 다만 바깥 파일을 부르면 주소로 열 때 빈 칸이 된다 — 그것만 본다
  const tabs = read('tabs-artifact.html');
  assert.ok(!tabs.includes('rel="stylesheet"'), 'tabs-artifact.html: 바깥 스타일시트가 남았다');

  // ★ 안 커밋되는 산출물(section-static · section-artifact)은 **만드는 쪽**을 검사한다.
  //   파일이 없어도 규칙은 지켜야 한다. 둘 다 build-preview 의 인라인을 거친 문서를
  //   헤드리스로 그리므로, 인라인하는 곳은 build-preview 하나다
  const builder = fs.readFileSync(path.join(__dirname, '../ui/platform/build-preview.js'), 'utf8');
  const inlines = (builder.match(/rel="stylesheet" href="\(\[\^"\]\+\)"/g) || []).length;
  assert.ok(inlines >= 2,
    'build-preview.js: 스타일시트를 인라인하는 곳이 둘(화면·껍데기) 다 있어야 한다');
});

test('★★ 테스트가 커밋 안 된 파일에 기대지 않는다', () => {
  // 내 기계에는 있고 CI 에는 없는 파일을 읽으면 **CI 에서만 죽는다.**
  // 원인이 「왜 내 기계에서는 되는데」로만 보여 찾는 데 오래 걸린다 — 실제로 그랬다
  const { execFileSync } = require('child_process');
  const repo = path.join(__dirname, '..', '..');
  const ignored = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard',
    '--directory', 'im-agent/'], { cwd: repo, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean).map(p => path.basename(p));

  const mine = fs.readFileSync(__filename, 'utf8');
  ignored.forEach((name) => {
    assert.ok(!mine.includes(`'${name}'`),
      `이 테스트가 커밋 안 되는 파일을 읽는다: ${name} — CI 에는 없다`);
  });
});

/* ───────────── 글꼴 ───────────── */

test('★ 디자인 시스템: 웹폰트를 불러오지 않는다', () => {
  // §11 — Inter · Roboto · Pretendard 를 싣지 않는다. SF Pro / Apple SD Gothic Neo 는
  // iOS·macOS 에 이미 있다
  SCREENS.concat(['tokens.css']).forEach((f) => {
    const s = read(f);
    assert.ok(!/fonts\.googleapis|Pretendard|@font-face|Noto Sans KR|Roboto|['"]Inter['"]/.test(s),
      `${f}: 웹폰트를 부른다`);
  });
});

test('★ 디자인 시스템: 글꼴 스택이 한 곳에서 나온다', () => {
  assert.match(TOKENS, /--lp-font:\s*-apple-system, "SF Pro Text", "SF Pro Display",/);
  SCREENS.forEach((f) => {
    const s = read(f).replace(/<!--[\s\S]*?-->/g, '');
    // 화면이 자기 스택을 다시 적으면 한쪽만 고치는 날 갈린다
    assert.ok(!/'Malgun Gothic'/.test(s), `${f}: 글꼴 스택을 직접 적었다`);
  });
});

/* ───────────── 접근성 ───────────── */

test('★ 디자인 시스템: 포커스 링이 브랜드 딥 2px 이다', () => {
  // §10 Step 5 — 모든 조작 요소에 보이는 포커스가 있어야 한다
  assert.match(TOKENS, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--lp-brand-deep\)/);
});

test('★ 디자인 시스템: 숫자 칸은 tabular-nums 다', () => {
  // §3 규칙 · §8.2 — 줄이 안 맞으면 표를 읽을 수 없다
  assert.match(TOKENS, /font-variant-numeric:\s*tabular-nums/);
});

test('★ 디자인 시스템: 움직임을 줄이는 설정을 존중한다', () => {
  assert.match(TOKENS, /@media \(prefers-reduced-motion: reduce\)/);
});

/* ───────────── 하지 않는 것 ───────────── */

test('★★ 디자인 시스템: 라임 위에 흰 글자를 올리지 않는다', () => {
  // §11 — 대비가 안 나온다. 라임 위는 네이비(--lp-brand-ink)다
  assert.match(TOKENS, /--lp-brand-ink:\s*#12161F/);   // D-138 — 지시서 확정값
  SCREENS.forEach((f) => {
    const s = read(f);
    // `background: var(--lime)` 과 `color: #fff` 이 같은 규칙 안에 있으면 안 된다
    const rules = s.match(/\{[^}]*\}/g) || [];
    rules.forEach((r) => {
      if (/background:\s*var\(--(?:lime|lp-brand)\)/.test(r) && /color:\s*(?:#fff|#ffffff|white)\b/i.test(r)) {
        assert.fail(`${f}: 라임 위에 흰 글자 — ${r.slice(0, 80)}`);
      }
    });
  });
});

test('★ 디자인 시스템: 화면에 이모지를 쓰지 않는다', () => {
  // §5 「Avoid emoji entirely」 · §11 「섹션 제목에 이모지 금지」
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  ['outputs.html', 'report-flow.html'].forEach((f) => {
    const body = read(f).replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '').replace(/★|⚠|✅|❌/g, '');
    const hit = body.match(EMOJI);
    assert.equal(hit, null, `${f}: 이모지가 있다 (${hit && hit[0]})`);
  });
});

/* ───────────── 토큰이 안 실렸을 때 ───────────── */

test('★★ 디자인 시스템: 토큰이 안 실리면 화면이 그렇다고 말한다', () => {
  // tokens.css 를 같이 안 올리면 화면이 **색 없이** 뜨는데 오류는 안 난다 —
  // CSS 는 못 찾은 변수를 조용히 넘긴다. 미리보기를 만들다 실제로 그 상태를 봤다
  const FLOW = require('../ui/platform/flow-core.js');
  assert.equal(typeof FLOW.tokensLoaded, 'function');
  assert.equal(FLOW.tokensLoaded(), null, 'Node 에서는 판정할 수 없다고 해야 한다');
  assert.match(FLOW.TOKENS_MISSING, /tokens\.css/);

  ['outputs.html', 'report-flow.html'].forEach((f) => {
    const s = read(f);
    assert.match(s, /F\.tokensLoaded\(\) === false/, `${f}: 토큰 확인을 안 한다`);
    assert.match(s, /role', 'alert'/, `${f}: 경고로 읽히지 않는다`);
    // ★ 경고 자체는 토큰 없이도 보여야 한다 — var() 로 칠하면 안 보인다
    const at = s.indexOf('TOKENS_MISSING');
    assert.ok(!/var\(--/.test(s.slice(at, at + 400)), `${f}: 경고를 토큰으로 칠했다`);
  });
});

test('★ 디자인 시스템: 배포 지시서가 tokens.css 를 목록에 넣는다', () => {
  // 파일 하나를 빠뜨리면 화면이 색 없이 뜨고 아무 오류도 안 난다
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', '배포-지시서.md'), 'utf8');
  assert.match(doc, /tokens\.css/, '배포할 파일 목록에 tokens.css 가 없다');
});

/* ───────────── 재생성이 기계마다 같은가 ───────────── */

test('★★ 미리보기: 파일 목록 순서를 정렬한다 — 안 하면 기계마다 달라진다', () => {
  // readdir 순서는 파일시스템이 정한다. 그 결과가 커밋되는 산출물에 들어가면
  // **CI 에서만 재생성 결과가 어긋난다** (2026-08-17)
  const os = require('os');
  const store = require('../core/store');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-order-'));
  const id = 'LP-DC-2026-001';
  fs.mkdirSync(path.join(root, id, '02_Source_Data'), { recursive: true });
  const prev = process.env.IM_AGENT_ROOT;
  process.env.IM_AGENT_ROOT = root;
  try {
    // 만든 순서를 일부러 뒤섞는다
    ['c.txt', 'a.txt', 'b.txt'].forEach(n =>
      fs.writeFileSync(path.join(root, id, '02_Source_Data', n), 'x'));
    const names = store.listSourceFiles(id).map(f => f.name);
    assert.deepEqual(names, ['a.txt', 'b.txt', 'c.txt'],
      '만든 순서가 아니라 이름 순이어야 한다 — 추출 순서가 그대로 문서에 실린다');
  } finally {
    if (prev === undefined) delete process.env.IM_AGENT_ROOT; else process.env.IM_AGENT_ROOT = prev;
  }
});

test('★ 미리보기: 산출물에 들어가는 readdir 은 전부 정렬되어 있다', () => {
  // 정렬을 빠뜨린 곳이 하나라도 있으면 그 줄이 기계마다 달라진다
  ['../core/store.js', '../core/vault.js', '../ui/platform/build-preview.js'].forEach((rel) => {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    const bare = src.split('\n').filter(l =>
      /fs\.readdirSync\(/.test(l) && !/\.sort\(\)/.test(l) && !/^\s*\*/.test(l));
    assert.deepEqual(bare.map(l => l.trim()), [],
      `${rel}: 정렬 없는 readdir 이 남았다 — 그 줄의 결과가 기계마다 달라진다`);
  });
});

/**
 * ★★ **`font: 700 13px/1 inherit` 은 통째로 버려진다** 〈2026-08-21 실측〉.
 *
 * `font` 축약형의 **글꼴 이름 자리에 `inherit` 을 쓸 수 없다.** CSS-wide 키워드는
 *   값 전체일 때만 뜻이 있다. 브라우저는 그 줄을 **조용히 버리고**, 그 요소는
 *   크기도 굵기도 없이 브라우저 기본으로 그려진다 — **오류는 어디에도 안 뜬다.**
 *
 * 실측: `select` 가 15px 로 적혀 있는데 실제로는 크롬 기본 13.333px 로 나왔다.
 *   **화면 아홉 곳에 58군데가 그 상태였다.** 「글씨가 좀 작네」로만 보여서
 *   아무도 원인을 못 찾는다.
 *
 * ★ `font: inherit;` 하나만 있는 것은 **정상이다** — 값 전체가 키워드다.
 */
test('★★ font 축약형에 inherit 을 글꼴 이름으로 쓰지 않는다 (통째로 버려진다)', () => {
  const bad = [];
  // ★ `SCREENS` 에 없는 화면도 본다 — 실제로 가장 많이 걸린 곳이 files.html 이었다
  [...SCREENS, 'files.html', 'dashboard.html'].forEach((f) => {
    const p = path.join(PLAT, f);
    if (!fs.existsSync(p)) return;
    const css = fs.readFileSync(p, 'utf8');
    [...css.matchAll(/font:\s*([^;{}]*?)\s*;/g)].forEach((m) => {
      const v = m[1].trim();
      if (v === 'inherit') return;                 // 값 전체가 키워드 — 정상
      if (/\binherit\s*$/.test(v)) bad.push(`${f}: font: ${v};`);
    });
  });
  assert.deepStrictEqual(bad, [],
    '이 줄들은 브라우저가 통째로 버린다 — 크기·굵기가 안 먹는데 오류도 안 난다:\n  '
    + bad.join('\n  '));
});

/**
 * ★ 위 검사가 **정말 잡는지** 여기서 확인한다. 「없는 것을 찾는」 검사는
 *   통과만 보면 검사가 죽은 날에도 통과한다 (M-08).
 */
test('★ 그 검사가 실제로 잡는다 (헛도는 검사가 아니다)', () => {
  const isBad = (v) => v.trim() !== 'inherit' && /\binherit\s*$/.test(v.trim());
  assert.ok(isBad('700 13px/1 inherit'), '틀린 것을 못 잡는다');
  assert.ok(isBad('400 clamp(13px, 3.6vw, 15px)/1.3 inherit'), 'clamp 가 섞이면 못 잡는다');
  assert.ok(!isBad('inherit'), '멀쩡한 것을 잡는다 — 헛울음이다');
  assert.ok(!isBad('700 13px/1 var(--lp-font)'), '멀쩡한 것을 잡는다');
});
