// 실제 브라우저(Chromium) 확인 — 플랫폼의 글꼴 강제 규칙과 문서 CSS가 함께 있을 때의 결과
// 실행: PLAYWRIGHT_DIR=<playwright 설치 폴더> node test-browser.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import * as E from './design-system-engine.js';

const require = createRequire((process.env.PLAYWRIGHT_DIR || process.cwd()) + '/');
const { chromium } = require('playwright');

const PLATFORM = `:root{${E.LP_CSS_VARS.map((v) => `${v.name}:${v.value}`).join(';')}}
body *:not(svg):not(svg *):not(.lp-ic):not([data-lp-font-keep]){font-family:var(--lp-font)!important}`;

const results = [];
const t = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

const browser = await chromium.launch();
const page = await browser.newPage();
for (const ty of E.DESIGN_TYPES) {
  const roles = Object.keys(ty.fonts);
  const html = `<style>${PLATFORM}\n${E.documentCSS(ty.id)}</style>
  <div class="lp-doc" data-lp-ds="${ty.id}">
    <p id="body">본문 Body 2026</p>
    ${roles.map((r) => `<h2 id="role-${r}" ${E.fontRoleAttrs(r)}>ROLE 123 한글</h2>`).join('')}
    <h2 id="child-test" ${E.fontRoleAttrs(roles[0])}>ABC <span id="child">child</span></h2>
    <table><tr><th id="th">항목</th><td id="num" class="lp-em">1,234,567</td><td id="date">2026.10.25</td></tr></table>
  </div>`;
  await page.setContent(html);
  const r = await page.evaluate((roles) => {
    const cs = (id) => getComputedStyle(document.getElementById(id));
    return {
      body: cs('body').fontFamily, bodySize: cs('body').fontSize,
      roles: Object.fromEntries(roles.map((x) => [x, [cs('role-' + x).fontFamily, cs('role-' + x).fontWeight]])),
      child: cs('child').fontFamily,
      align: ['th', 'num', 'date'].map((id) => cs(id).textAlign), tdSize: cs('num').fontSize,
      emBg: cs('num').backgroundColor, emW: cs('num').fontWeight,
    };
  }, roles);
  t(`${ty.id} 본문은 Paperlogy`, r.body.startsWith('Paperlogy'), r.body);
  t(`${ty.id} 본문 12pt(16px)`, r.bodySize === '16px', r.bodySize);
  for (const [role, [fam, w]] of Object.entries(r.roles)) {
    const want = ty.fonts[role];
    t(`${ty.id} ${role} 역할 글꼴 ${want.family} ${want.weight}`, fam.replace(/"/g, "'").replace(/'/g, '').startsWith(want.family) && (want.weight == null || Number(w) === want.weight), `${fam} / ${w}`);
  }
  t(`${ty.id} 역할 요소의 자식은 Paperlogy로 돌아감 (지침 경고 재현)`, r.child.startsWith('Paperlogy'), r.child);
  t(`${ty.id} 표 문자·숫자·일자 모두 좌측 정렬`, r.align.every((a) => a === 'left' || a === 'start'), r.align.join(','));
  t(`${ty.id} 표 글자 10pt(13.33px)`, r.tdSize.startsWith('13.33'), r.tdSize);
  t(`${ty.id} 강조 칸 배경색·굵게`, r.emBg !== 'rgba(0, 0, 0, 0)' && Number(r.emW) === 600, `${r.emBg} / ${r.emW}`);
}
await browser.close();

const pass = results.filter((x) => x.ok).length;
for (const x of results.filter((y) => !y.ok)) console.log('FAIL', x.name, '→', x.detail);
console.log(`브라우저 확인: ${pass}/${results.length} 통과`);
fs.writeFileSync('browser-results.json', JSON.stringify({ rev: E.ENGINE_META.rev, ranAt: new Date().toISOString(), pass, total: results.length, results }, null, 2));
process.exit(pass === results.length ? 0 : 1);
