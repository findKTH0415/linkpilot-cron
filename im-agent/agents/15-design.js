'use strict';
/**
 * 15 Design Manager — 만드는 자리가 아니라 **막는 자리** (D-123)
 *
 * ★★ **왜 이 자리가 필요한가** 〈2026-08-26 사장님 「권고안대로」 · D-123〉.
 *   디자인 Agent 지시서 §8.4 —
 *   「기능이 작동하더라도 `DESIGN_VERIFIED` 를 통과하지 못하면 **완료 처리하지 않는다**.」
 *
 *   `design/` 에는 이미 여덟 파일이 있다 — 테마 13 · 문체 9 · 규칙 14 ·
 *   추천기 · 인쇄 기하. **없던 것은 규칙이 아니라 그 규칙을 언제 누가 대는가**였다.
 *   `06_im_writer` 가 문서를 만들고 나면 아무도 그것을 규칙에 대 보지 않았다.
 *
 *   그래서 이 Agent 는 **아무것도 만들지 않는다.** 나온 것을 규칙에 댄다.
 *
 * ★★★ **네 모드로 운영한다** (지시서 §2.2 · D-123). 전문 Agent 넷으로 쪼개지
 *   않는 이유는 값을 재어 두었기 때문이다 — 갈래를 넷 더 열면 견줄 짝이
 *   6 → 28 이 된다 (`npm run merge:watch`).
 *
 *     report    보고서 출력물 — a4 HTML · Markdown 본문
 *     product   화면(UI) 산출물 — 지금은 대상이 파이프라인에 없다
 *     archviz   건축 시각화 — 매스 SVG·조감도의 표기
 *     brand     브랜드·권리 — 비밀·개인정보·저작권
 *
 *   ★ **대상이 없는 모드는 「통과」가 아니라 「대상 없음」이다.** 0 이 정상
 *     결과이기도 한 자리라 0 옆에 왜 0 인지를 남긴다 (지침 §4 · M-37).
 *
 * ★ `facts` 는 **항상 빈 배열이다.** 이 Agent 가 내는 것은 판정이지 값이 아니다.
 * ★ 새 규칙을 여기 적지 않는다 — 규칙은 `design/rules.json` 한 곳에 있다.
 *   두 벌이 되면 한쪽이 옛말을 한다.
 *
 * 전부 결정적 검사다. LLM 미사용.
 */

const check = require('../design/check');
const themes = require('../design/themes');

/** 네 모드 — 지시서 §2.2. 순서는 산출물이 나오는 순서다 */
const MODES = ['report', 'product', 'archviz', 'brand'];

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    writer: { type: 'object', nullable: true },
    massing: { type: 'object', nullable: true },
    intake: { type: 'object', nullable: true },
  },
};

const outputSchema = {
  type: 'object',
  required: ['facts', 'flags', 'verified', 'modes'],
  properties: {
    facts: { type: 'array', maxItems: 0 },
    flags: { type: 'array' },
    /** DESIGN_VERIFIED — RED 가 하나라도 있으면 false (지시서 §8.4) */
    verified: { type: 'boolean' },
    /** 모드마다 무엇을 봤고 왜 그 결과인지 */
    modes: { type: 'array' },
    theme: { type: 'string', nullable: true },
    writing: { type: 'string', nullable: true },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

function flag(severity, type, message, extra = {}) {
  return { severity, type, message, agent: '15_design', ...extra };
}

/** 검사 결과를 깃발로 옮긴다. `design/rules.json` 이 심각도를 정한다 */
function toFlags(result, mode, what) {
  if (!result || !Array.isArray(result.violations)) return [];
  return result.violations.map(v => flag(
    v.severity || 'YELLOW',
    `DESIGN_${(v.rule || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
    `[${mode}] ${what} — ${v.message || v.label}`,
    { rule: v.rule, mode },
  ));
}

async function run(input, ctx = {}) {
  const log = ctx.log || (() => {});
  const flags = [];
  const modes = [];
  const writer = input.writer || null;

  /* ── 테마·문체가 정해져 있는가 ───────────────────────────
   * 정해지지 않았으면 대조할 기준이 없다. 그것도 사실이므로 적는다. */
  const themeId = (writer && writer.theme && (writer.theme.id || writer.theme)) || null;
  const theme = themeId ? themes.get(themeId) : null;
  const writing = theme && theme.writing ? theme.writing : null;
  if (!themeId) {
    flags.push(flag('YELLOW', 'DESIGN_THEME_UNSET',
      '테마가 정해지지 않아 테마 정합성을 대조할 기준이 없다'));
  }

  /* ── ① report — 보고서 출력물 ──────────────────────────── */
  {
    const seen = [];
    if (writer && writer.html) {
      const r = check.checkHtml(writer.html);
      flags.push(...toFlags(r, 'report', 'A4 HTML'));
      seen.push('A4 HTML');
      if (theme) {
        const t = check.checkThemeConsistency(writer.html, theme);
        flags.push(...toFlags(t, 'report', '테마 정합성'));
      }
    }
    if (writer && writer.im) {
      flags.push(...toFlags(check.checkMarkdown(writer.im), 'report', 'IM 본문'));
      seen.push('IM 본문');
    }
    if (writer && writer.teaser) {
      flags.push(...toFlags(check.checkMarkdown(writer.teaser), 'report', 'Teaser'));
      seen.push('Teaser');
    }
    modes.push({
      mode: 'report', checked: seen.length, targets: seen,
      // ★ 0 옆에 왜 0 인지 (지침 §4 · M-37)
      note: seen.length ? null : '문서가 아직 안 만들어졌다 — 06_im_writer 가 돌지 않았거나 산출물이 비었다',
    });
  }

  /* ── ② product — 화면 산출물 ────────────────────────────
   * ★ 지금 파이프라인은 화면을 만들지 않는다. **「통과」가 아니라 「대상 없음」**이다.
   *   통과로 적으면 화면 검사가 도는 것처럼 읽힌다. */
  modes.push({
    mode: 'product', checked: 0, targets: [],
    note: '이 파이프라인은 화면(UI) 산출물을 만들지 않는다 — 검사할 대상이 없다. 통과가 아니다',
  });

  /* ── ③ archviz — 건축 시각화의 표기 ─────────────────────
   * ★ 그림 자체를 평가하지 않는다. **표기가 붙어 있는가**만 본다 —
   *   AI 그림이 설계안으로 읽히는 것이 여기서 막아야 할 사고다 (D-34). */
  {
    const renders = (input.intake && input.intake.bodyRenders) || [];
    let missing = 0;
    for (const r of renders) {
      if (!r.disclaimer || !r.based_on) {
        missing += 1;
        flags.push(flag('RED', 'DESIGN_RENDER_UNLABELED',
          `[archviz] 본문에 실리는 렌더 ${r.file || '(이름 없음)'} 에 표기가 빠졌다 — AI 그림이 실제 설계안으로 읽힌다 (D-34)`));
      }
    }
    const files = (input.massing && input.massing.files) || [];
    const svgs = files.filter(f => String(f.path || f).endsWith('.svg'));
    for (const s of svgs) {
      const p = String(s.path || s);
      // §6-1 — SVG 를 만들면 같은 이름의 JPEG 이 함께 있어야 한다
      const jpg = p.replace(/\.svg$/, '.jpg');
      if (!files.some(f => String(f.path || f) === jpg)) {
        flags.push(flag('YELLOW', 'DESIGN_SVG_WITHOUT_RASTER',
          `[archviz] ${p} 의 짝 JPEG 이 없다 — SVG 는 카카오톡·메일 미리보기·PPT 에서 빈 칸이 된다 (CLAUDE.md §6-1)`));
      }
    }
    modes.push({
      mode: 'archviz', checked: renders.length + svgs.length,
      targets: [`렌더 ${renders.length}건`, `SVG ${svgs.length}건`],
      note: (renders.length + svgs.length) ? null : '이 딜에는 본문 렌더도 SVG 도 없다 — 검사할 대상이 없다',
      unlabeled: missing,
    });
  }

  /* ── ④ brand — 비밀·개인정보·저작권 ─────────────────────
   * ★ 이름이 아니라 **값으로** 찾는다 (`checkRights`). 이름으로 찾으면
   *   「ECOS_API_KEY 를 넣으십시오」 같은 안내문이 걸린다. */
  {
    const texts = [];
    if (writer && writer.im) texts.push(['IM 본문', writer.im]);
    if (writer && writer.teaser) texts.push(['Teaser', writer.teaser]);
    if (writer && writer.html) texts.push(['A4 HTML', writer.html]);
    for (const [what, t] of texts) {
      flags.push(...toFlags(check.checkRights(t, { env: process.env }), 'brand', what));
    }
    modes.push({
      mode: 'brand', checked: texts.length, targets: texts.map(t => t[0]),
      note: texts.length ? null : '검사할 글이 없다 — 문서가 아직 안 만들어졌다',
    });
  }

  const red = flags.filter(f => f.severity === 'RED').length;
  const yellow = flags.filter(f => f.severity === 'YELLOW').length;
  const looked = modes.reduce((n, m) => n + m.checked, 0);

  /* ★★ **아무것도 안 봤으면 통과가 아니다** (guard 의 「못 잼은 통과가 아니다」와 같은 결).
   *   대상이 하나도 없는데 verified:true 를 내면, 문서가 안 만들어진 딜이
   *   「디자인 검증 통과」로 남는다. */
  const verified = looked > 0 && red === 0;
  if (!looked) {
    flags.push(flag('YELLOW', 'DESIGN_NOTHING_CHECKED',
      '검사한 산출물이 하나도 없다 — 통과가 아니라 **못 쟀다**. 06_im_writer 의 산출물이 비었는지 본다'));
  }

  log(`  디자인 검증: ${verified ? 'DESIGN_VERIFIED' : '미통과'}`
    + ` · 본 것 ${looked}건 · RED ${red} / YELLOW ${yellow}`
    + (theme ? ` · 테마 ${theme.id}` : ' · 테마 미정'));

  return {
    facts: [], flags, verified, modes,
    theme: themeId, writing,
    confidence: !looked ? 0.2 : (red ? 0.3 : 0.85),
  };
}

module.exports = { id: '15_design', label: 'Design Manager', inputSchema, outputSchema, run, MODES };
