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
  // DESIGN_SYSTEM.md §2 에서 그대로 가져온 값이다. 바꾸려면 문서를 먼저 고친다
  const want = {
    '--lp-brand': '#AAE106',
    '--lp-brand-deep': '#7BA10F',
    '--lp-brand-soft': '#F0FAD8',
    '--lp-brand-ink': '#0A1419',
    '--lp-navy': '#0A1419',
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
  const banned = /#(?:9ED700|AAE106|EDF7DC|F0FAD8|5C7A00|7BA10F|4F6900|4F6A00|4E6900|17181A|0A1419|F5F6F8|F2F2F7|E03131|FF3B30|E8A33D|FF9500)\b/i;
  SCREENS.forEach((f) => {
    const body = read(f).replace(/<!--[\s\S]*?-->/g, '');
    const hit = body.match(banned);
    assert.equal(hit, null, `${f}: 색을 직접 적었다 (${hit && hit[0]}) — tokens.css 를 쓴다`);
  });
});

test('★ 디자인 시스템: 화면이 tokens.css 를 부른다', () => {
  SCREENS.forEach((f) => {
    assert.match(read(f), /<link rel="stylesheet" href="tokens\.css">/, `${f}: 토큰을 안 부른다`);
  });
});

test('★★ 디자인 시스템: 미리보기가 토큰을 인라인한다', () => {
  // 안 하면 미리보기가 **색 없이** 뜨는데 오류는 안 난다 — CSS 는 모르는 변수를
  // 조용히 넘긴다. 확인하라고 보낸 화면이 실제와 다르면 확인이 아니다
  ['section-preview.html', 'section-static.html', 'section-artifact.html'].forEach((f) => {
    const s = read(f);
    assert.ok(!s.includes('rel="stylesheet"'), `${f}: 바깥 스타일시트가 남았다`);
    assert.ok(s.includes('--lp-brand:'), `${f}: 토큰이 안 들어갔다`);
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
  assert.match(TOKENS, /--lp-brand-ink:\s*#0A1419/);
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
