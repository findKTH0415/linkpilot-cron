#!/usr/bin/env node
'use strict';
/**
 * arch-case.js — 통합엔진 사례를 돌려 보고서·기준 데이터·조감도 지시문을 쓴다 (CLAUDE.md §28)
 *   npm run arch:case -- [사례.json] [--style=A|B|C|AB…]   (기본: im-agent/arch/case-2026-10-27.json · 디자인 ABC)
 * 산출: data/_arch/<project_id>/report.md · model.json · render-brief.txt · plans/unit-<타입>-<디자인>.svg(+jpg) · _summary.md(첫 줄 판정)
 * ★ 조감도는 여기서 안 그린다 — 열쇠가 있는 자리(Actions «제미나이 그림»)에서 render-brief.txt 와 기준 그림으로 짓는다.
 */
const fs = require('fs'); const path = require('path');
const eng = require('../core/arch-engine');
const { kstStamp } = require('../core/kst');
const ROOT = path.join(__dirname, '..', '..');
const file = process.argv.slice(2).find((x) => !x.startsWith('--')) || path.join(ROOT, 'im-agent/arch/case-2026-10-27.json');
const c = JSON.parse(fs.readFileSync(file, 'utf8'));
const styleArg = (process.argv.find((x) => x.startsWith('--style=')) || '').slice(8);
if (styleArg) c.plan_style = styleArg; // --style=A · --style=BC · 없으면 사례 JSON 의 plan_style (기본 ABC)
c.env = process.env;
const at = kstStamp();
const r = eng.report(c, at);
const out = path.join(ROOT, 'data/_arch', String(c.project_id || 'case').replace(/[^0-9A-Za-z_-]/g, ''));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'report.md'), eng.toMarkdown(r, c));
fs.writeFileSync(path.join(out, 'model.json'), JSON.stringify({ updatedAt: at, model: r.model, checks: r.checks, scenarios: r.scenarios, permits: r.permits }, null, 1) + '\n');
fs.writeFileSync(path.join(out, 'render-brief.txt'), r.renderBrief + '\n');
// 단위세대 평면 — 고른 디자인(A·B·C)마다 SVG + 같은 이름 JPEG(§6-1)
const plan = require('../core/arch-plan');
const raster = require('../core/raster');
const pd = path.join(out, 'plans'); fs.mkdirSync(pd, { recursive: true });
const rels = [];
for (const u of r.plans.units.filter((x) => x.template)) for (const st of r.plans.styles) {
  const rel = `unit-${u.type}-${st.id}.svg`;
  fs.writeFileSync(path.join(pd, rel), plan.render(plan.TEMPLATES[u.type], st.id));
  rels.push(rel);
}
const jr = raster.alongside(pd, rels);
if (jr.failed.length) console.warn('⚠ JPEG 을 못 만든 평면 ' + jr.failed.length + '장 — ' + jr.failed.map((f) => f.rel + ': ' + f.reason).join(' · '));
const sum = [`> 판정 — ${r.summary.verdict} · 적합 ${r.summary.pass} · 부적합 ${r.summary.fail} · 미확인 ${r.summary.unverified}`, '', `# 통합엔진 사례 — ${c.title}`, '', `${at} · 설계 버전 ${r.model.design_version}`, ''];
fs.writeFileSync(path.join(out, '_summary.md'), sum.join('\n') + '\n');
console.log(sum.join('\n'));
console.log('→ ' + path.relative(ROOT, out));
