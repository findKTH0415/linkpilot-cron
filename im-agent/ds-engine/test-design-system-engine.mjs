// 디자인 시스템 엔진 자동 검사 — 외부 응답은 공식 문서 예시 형식의 모의 응답으로 대체
import assert from 'node:assert/strict';
import * as E from './design-system-engine.js';

const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message }); }
}

const calls = [];
function mockFetch(routes) {
  return async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {} });
    for (const [pat, h] of routes) {
      if (url.includes(pat)) {
        const r = typeof h === 'function' ? h(url, init) : h;
        return {
          ok: (r.status || 200) < 400, status: r.status || 200,
          json: async () => r.json, text: async () => r.text,
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
}

const FIX = {
  scheme: { json: { mode: 'monochrome', count: '3', colors: [{ hex: { value: '#400000' } }, { hex: { value: '#800000' } }, { hex: { value: '#C00000' } }] } },
  search: { json: { icons: ['mdi:handshake', 'mdi:handshake-outline', 'lucide:handshake'], total: 3, limit: 32, start: 0 } },
  svg: { text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>' },
  fonts: { json: [{ id: 'noto-sans-kr', family: 'Noto Sans KR', subsets: ['korean', 'latin'], weights: [400, 700], styles: ['normal'], defSubset: 'korean', variable: true, category: 'sans-serif', type: 'google' }] },
  font: { json: { id: 'abel', family: 'Abel', subsets: ['latin'], weights: [400], styles: ['normal'], defSubset: 'latin',
    unicodeRange: { latin: 'U+0000-00FF' },
    variants: { 400: { normal: { latin: { url: { woff2: 'https://cdn.jsdelivr.net/fontsource/fonts/abel@latest/latin-400-normal.woff2', woff: 'https://cdn.jsdelivr.net/fontsource/fonts/abel@latest/latin-400-normal.woff' } } } } } } },
  figmaVars: { json: { status: 200, error: false, meta: {
    variableCollections: { 'C:1': { id: 'C:1', name: 'Brand', defaultModeId: 'M:1', modes: [{ modeId: 'M:1', name: 'Light' }] } },
    variables: {
      'V:1': { id: 'V:1', name: 'color/brand/red', resolvedType: 'COLOR', variableCollectionId: 'C:1', valuesByMode: { 'M:1': { r: 0.7529, g: 0, b: 0, a: 1 } } },
      'V:2': { id: 'V:2', name: 'color/button/fill', resolvedType: 'COLOR', variableCollectionId: 'C:1', valuesByMode: { 'M:1': { type: 'VARIABLE_ALIAS', id: 'V:1' } } },
      'V:3': { id: 'V:3', name: 'space/md', resolvedType: 'FLOAT', variableCollectionId: 'C:1', valuesByMode: { 'M:1': 16 } },
    } } } },
};

// 1~4 프리셋과 CSS
await t('PDI 프리셋 토큰이 규칙 검사를 0건으로 통과', () => {
  const ds = E.PRESETS.pdi();
  assert.deepEqual(E.validateTokens(ds, { preset: 'pdi' }), []);
  assert.equal(E.resolveToken(ds, 'color.brand.red'), '#C00000');
});
await t('CSS 변수 출력에 브랜드 빨강·별칭 var() 변환 포함', () => {
  const css = E.toCSS(E.PRESETS.pdi());
  assert.match(css, /--ds-color-brand-red: #C00000;/);
  assert.match(css, /--ds-color-surface-dark: var\(--ds-color-neutral-900\);/);
  assert.match(css, /--ds-font-family-base: Paperlogy, Pretendard, SUIT, 'Noto Sans KR', sans-serif;/);
});
await t('CSS 머리말 갱신 시각이 단일 상수(ENGINE_META.updatedAt)에서 파생', () => {
  assert.ok(E.toCSS({}).includes(E.ENGINE_META.updatedAt));
});
await t('브랜드 빨강 흰 배경 대비 4.5 이상 (계산값 약 6.4)', () => {
  const r = E.contrastRatio('#C00000', '#FFFFFF');
  assert.ok(r >= 4.5 && r < 7, String(r));
  assert.equal(E.bestTextColor('#C00000'), '#FFFFFF');
});

// 5~7 색
await t('The Color API 응답을 배색으로 변환', async () => {
  E.clearCache();
  const r = await E.colorScheme('c00000', { count: 3, fetch: mockFetch([['thecolorapi.com/scheme', FIX.scheme]]) });
  assert.equal(r.source, 'thecolorapi');
  assert.deepEqual(r.colors, ['#400000', '#800000', '#C00000']);
  assert.ok(calls.at(-1).url.includes('hex=C00000&mode=monochrome&count=3'));
});
await t('색 API 실패 시 내부 계산으로 대체 (색 개수·형식 유지)', async () => {
  E.clearCache();
  const r = await E.colorScheme('#C00000', { mode: 'triad', count: 6, fetch: async () => { throw new Error('network'); } });
  assert.equal(r.source, 'local-fallback');
  assert.equal(r.colors.length, 6);
  r.colors.forEach((c) => assert.match(c, /^#[0-9A-F]{6}$/));
});
await t('단계색 50~900 생성, 500은 원색', () => {
  const s = E.tonalScale('#C00000');
  assert.equal(Object.keys(s).length, 10);
  assert.equal(s[500], '#C00000');
  assert.ok(E.contrastRatio(s[50], '#FFFFFF') < E.contrastRatio(s[900], '#FFFFFF'));
});

// 8~10 아이콘
await t('Iconify 검색 결과 파싱, 최소 limit 32 적용', async () => {
  E.clearCache();
  const ids = await E.searchIcons('handshake', { limit: 2, fetch: mockFetch([['api.iconify.design/search', FIX.search]]) });
  assert.deepEqual(ids, ['mdi:handshake', 'mdi:handshake-outline']);
  assert.ok(calls.at(-1).url.includes('limit=32'));
});
await t('아이콘 SVG 주소 형식 (색 인코딩 포함)', () => {
  assert.equal(E.iconSvgUrl('mdi:home', { color: '#c00000' }), 'https://api.iconify.design/mdi/home.svg?color=%23C00000');
  assert.throws(() => E.iconSvgUrl('home'));
});
await t('아이콘 SVG 본문 가져오기', async () => {
  E.clearCache();
  const svg = await E.getIconSvg('mdi:home', { fetch: mockFetch([['api.iconify.design/mdi/home.svg', FIX.svg]]) });
  assert.ok(svg.startsWith('<svg'));
});

// 11~12 글꼴
await t('Fontsource 조건 검색 주소 조립과 결과 파싱', async () => {
  E.clearCache();
  const list = await E.findFonts({ subsets: ['korean'], variable: true }, { fetch: mockFetch([['api.fontsource.org/v1/fonts?', FIX.fonts]]) });
  assert.equal(list[0].family, 'Noto Sans KR');
  assert.ok(calls.at(-1).url.endsWith('/v1/fonts?subsets=korean&variable=true'));
});
await t('@font-face CSS 생성 (woff2 우선, unicode-range 포함)', async () => {
  E.clearCache();
  const f = await E.getFont('abel', { fetch: mockFetch([['api.fontsource.org/v1/fonts/abel', FIX.font]]) });
  const css = E.fontFaceCSS(f);
  assert.match(css, /font-family: 'Abel'/);
  assert.match(css, /latin-400-normal\.woff2\) format\('woff2'\), url\(.+\.woff\) format\('woff'\)/);
  assert.match(css, /unicode-range: U\+0000-00FF/);
});

await t('한글 글꼴 조각(숫자 키) 전체 출력 — subset all', () => {
  const kr = { family: 'Noto Sans KR', defSubset: 'latin', weights: [400],
    unicodeRange: { '[0]': 'U+AC00-AC2F', '[1]': 'U+AC30-AC5F', latin: 'U+0000-00FF' },
    variants: { 400: { normal: {
      0: { url: { woff2: 'https://x/0.woff2' } }, 1: { url: { woff2: 'https://x/1.woff2' } },
      latin: { url: { woff2: 'https://x/latin.woff2' } } } } } };
  const css = E.fontFaceCSS(kr, { subset: 'all' });
  assert.equal((css.match(/@font-face/g) || []).length, 3);
  assert.match(css, /unicode-range: U\+AC00-AC2F/);
  assert.match(css, /unicode-range: U\+0000-00FF/);
});

// 13~16 Figma
await t('Figma: 토큰 없으면 실행 거부', async () => {
  const saved = process.env.FIGMA_TOKEN; delete process.env.FIGMA_TOKEN;
  await assert.rejects(E.figmaStyles('abc'), /FIGMA_TOKEN/);
  if (saved) process.env.FIGMA_TOKEN = saved;
});
await t('Figma: 브라우저 환경에서는 실행 거부 (키 노출 방지)', async () => {
  globalThis.window = {}; globalThis.document = {};
  try { await assert.rejects(E.figmaStyles('abc', { token: 'x' }), /브라우저에서 실행하지 않습니다/); }
  finally { delete globalThis.window; delete globalThis.document; }
});
await t('Figma: 403 응답을 요금제 안내 문구로 변환, 토큰은 헤더로만 전송', async () => {
  const f = mockFetch([['api.figma.com', { status: 403, json: {} }]]);
  await assert.rejects(E.figmaVariables('abc', { token: 'secret-1', fetch: f }), /Enterprise/);
  const last = calls.at(-1);
  assert.equal(last.headers['X-Figma-Token'], 'secret-1');
  assert.ok(!last.url.includes('secret-1'));
});
await t('Figma 변수 → DTCG 토큰 변환 (색·숫자·별칭)', () => {
  const tk = E.figmaVariablesToTokens(FIX.figmaVars.json);
  assert.equal(tk.color.brand.red.$value, '#C00000');
  assert.equal(tk.color.button.fill.$value, '{color.brand.red}');
  assert.equal(tk.space.md.$value, 16);
  assert.equal(E.resolveToken(tk, 'color.button.fill'), '#C00000');
});

// 17~18 검사기
await t('PDI 규칙 검사: 파랑 계열 색을 찾아냄', () => {
  const tk = E.PRESETS.pdi();
  tk.color.extra = { $type: 'color', $value: '#1E5AA8' };
  assert.equal(E.validateTokens(tk, { preset: 'pdi' }).length, 1);
});
await t('검사기: 끊어진 별칭·잘못된 색 코드 탐지', () => {
  const tk = { color: { a: { $type: 'color', $value: '{color.none}' }, b: { $type: 'color', $value: 'red' } } };
  assert.equal(E.validateTokens(tk).length, 2);
});

// 19~21 통합
await t('엔진 통합 실행: 배색·단계색·아이콘·글꼴·메타 정상', async () => {
  E.clearCache();
  const f = mockFetch([
    ['thecolorapi.com/scheme', FIX.scheme],
    ['api.iconify.design/search', FIX.search],
    ['api.fontsource.org/v1/fonts?', FIX.fonts],
  ]);
  const ds = await E.linkpilotPlugin.run({ seed: '#C00000', count: 3, iconQuery: 'handshake', iconLimit: 2, fontFilter: { subsets: 'korean' }, fetch: f });
  assert.deepEqual(ds.warnings, []);
  assert.deepEqual(ds.meta.sources, ['pdi', 'thecolorapi', 'iconify', 'fontsource']);
  assert.equal(ds.meta.updatedAt, E.ENGINE_META.updatedAt);
  assert.equal(Object.keys(ds.tokens.color.scheme).length, 3);
  assert.equal(ds.tokens.color.seed[500].$value, '#C00000');
  assert.equal(ds.icons[0].svgUrl, 'https://api.iconify.design/mdi/handshake.svg?color=%23111111');
  assert.match(ds.css, /--ds-color-seed-500: #C00000;/);
});
await t('외부 API가 모두 막혀도 엔진은 결과를 내고 경고만 남김', async () => {
  E.clearCache();
  const down = async () => { throw new Error('blocked'); };
  const ds = await E.createDesignSystem({ seed: '#C00000', iconQuery: 'home', fontFilter: { subsets: 'korean' }, fetch: down });
  assert.ok(ds.css.includes('--ds-color-scheme-1'));
  assert.equal(ds.warnings.length, 3);
});
await t('캐시: 같은 요청 두 번째는 외부 호출 없음', async () => {
  E.clearCache();
  let n = 0;
  const f = async () => { n++; return { ok: true, status: 200, json: async () => FIX.search.json }; };
  await E.searchIcons('handshake', { fetch: f });
  await E.searchIcons('handshake', { fetch: f });
  assert.equal(n, 1);
});

// 22~24 서버 처리
await t('NAS 요청 처리: JSON 응답', async () => {
  E.clearCache();
  const r = await E.handleRequest('/design-system?seed=C00000&count=3', { fetch: mockFetch([['thecolorapi.com/scheme', FIX.scheme]]) });
  assert.equal(r.status, 200);
  assert.equal(r.body.tokens.color.scheme['3'].$value, '#C00000');
});
await t('NAS 요청 처리: CSS 응답·기능 조회·없는 경로 404', async () => {
  const css = await E.handleRequest('/design-system?format=css');
  assert.equal(css.type, 'text/css; charset=utf-8');
  const d = await E.handleRequest('/design-system/describe');
  assert.equal(d.body.sources.length, 6); assert.equal(d.body.designTypes.length, 10);
  assert.equal((await E.handleRequest('/x')).status, 404);
});
await t('잘못된 입력은 400으로 안내', async () => {
  const r = await E.handleRequest('/design-system?seed=zzz');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /색 코드/);
});

// 26~35 독립 검토에서 나온 결함 재발 방지
await t('[검토1] 잘못된 주소는 400 응답, 서버가 죽지 않음', async () => {
  const r = await E.handleRequest('//[');
  assert.equal(r.status, 400);
});
await t('[검토1] 실제 서버에 깨진 요청을 보내도 계속 응답', async () => {
  const net = await import('node:net');
  const srv = await E.serve(0); const port = srv.address().port;
  await new Promise((ok) => { const s = net.connect(port, '127.0.0.1', () => s.write('GET //[ HTTP/1.1\r\nHost: x\r\n\r\n')); s.on('data', () => s.end()); s.on('close', ok); s.on('error', ok); });
  const res = await fetch(`http://127.0.0.1:${port}/design-system/describe`);
  assert.equal(res.status, 200);
  srv.close();
});
await t('[검토2] Figma 이름 __proto__ 로 프로토타입 오염 불가', () => {
  const j = { meta: { variableCollections: {}, variables: { a: { name: '__proto__/polluted', resolvedType: 'STRING', valuesByMode: { m: 'x' } } } } };
  const tk = E.figmaVariablesToTokens(j);
  assert.equal(({}).polluted, undefined);
  assert.equal(tk.$extensions['linkpilot.skipped'].length, 1);
});
await t('[검토3] 투명도 있는 브랜드 색으로 덮어써도 빌드 성공', async () => {
  const f = mockFetch([['api.figma.com', { json: { meta: { variableCollections: {}, variables: { a: { name: 'color/brand/red', resolvedType: 'COLOR', valuesByMode: { m: { r: 0.75, g: 0, b: 0, a: 0.5 } } } } } } }]]);
  const ds = await E.createDesignSystem({ figma: { fileKey: 'k', token: 't' }, fetch: f });
  assert.equal(ds.tokens.color.brand.red.$value, '#BF000080');
});
await t('[검토4] 한글 토큰 이름이 서로 덮어쓰지 않음', () => {
  const css = E.toCSS({ 색: { 기본: { $type: 'color', $value: '#111111' }, 강조: { $type: 'color', $value: '#C00000' } } });
  assert.match(css, /--ds-색-기본: #111111;/);
  assert.match(css, /--ds-색-강조: #C00000;/);
});
await t('[검토5] 값에 넣은 기호로 CSS 블록 탈출 불가', () => {
  const css = E.toCSS({ x: { $type: 'string', $value: 'a; } body{display:none' }, f: { $type: 'fontFamily', $value: ["A'; }", 'B'] } });
  const body = css.split('\n').slice(1).join('\n');
  assert.equal((body.match(/\{/g) || []).length, 1);
  assert.equal((body.match(/\}/g) || []).length, 1);
});
await t('[검토6] 캐시 상한 300개 유지', async () => {
  E.clearCache();
  const f = async () => ({ ok: true, status: 200, json: async () => ({ icons: [] }) });
  for (let i = 0; i < 350; i++) await E.searchIcons('q' + i, { fetch: f });
  assert.equal(E.cacheSize(), 300);
});
await t('[검토7] count 이상값은 1~12로 보정', async () => {
  E.clearCache();
  const f = mockFetch([['thecolorapi.com/scheme', FIX.scheme]]);
  await E.colorScheme('#C00000', { count: 'abc', fetch: f });
  assert.ok(calls.at(-1).url.includes('count=5'));
  await E.colorScheme('#C00000', { count: 500, fetch: f });
  assert.ok(calls.at(-1).url.includes('count=12'));
});
await t('[검토8] preset=constructor 는 400', async () => {
  const r = await E.handleRequest('/design-system?preset=constructor');
  assert.equal(r.status, 400);
});
await t('[검토9] Figma fileKey 경로 조작 차단 (인코딩)', async () => {
  const f = mockFetch([['api.figma.com', { json: { meta: { styles: [] } } }]]);
  await E.figmaStyles('abc/../../me?x=', { token: 't', fetch: f });
  assert.ok(calls.at(-1).url.startsWith('https://api.figma.com/v1/files/abc%2F..%2F..%2Fme%3Fx%3D/styles'));
});
await t('[검토10] 값과 묶음 이름이 겹치면 경고로 알림', async () => {
  const f = mockFetch([['api.figma.com', { json: { meta: { variableCollections: {}, variables: {
    a: { name: 'space/sm', resolvedType: 'FLOAT', valuesByMode: { m: 8 } },
    b: { name: 'space/sm/x', resolvedType: 'FLOAT', valuesByMode: { m: 4 } } } } } }]]);
  const ds = await E.createDesignSystem({ figma: { fileKey: 'k', token: 't' }, fetch: f });
  assert.equal(ds.tokens.space.sm.$value, 8);
  assert.ok(ds.warnings.some((w) => w.includes('space/sm/x')));
});

// 37~ 작업지침 v1.0 (디자인·레이아웃 10종) 반영분
await t('[10종] 고정 ID 정확히 10개, 중복 없음, 01~10 연번', () => {
  const ids = E.DESIGN_TYPES.map((x) => x.id);
  assert.equal(ids.length, 10);
  assert.equal(new Set(ids).size, 10);
  assert.deepEqual(ids, Array.from({ length: 10 }, (_, i) => `LP-DS-${String(i + 1).padStart(2, '0')}`));
});
await t('[10종] 타입 목록은 바꿀 수 없음 (추가·이름 변경 차단)', () => {
  assert.throws(() => { E.DESIGN_TYPES.push({ id: 'LP-DS-11' }); });
  assert.throws(() => { E.DESIGN_TYPES[0].name = 'x'; });
  assert.throws(() => { E.DESIGN_TYPES[1].colorRefs.accent = '--lp-red'; });
});
await t('[10종] 지침 3장의 타입명과 일치', () => {
  const names = ['기업표준 그리드형', '부동산·투자 IM형', '사업계획 캔버스형', '공공·정책 보고형', '데이터분석 대시보드형',
    '인프라·사업구도형', '로드맵·추진일정형', '분양·프로모션형', '사진·브로슈어형', '프리미엄 투자제안형'];
  assert.deepEqual(E.DESIGN_TYPES.map((x) => x.name), names);
});
await t('[10종] 컬러 참조가 모두 부록 A 실제 변수', () => {
  const vars = new Set(E.LP_CSS_VARS.map((v) => v.name));
  for (const ty of E.DESIGN_TYPES) for (const ref of Object.values(ty.colorRefs)) assert.ok(vars.has(ref), `${ty.id} ${ref}`);
});
await t('[10종] 타입별 영문 글꼴이 지침 표와 일치', () => {
  const want = { '01': 'Roboto Condensed', '02': 'DIN Condensed', '03': 'Roboto Condensed', '04': 'Paperlogy', '05': 'Roboto Condensed',
    '06': 'DIN Condensed', '07': 'Roboto Condensed', '09': 'Oswald', '10': 'Montserrat' };
  for (const [n, fam] of Object.entries(want)) assert.equal(E.getDesignType('LP-DS-' + n).fonts.latinHeading.family, fam, n);
  const t8 = E.getDesignType('LP-DS-08').fonts;
  assert.equal(t8.price.family, 'Bebas Neue'); assert.equal(t8.event.family, 'Anton');
  assert.equal(E.getDesignType('LP-DS-10').fonts.latinHeading.weight, 800);
});
await t('[부록A] 플랫폼 CSS 변수 61개 원문 그대로, 별칭 끝까지 해석', () => {
  assert.equal(E.LP_CSS_VARS.length, 61);
  const tk = E.PRESETS.linkpilot();
  assert.deepEqual(E.validateTokens(tk, { preset: 'linkpilot' }), []);
  assert.equal(E.resolveToken(tk, 'lp.brand'), '#AAE106');
  assert.equal(E.resolveToken(tk, 'lp.text-1'), '#0A1419');
  assert.equal(tk.lp['ink-hover'].$extensions['linkpilot.source'].line, 1287);
  assert.equal(tk.lp.fill.$value, 'rgba(120,120,128,.12)');
  assert.equal(E.LP_CSS_SOURCE.sha256, 'e51db3a007868cb13efb625a90d133432deef7bb30e5541030ab8d6be9c1623e');
  assert.equal(E.LP_CSS_SOURCE.productionMatch, 'unverified');
});
await t('[부록A] Paperlogy 5굵기 파일 기록, 배포·임베딩은 미확인으로 남김', () => {
  const p = E.FONT_ASSETS.filter((a) => a.family === 'Paperlogy');
  assert.deepEqual(p.map((a) => a.weight), [300, 400, 500, 600, 700]);
  assert.equal(p[0].file, 'fonts/Paperlogy-3Light.woff2');
  assert.ok(p.every((a) => a.sha256 === null && !a.verified.embedded));
});
await t('[5.2] DIN Condensed는 파일 필요로 표시, 나머지 5종은 Fontsource 연결', () => {
  const din = E.FONT_ASSETS.find((a) => a.family === 'DIN Condensed');
  assert.equal(din.fontsource, null); assert.match(din.status, /파일 필요/);
  for (const f of ['Bebas Neue', 'Anton', 'Roboto Condensed', 'Oswald', 'Montserrat']) assert.ok(E.FONT_ASSETS.find((a) => a.family === f).fontsource, f);
});
await t('[7.1] 문서 CSS: 표 전부 좌측 정렬·10pt, 우측 정렬 없음, 강조 칸 배경+굵게', () => {
  for (const ty of E.DESIGN_TYPES) {
    const css = E.documentCSS(ty.id);
    assert.match(css, /td \{ text-align: left; font-size: 10pt;/);
    assert.ok(!/text-align:\s*right/.test(css));
    assert.match(css, /td\.lp-em[^{]+\{ background: var\(--lp-[a-z-]+\); font-weight: 600; \}/);
  }
});
await t('[5.1 보류] 글자 크기는 기존 PDI 규격 값을 그대로 재사용', () => {
  const css = E.documentCSS('LP-DS-01');
  for (const v of ['--ds-size-cover: 18pt', '--ds-size-title: 14pt', '--ds-size-kpi: 10pt', '--ds-size-body: 12pt', '--ds-size-table: 10pt', '--ds-size-footnote: 8pt', '--ds-size-source: 7pt']) assert.ok(css.includes(v), v);
});
await t('[5.2] 영문 글꼴 뒤에 플랫폼 글꼴 스택(var(--lp-font)) — 지침에 없는 대체 글꼴을 만들지 않음', () => {
  assert.match(E.documentCSS('LP-DS-02'), /font-family: 'DIN Condensed', var\(--lp-font\); font-weight: 700;/);
  assert.match(E.documentCSS('LP-DS-10'), /font-family: Montserrat, var\(--lp-font\); font-weight: 800/);
  assert.ok(!/Noto Sans KR|Roboto Condensed', Paperlogy/.test(E.DESIGN_TYPES.map((x) => E.documentCSS(x.id)).join('')));
  assert.match(E.documentCSS('LP-DS-04'), /\[data-lp-font-keep\] \{ font-family: var\(--lp-font\); \}/);
});
await t('[6.2] 챕터 면은 --lp-ink-hover 매핑 후보, 출처를 신규 매핑으로 표시', () => {
  assert.equal(E.COMMON_MAPPINGS.chapterFace.ref, '--lp-ink-hover');
  assert.equal(E.COMMON_MAPPINGS.chapterFace.source, 'new-mapping');
  assert.match(E.documentCSS('LP-DS-10'), /--ds-role-chapter-face: var\(--lp-ink-hover\)/);
});
await t('[10.2] 관리 레코드 스키마: 필드·기본값이 지침 예시와 같음', () => {
  const r = E.createDesignRecord({ typeId: 'LP-DS-02' });
  assert.deepEqual(Object.keys(r), ['type_id', 'type_version', 'type_name', 'company_profile_id', 'source_css_path', 'source_css_sha256',
    'source_scope', 'css_token_refs', 'layout_variant', 'font_role_overrides', 'logo_asset_refs', 'figma_asset_refs', 'map_scene_refs', 'output_format', 'enabled']);
  assert.deepEqual(r.css_token_refs, ['--lp-ink', '--lp-surface', '--lp-info', '--lp-info-tint']);
  assert.deepEqual(r.font_role_overrides, { latin_heading: 'DIN Condensed Bold', body: 'Paperlogy' });
  assert.equal(r.enabled, false); assert.equal(r.output_format, null);
  assert.deepEqual(E.validateDesignRecord(r), []);
});
await t('[10.2] 잘못된 레코드 탐지 (없는 타입·이름 불일치·없는 변수·형식)', () => {
  assert.throws(() => E.createDesignRecord({ typeId: 'LP-DS-11' }), /없는 디자인 타입/);
  const bad = { ...E.createDesignRecord({ typeId: 'LP-DS-01' }), type_name: '다른 이름', type_version: 'v1', css_token_refs: ['--lp-nope'], output_format: 'hwp' };
  assert.equal(E.validateDesignRecord(bad).length, 4);
});
await t('[4.2] 타입 변경: 내용은 그대로, 로고·도식·지도 참조 유지, 되돌리기', () => {
  const content = { sections: [{ title: '투자 포인트', text: '원문 그대로', figures: [{ v: 120, unit: '억원', src: '실사' }] }] };
  let doc = { content, design: { ...E.createDesignRecord({ typeId: 'LP-DS-02' }), logo_asset_refs: ['logo-1'] } };
  const before = JSON.stringify(content);
  doc = E.changeDocumentType(doc, 'LP-DS-10');
  assert.equal(doc.content, content); assert.equal(JSON.stringify(doc.content), before);
  assert.equal(doc.design.type_id, 'LP-DS-10'); assert.deepEqual(doc.design.logo_asset_refs, ['logo-1']);
  doc = E.undoDocumentType(doc);
  assert.equal(doc.design.type_id, 'LP-DS-02'); assert.equal(doc.history.length, 0);
});
await t('[4.3] 관리자: 순서·사용 여부만 변경, 새 타입 추가 거부, 사용 중지 타입도 기존 문서는 열림', () => {
  const reg = E.createTypeRegistry({ 'LP-DS-08': { enabled: false }, 'LP-DS-10': { order: 0 } });
  const list = reg.forNewDocument();
  assert.equal(list.length, 9); assert.equal(list[0].id, 'LP-DS-10');
  assert.ok(reg.canOpen({ type_id: 'LP-DS-08' }));
  assert.throws(() => E.createTypeRegistry({ 'LP-DS-11': {} }), /추가할 수 없습니다/);
  assert.throws(() => E.createTypeRegistry({ 'LP-DS-01': { name: '새 이름' } }), /바꿀 수 없는 항목/);
});
await t('[3장] 회사 변형: 원본 ID·버전 유지, 개정은 새 버전, 원본은 그대로', () => {
  const v1 = E.createCompanyVariant('LP-DS-02', { companyProfileId: 'pdi', overrides: { '--lp-info': '#C00000' } });
  const v2 = E.reviseCompanyVariant(v1, { '--lp-ink': '#111111' });
  assert.equal(v2.base_type_id, 'LP-DS-02'); assert.equal(v2.variant_version, '1.1.0'); assert.equal(v1.variant_version, '1.0.0');
  assert.equal(v1.overrides['--lp-ink'], undefined);
  assert.throws(() => E.createCompanyVariant('LP-DS-02', { companyProfileId: 'pdi', overrides: { '--made-up': '#000' } }));
});
await t('[8.2] 지도: 색 미정·중복 탐지, 접면과 권원 분리, 원문 확인엔 근거 필요', () => {
  assert.ok(E.MAP_LAYERS.every((l) => l.color === null));
  const base = { crs: 'EPSG:5186', layers: ['cadastral'], dataSource: '브이월드 연속지적도', geometryVersion: 'v1', queriedAt: '2026-10-25', extent: [0, 0, 1, 1], designVersion: '1.0.0', attribution: 'VWorld' };
  assert.ok(E.validateMapScene(base).some((x) => x.includes('정해지지')));
  assert.ok(E.validateMapScene({ ...base, colors: { subject: '#111', road: '#111', access: '#222' } }).some((x) => x.includes('같습니다')));
  const ok = { ...base, colors: { subject: '#111', road: '#222', access: '#333' }, accessCandidates: [{ parcel: '618-9', touchesRoad: true, rightStatus: '근거 부재' }] };
  assert.deepEqual(E.validateMapScene(ok), []);
  assert.equal(E.validateMapScene({ ...ok, accessCandidates: [{ parcel: '618-9', touchesRoad: true, rightStatus: '원문 확인' }] }).length, 1);
});
await t('[통합] designType 지정 시 문서 CSS·관리 레코드 함께 반환, 없는 타입은 400', async () => {
  const ds = await E.createDesignSystem({ preset: 'linkpilot', designType: 'LP-DS-05' });
  assert.equal(ds.design.record.type_id, 'LP-DS-05');
  assert.ok(ds.design.documentCss.includes('LP-DS-05'));
  assert.deepEqual(ds.meta.sources, ['linkpilot-css']);
  assert.equal((await E.handleRequest('/design-system?type=LP-DS-11')).status, 400);
  assert.equal((await E.handleRequest('/design-system/types')).body.length, 10);
  assert.equal((await E.handleRequest('/design-system/document-css?type=LP-DS-04')).type, 'text/css; charset=utf-8');
});
await t('[5.2] 타입 글꼴 @font-face: Fontsource 응답 사용, DIN은 대체 경고', async () => {
  E.clearCache();
  const f = mockFetch([['api.fontsource.org/v1/fonts/roboto-condensed', { json: { id: 'roboto-condensed', family: 'Roboto Condensed', weights: [400, 700], defSubset: 'latin',
    variants: { 700: { normal: { latin: { url: { woff2: 'https://cdn/rc-700.woff2' } } } } }, unicodeRange: { latin: 'U+0000-00FF' } } }]]);
  const r1 = await E.fontFacesForType('LP-DS-01', { fetch: f, paperlogyBase: '/lp/' });
  assert.ok(r1.css.includes("font-family: 'Roboto Condensed'")); assert.ok(r1.css.includes('url(/lp/fonts/Paperlogy-6SemiBold.woff2)'));
  assert.deepEqual(r1.warnings, []);
  const r2 = await E.fontFacesForType('LP-DS-02', { fetch: f });
  assert.ok(r2.warnings[0].includes('DIN Condensed'));
});

// 독립 감사 2차 지적 재발 방지
await t('[감사2] 관리자 설정: 만든 뒤 바깥에서 고쳐도 새 타입이 끼어들지 않음', () => {
  const st = { 'LP-DS-01': { order: 1 } };
  const reg = E.createTypeRegistry(st);
  st['LP-DS-01'].id = 'LP-DS-11'; st['LP-DS-01'].name = 'hack';
  assert.ok(reg.forNewDocument().every((x) => /^LP-DS-(0[1-9]|10)$/.test(x.id) && x.name !== 'hack'));
  assert.throws(() => E.createTypeRegistry({ 'LP-DS-01': { enabled: 'false' } }), /true\/false/);
});
await t('[감사2] 지도 검사: null·같은 색 다른 표기·모르는 레이어·필수값·근거 문자열', () => {
  assert.deepEqual(E.validateMapScene(null), ['지도 장면 정보가 없습니다']);
  const base = { crs: 'EPSG:5186', layers: ['subject'], parcelId: '618-8', geometryVersion: 'v1', queriedAt: '2026-10-25', extent: [0, 0, 1, 1], designVersion: '1.0.0', attribution: 'VWorld' };
  assert.ok(E.validateMapScene({ ...base, colors: { subject: '#f00', road: '#FF0000', access: '#00F' } }).some((x) => x.includes('같습니다')));
  assert.ok(E.validateMapScene({ ...base, colors: { subject: 'red', road: '#222', access: '#333' } }).some((x) => x.includes('#RRGGBB')));
  assert.ok(E.validateMapScene({ ...base, layers: ['moon'] }).some((x) => x.includes('알 수 없는 레이어')));
  assert.ok(E.validateMapScene({ ...base, layers: 'satellite' }).some((x) => x.includes('layers')));
  assert.ok(E.validateMapScene({ ...base, parcelId: '' }).some((x) => x.includes('parcelId')));
  const sc = { ...base, colors: { subject: '#111111', road: '#222222', access: '#333333' } };
  assert.ok(E.validateMapScene({ ...sc, accessCandidates: [null] }).length === 1);
  assert.ok(E.validateMapScene({ ...sc, accessCandidates: [{ parcel: 'a', rightStatus: '원문 확인', evidence: 'x' }] }).length === 1);
  assert.deepEqual(E.validateMapScene({ ...sc, accessCandidates: [{ parcel: 'a', rightStatus: '원문 확인', evidence: ['등기부 2026-10-01'] }] }), []);
});
await t('[감사2] CSS 주입 차단: scope 선택자·회사 변형 값', () => {
  assert.throws(() => E.documentCSS('LP-DS-01', { scope: 'x{} body{display:none} .a' }), /scope/);
  assert.ok(E.documentCSS('LP-DS-01', { scope: '#preview .page' }).startsWith('/*'));
  assert.throws(() => E.createCompanyVariant('LP-DS-01', { companyProfileId: 'p', overrides: { '--lp-ink': 'red;}body{x:1' } }), /값만/);
});
await t('[감사2] 타입 변경: null 문서·이력 공유 참조·같은 타입 반복·사용 여부 유지', () => {
  assert.throws(() => E.changeDocumentType(null, 'LP-DS-01'), /문서가 없습니다/);
  let doc = { content: {}, design: { ...E.createDesignRecord({ typeId: 'LP-DS-02' }), enabled: true } };
  const same = E.changeDocumentType(doc, 'LP-DS-02');
  assert.equal(same, doc);
  doc = E.changeDocumentType(doc, 'LP-DS-05');
  assert.equal(doc.design.enabled, true);
  doc.history[0].type_name = '변조';
  doc = E.undoDocumentType(doc);
  assert.equal(doc.design.type_name, '변조'); // 이력 자체는 사용자가 고친 값 — 원래 design 객체와는 분리됨
  const d2 = { content: {}, design: E.createDesignRecord({ typeId: 'LP-DS-01' }) };
  const d3 = E.changeDocumentType(d2, 'LP-DS-03');
  d3.history[0].type_name = 'x';
  assert.equal(d2.design.type_name, '기업표준 그리드형');
});
await t('[감사2] 레코드 검사: 목록 아님·타입과 안 맞는 참조·잘못된 버전/형식 생성 거부', () => {
  const r = E.createDesignRecord({ typeId: 'LP-DS-01' });
  assert.ok(E.validateDesignRecord({ ...r, css_token_refs: undefined }).length === 1);
  assert.ok(E.validateDesignRecord({ ...r, css_token_refs: '--lp-ink' }).length === 1);
  assert.ok(E.validateDesignRecord({ ...r, css_token_refs: ['--lp-info'] }).some((x) => x.includes('컬러 참조가 아님')));
  assert.throws(() => E.createDesignRecord({ typeId: 'LP-DS-01', typeVersion: 'abc' }));
  assert.throws(() => E.createDesignRecord({ typeId: 'LP-DS-01', outputFormat: 'exe' }));
  assert.throws(() => E.reviseCompanyVariant({ variant_version: 'x' }));
});
await t('[감사2] 지침에 없는 값 제거: 4~9번 마지막 페이지 비움, 챕터 글자색·tabular-nums 없음, 04 굵기 미지정', () => {
  for (const n of ['04', '05', '06', '07', '08', '09']) assert.equal(E.getDesignType('LP-DS-' + n).lastPage, null, n);
  for (const n of ['01', '02', '03', '10']) assert.ok(E.getDesignType('LP-DS-' + n).lastPage, n);
  const all = E.DESIGN_TYPES.map((x) => E.documentCSS(x.id)).join('');
  assert.ok(!all.includes('tabular-nums'));
  assert.ok(!/lp-last-page \{[^}]*color:/.test(all));
  assert.equal(E.getDesignType('LP-DS-04').fonts.latinHeading.weight, null);
  assert.match(E.FONT_ASSETS.find((a) => a.family === 'DIN Condensed').status, /Fontsource에 없음/);
});

const pass = results.filter((r) => r.ok).length;
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  → ' + r.error}`);
console.log(`\n결과: ${pass}/${results.length} 통과`);
const fs = await import('node:fs');
fs.writeFileSync('test-results.json', JSON.stringify({ updatedAt: E.ENGINE_META.updatedAt, rev: E.ENGINE_META.rev, ranAt: new Date().toISOString(), node: process.version, pass, total: results.length, results }, null, 2));
process.exit(pass === results.length ? 0 : 1);
