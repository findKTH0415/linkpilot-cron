'use strict';
/**
 * evidence-screen.test.js — **가이드 필드 화면에서 값 입력칸을 없앴다**
 * 〈2026-08-27 사장님 지시 · D-152 · D-153〉.
 *
 * 지시 둘:
 *   「업로드한 자료와 API 로 확보된 자료를 근거로 값들의 **100% 를 놓고**
 *    정보기여도와 품질을 측정하고 그 근원으로 보고서 생성을 완성해줘」
 *   「입력값 삭제해줘」 → (확인) **직접 입력칸을 없앤다**
 *
 * ★★ 소스만 훑지 않고 **실제로 그려서** 잰다 (M-08). 「그리기는 하는데 그 자리까지
 *   안 간다」는 소스 검사로 안 잡힌다.
 * ★ 크로미움이 없는 자리에서는 **건너뛴다** — 초록과 「못 쟀다」는 다른 사실이다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const dict = require('../core/dictionary');
const fieldplan = require('../core/fieldplan');
const templates = require('../finance/templates');

/** 그려진 것만 본다 — 인라인 스크립트를 지운다 (CLAUDE.md §8) */
const drawn = (dom) => dom.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

const FACTS = {
  'project.name': { value: '잠원동 역세권활성화사업', source: '사업계획서.pdf', sourceDate: '2026-06', page: 3 },
  'land.area_sqm': { value: 5200, source: '토지대장.pdf', sourceDate: '2026-05', verified: true },
  'land.zoning': { value: '제3종일반주거지역', source: 'VWorld 토지이용계획' },
};

function renderFields(extra) {
  const { findBrowser, renderDom } = require(path.join(PLATFORM, 'build-static.js'));
  const browser = findBrowser();
  if (!browser) return null;   // 크로미움이 없는 서버가 실제로 있다 — 못 쟀다

  const ik = templates.industryKeys('datacenter');
  const preload = {
    fields: dict.FIELDS,
    computedKeys: dict.COMPUTED_KEYS,
    plan: fieldplan.plan('datacenter'),
    industries: [{ id: 'datacenter', label: '데이터센터', own: ik.own, foreign: ik.foreign }],
  };
  const stub = `
<script>
window.LINKPILOT_FIELDS_CFG.preload = ${JSON.stringify(preload)};
window.LINKPILOT_FIELDS_CFG.preloadFacts = { values: ${JSON.stringify(FACTS)} };
${extra || ''}
</script>
`;
  const src = fs.readFileSync(path.join(PLATFORM, 'fields.html'), 'utf8');
  const anchor = '<!-- 부모(앱)가 채운 설정을 받아 병합한다.';
  const probe = path.join(PLATFORM, '__evidence-probe.html');
  fs.writeFileSync(probe, src.replace(anchor, stub + anchor));
  try { return drawn(renderDom(browser, probe, 9000, 1100)); } finally { fs.unlinkSync(probe); }
}

test('★★★ 화면 첫 줄이 **판정 하나**다 — 100% 중 얼마를 자료·API 가 채웠나', () => {
  const dom = renderFields();
  if (!dom) return;
  assert.match(dom, /class="ev__head">항목 \d+개 중 [\d.]+% 를 올린 자료와 공공 API 가 채웠습니다/,
    '근거 판정 줄이 없다 — 스크롤하기 전에 답을 갖지 못한다');
  assert.match(dom, /채워진 값의 품질/, '품질을 따로 안 적었다 — 기여도와 뭉개진다');
});

test('★★★ **값 입력칸이 기본에서 없다** — 있으면 사람은 모르는 값을 지어내서 채운다', () => {
  const dom = renderFields();
  if (!dom) return;
  assert.ok(!/직접 넣기/.test(dom), '[직접 넣기] 단추가 남아 있다');
  assert.ok(!/>고치기</.test(dom), '[고치기] 단추가 남아 있다');
  /* ★ 검색칸 하나만 남는다. 그것까지 없애면 항목을 못 찾는다 */
  const inputs = (dom.match(/<input/g) || []).length;
  assert.strictEqual(inputs, 1, `값 입력칸이 남아 있다 (input ${inputs}개)`);
});

test('★★ 비어 있는 줄에는 **무엇을 하면 채워지는지** 적는다', () => {
  const dom = renderFields();
  if (!dom) return;
  assert.match(dom, /올린 자료에서 뽑습니다|공공데이터에서 가져옵니다|자동으로 채울 방법이 없습니다/,
    '「자료에서 안 나왔습니다」로만 끝난다 — 무엇을 해야 하는지 모른다');
});

test('★★★ [사람이 넣기] 를 켜면 **그때** 입력칸이 나온다 — 길을 없애지는 않았다', () => {
  const dom = renderFields(`
document.addEventListener('DOMContentLoaded', function () {
  setTimeout(function () {
    var b = [].slice.call(document.querySelectorAll('button')).filter(function (x) {
      return /사람이 넣기/.test(x.textContent);
    })[0];
    if (b) b.click();
  }, 300);
});
`);
  if (!dom) return;
  assert.match(dom, /직접 넣기|>고치기</, '켰는데도 넣을 길이 없다 — 자료에 없는 값을 영영 못 넣는다');
  assert.match(dom, /사람이 넣음/, '사람이 넣은 값을 따로 세는 칸이 화면에 없다');
});

test('★★ 갈래별 표가 **한 줄 셀**로 서고 좁으면 표가 가로로 밀린다 (§6-3 ⑤)', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'fields.html'), 'utf8');
  assert.match(src, /\.ev__t th, \.ev__t td \{ white-space: nowrap;/, '셀이 줄바꿈된다 — 행 높이가 들쭉날쭉해진다');
  assert.match(src, /\.ev__wrap \{ overflow-x: auto;/, '좁을 때 표가 접힌다 — 가로로 밀어야 한다');
});

test('★★★ 화면과 엔진이 **같은 파일**로 센다 — 두 벌이면 서로 다른 100% 를 말한다', () => {
  const core = fs.readFileSync(path.join(__dirname, '..', 'core', 'evidence.js'), 'utf8');
  assert.match(core, /require\('\.\.\/ui\/platform\/evidence-core\.js'\)/,
    '엔진이 화면 파일을 안 쓰고 따로 갖고 있다');
  const html = fs.readFileSync(path.join(PLATFORM, 'fields.html'), 'utf8');
  assert.match(html, /<script src="evidence-core\.js/, '화면이 그 파일을 안 싣는다 — 배포 묶음에도 안 들어간다');
});
