/**
 * LinkPilot 디자인 시스템 엔진 v1.0
 * ------------------------------------------------------------
 * 색·아이콘·글꼴·디자인 토큰을 외부 API에서 가져와
 * 하나의 형식(DTCG 디자인 토큰 JSON + CSS 변수)으로 정리합니다.
 *
 * 연결된 소스
 *   - PDI 하우스 스타일 (내장 프리셋, 키 없음)
 *   - The Color API     색 배합 생성        (키 없음, 브라우저·서버 모두)
 *   - Iconify           아이콘 20만 개 검색  (키 없음, 브라우저·서버 모두)
 *   - Fontsource        글꼴 목록·파일 주소  (키 없음, 브라우저·서버 모두)
 *   - Figma REST        스타일·변수 가져오기 (토큰 필요, 서버 전용)
 *   - LinkPilot 플랫폼 CSS  실제 선언값 60개 (작업지침 v1.0 부록 A, 키 없음)
 *
 * 보고서만들기 디자인·레이아웃 10종 고정 타입 (LP-DS-01 ~ 10)
 *   타입 목록·글꼴 역할·표 규칙·관리 레코드·타입 변경/되돌리기·지도 레이어 검사
 *
 * 사용 예
 *   import { createDesignSystem } from './design-system-engine.js';
 *   const ds = await createDesignSystem({ preset: 'pdi', seed: '#C00000', iconQuery: 'handshake' });
 *   ds.css     // :root { --ds-color-brand-red: #C00000; ... }
 *   ds.tokens  // DTCG 토큰 JSON
 *
 * 요구 환경: Node 18 이상 또는 최신 브라우저 (fetch 내장)
 */

// ── 단일 출처 갱신 시각 ─────────────────────────────────────
// 모든 출력물(CSS 머리말, JSON meta)은 이 상수에서만 파생합니다.
export const ENGINE_META = Object.freeze({
  name: 'linkpilot-design-system',
  version: '1.2.1',
  rev: 'DS-1.2.1',
  updatedAt: '2026-10-25T15:10:00+09:00',
});

const IS_BROWSER = () =>
  typeof globalThis.window !== 'undefined' && typeof globalThis.document !== 'undefined';

// ── 소스 목록 (엔진이 무엇을 쓸 수 있는지 조회할 때 사용) ──
export const SOURCES = Object.freeze([
  { id: 'pdi', name: 'PDI 하우스 스타일', kind: 'preset', needsKey: false, lane: 'any', endpoint: null },
  { id: 'thecolorapi', name: 'The Color API', kind: 'color', needsKey: false, lane: 'any', endpoint: 'https://www.thecolorapi.com' },
  { id: 'iconify', name: 'Iconify', kind: 'icon', needsKey: false, lane: 'any', endpoint: 'https://api.iconify.design' },
  { id: 'fontsource', name: 'Fontsource', kind: 'font', needsKey: false, lane: 'any', endpoint: 'https://api.fontsource.org/v1' },
  { id: 'figma', name: 'Figma REST', kind: 'tokens', needsKey: true, lane: 'server', endpoint: 'https://api.figma.com/v1',
    note: '스타일 조회는 모든 요금제, 변수(Variables) 조회는 Enterprise 요금제 전용' },
  { id: 'linkpilot-css', name: 'LinkPilot 플랫폼 CSS', kind: 'preset', needsKey: false, lane: 'any', endpoint: null,
    note: '작업지침 v1.0 부록 A 로컬 스냅샷 — 운영 서버 일치 미확인' },
]);

// ── 공통: 시간 제한 있는 요청 + 메모리 캐시 ────────────────
const CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300; // 아무나 보내는 검색어로 서버 메모리가 커지지 않게 상한을 둡니다

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.t >= CACHE_TTL_MS) { CACHE.delete(key); return undefined; }
  return hit.v;
}
function cacheSet(key, v) {
  if (CACHE.has(key)) CACHE.delete(key);
  CACHE.set(key, { t: Date.now(), v });
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
}
export function cacheSize() { return CACHE.size; }

// 프로토타입 오염을 막기 위해 토큰 경로에 쓰지 않는 이름
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function clearCache() { CACHE.clear(); }

async function request(url, { fetch: f = globalThis.fetch, headers = {}, timeoutMs = 8000, as = 'json', cache = true } = {}) {
  if (typeof f !== 'function') throw new Error('fetch를 쓸 수 없는 환경입니다 (Node 18 이상 필요)');
  const key = as + ' ' + url;
  if (cache) { const hit = cacheGet(key); if (hit !== undefined) return hit; }

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await f(url, { headers, signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const v = as === 'text' ? await res.text() : await res.json();
    if (cache) cacheSet(key, v);
    return v;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── 색 계산 도구 ─────────────────────────────────────────────
export function normHex(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`색 코드가 올바르지 않습니다: ${hex}`);
  return '#' + h.toUpperCase();
}

function hexToRgb(hex) {
  const h = normHex(hex).slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgbToHex(rgb.map((v) => (v + m) * 255));
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 두 색의 명도 대비 (WCAG). 본문 글자는 4.5 이상 권장 */
export function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

/** 배경색 위에 올릴 글자색 (흰색/검정 중 대비가 큰 쪽) */
export function bestTextColor(bg) {
  return contrastRatio(bg, '#FFFFFF') >= contrastRatio(bg, '#111111') ? '#FFFFFF' : '#111111';
}

/** 한 가지 색으로 50~900 단계 색 만들기 (키 없이 엔진 안에서 계산) */
export function tonalScale(hex) {
  const base = hexToRgb(hex);
  const mix = (target, t) => rgbToHex(base.map((v, i) => v + (target[i] - v) * t));
  const steps = { 50: 0.92, 100: 0.82, 200: 0.64, 300: 0.44, 400: 0.22, 500: 0, 600: -0.16, 700: -0.32, 800: -0.48, 900: -0.64 };
  const out = {};
  for (const [k, t] of Object.entries(steps)) out[k] = t >= 0 ? mix([255, 255, 255], t) : mix([0, 0, 0], -t);
  return out;
}

const SCHEME_MODES = ['monochrome', 'monochrome-dark', 'monochrome-light', 'analogic', 'complement', 'analogic-complement', 'triad', 'quad'];

/** 인터넷이 막혔을 때 쓰는 내부 배색 계산 */
export function localScheme(hex, mode = 'monochrome', count = 5) {
  const [h, s, l] = hexToHsl(hex);
  const n = Math.max(1, Math.min(12, count | 0));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    switch (mode) {
      case 'monochrome': out.push(hslToHex(h, s, 15 + t * 70)); break;
      case 'monochrome-dark': out.push(hslToHex(h, s, 8 + t * 40)); break;
      case 'monochrome-light': out.push(hslToHex(h, s, 50 + t * 42)); break;
      case 'analogic': out.push(hslToHex(h + (t - 0.5) * 60, s, l)); break;
      case 'complement': out.push(hslToHex(i % 2 ? h + 180 : h, s, 25 + t * 50)); break;
      case 'analogic-complement': out.push(hslToHex(i === n - 1 ? h + 180 : h + (t - 0.5) * 60, s, l)); break;
      case 'triad': out.push(hslToHex(h + (i % 3) * 120, s, l)); break;
      case 'quad': out.push(hslToHex(h + (i % 4) * 90, s, l)); break;
      default: out.push(hslToHex(h, s, 15 + t * 70));
    }
  }
  return out;
}

// ── 1) The Color API ─────────────────────────────────────────
export async function colorScheme(seedHex, { mode = 'monochrome', count = 5, fetch } = {}) {
  const hex = normHex(seedHex);
  const m = SCHEME_MODES.includes(mode) ? mode : 'monochrome';
  const n = Number.isFinite(Number(count)) ? Math.max(1, Math.min(12, Math.round(Number(count)))) : 5;
  count = n;
  const url = `https://www.thecolorapi.com/scheme?hex=${hex.slice(1)}&mode=${m}&count=${count}&format=json`;
  try {
    const data = await request(url, { fetch });
    const colors = (data.colors || []).map((c) => normHex(c.hex && c.hex.value));
    if (!colors.length) throw new Error('응답에 색이 없습니다');
    return { colors, source: 'thecolorapi' };
  } catch (e) {
    return { colors: localScheme(hex, m, count), source: 'local-fallback', error: String(e.message || e) };
  }
}

// ── 2) Iconify ───────────────────────────────────────────────
export async function searchIcons(query, { prefix, limit = 32, fetch } = {}) {
  if (!query) return [];
  const lim = Math.max(32, Math.min(999, limit | 0)); // Iconify 최소 32, 최대 999
  const p = new URLSearchParams({ query, limit: String(lim) });
  if (prefix) p.set('prefix', prefix);
  const data = await request(`https://api.iconify.design/search?${p}`, { fetch });
  return (data.icons || []).slice(0, limit);
}

export function iconSvgUrl(id, { color, height } = {}) {
  const [prefix, name] = String(id).split(':');
  if (!prefix || !name) throw new Error(`아이콘 이름은 "세트:이름" 형식이어야 합니다: ${id}`);
  const p = new URLSearchParams();
  if (color) p.set('color', normHex(color));
  if (height) p.set('height', String(height));
  const q = p.toString();
  return `https://api.iconify.design/${prefix}/${name}.svg${q ? '?' + q : ''}`;
}

export async function getIconSvg(id, opts = {}) {
  return request(iconSvgUrl(id, opts), { fetch: opts.fetch, as: 'text' });
}

// ── 3) Fontsource ────────────────────────────────────────────
export async function findFonts(filter = {}, { fetch } = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const q = p.toString();
  const list = await request(`https://api.fontsource.org/v1/fonts${q ? '?' + q : ''}`, { fetch });
  return Array.isArray(list) ? list : [];
}

export async function getFont(id, { fetch } = {}) {
  return request(`https://api.fontsource.org/v1/fonts/${encodeURIComponent(id)}`, { fetch });
}

/**
 * Fontsource 글꼴 정보로 @font-face CSS 만들기
 * subset: 'latin' 같은 이름 하나, 또는 'all' (한글 글꼴은 120여 개 조각으로 나뉘어 있어
 *         'all'로 받으면 브라우저가 화면에 쓰인 글자 조각만 내려받습니다)
 */
export function fontFaceCSS(font, { weights, subset, style = 'normal' } = {}) {
  const ws = weights || font.weights || [400];
  const rules = [];
  for (const w of ws) {
    const byStyle = font.variants && font.variants[w] && font.variants[w][style];
    if (!byStyle) continue;
    const subs = subset === 'all'
      ? Object.keys(byStyle).filter((k) => /^\d+$/.test(k) || (font.unicodeRange && font.unicodeRange[k]))
      : [subset || font.defSubset];
    for (const sub of subs) {
      const v = byStyle[sub];
      if (!v || !v.url) continue;
      const src = [v.url.woff2 && `url(${v.url.woff2}) format('woff2')`, v.url.woff && `url(${v.url.woff}) format('woff')`]
        .filter(Boolean).join(', ');
      const ur = font.unicodeRange && (font.unicodeRange[sub] || font.unicodeRange[`[${sub}]`]);
      const range = ur ? `\n  unicode-range: ${ur};` : '';
      rules.push(`@font-face {\n  font-family: '${font.family}';\n  font-style: ${style};\n  font-weight: ${w};\n  font-display: swap;\n  src: ${src};${range}\n}`);
    }
  }
  return rules.join('\n');
}

// ── 4) Figma (서버 전용) ────────────────────────────────────
function figmaToken(token) {
  if (IS_BROWSER()) {
    throw new Error('Figma 토큰이 필요한 호출은 브라우저에서 실행하지 않습니다. 서버(NAS)나 GitHub Actions에서 실행하세요.');
  }
  const t = token || (typeof process !== 'undefined' && process.env && process.env.FIGMA_TOKEN);
  if (!t) throw new Error('FIGMA_TOKEN 환경변수가 없습니다');
  return t;
}

export async function figmaStyles(fileKey, { token, fetch } = {}) {
  const t = figmaToken(token);
  const data = await request(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/styles`, { fetch, headers: { 'X-Figma-Token': t }, cache: false });
  return (data.meta && data.meta.styles) || [];
}

export async function figmaVariables(fileKey, { token, fetch, published = false } = {}) {
  const t = figmaToken(token);
  const kind = published ? 'published' : 'local';
  try {
    return await request(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/variables/${kind}`, { fetch, headers: { 'X-Figma-Token': t }, cache: false });
  } catch (e) {
    if (e.status === 403) {
      throw new Error('Figma 변수 조회는 Enterprise 요금제 전용입니다. 스타일 조회(figmaStyles)를 쓰거나 Figma 플러그인으로 토큰을 내보내세요.');
    }
    throw e;
  }
}

function figmaColor({ r, g, b, a = 1 }) {
  const hex = rgbToHex([r * 255, g * 255, b * 255]);
  return a < 1 ? hex + Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase() : hex;
}

const FIGMA_TYPE = { COLOR: 'color', FLOAT: 'number', STRING: 'string', BOOLEAN: 'boolean' };

/** Figma 변수 응답 → DTCG 토큰 (기본 모드 값 사용, 별칭은 {a.b} 참조로) */
export function figmaVariablesToTokens(json) {
  const meta = (json && json.meta) || {};
  const vars = meta.variables || {};
  const cols = meta.variableCollections || {};
  const pathOf = (v) => v.name.split('/').map((s) => s.trim().replace(/\s+/g, '-').toLowerCase());
  const out = {};
  const conflicts = [];
  for (const v of Object.values(vars)) {
    if (!v || typeof v.name !== 'string') continue;
    const col = cols[v.variableCollectionId];
    const modeId = col ? col.defaultModeId : Object.keys(v.valuesByMode || {})[0];
    let val = v.valuesByMode ? v.valuesByMode[modeId] : undefined;
    if (val === undefined) continue;
    if (val && val.type === 'VARIABLE_ALIAS') {
      const target = vars[val.id];
      if (!target) continue;
      val = '{' + pathOf(target).join('.') + '}';
    } else if (v.resolvedType === 'COLOR') {
      val = figmaColor(val);
    }
    const path = pathOf(v).filter(Boolean);
    if (!path.length || path.some((p) => UNSAFE_KEYS.has(p) || p.startsWith('$'))) { conflicts.push(`${v.name}: 쓸 수 없는 이름`); continue; }
    let node = out, ok = true;
    for (const p of path.slice(0, -1)) {
      if (node[p] && '$value' in node[p]) { ok = false; break; }
      node = node[p] = node[p] || {};
    }
    const leaf = path[path.length - 1];
    if (!ok || (node[leaf] && !('$value' in node[leaf]))) { conflicts.push(`${v.name}: 값과 묶음 이름이 겹침`); continue; }
    node[leaf] = { $type: FIGMA_TYPE[v.resolvedType] || 'string', $value: val };
  }
  if (conflicts.length) out.$extensions = { 'linkpilot.skipped': conflicts };
  return out;
}

// ── 5) PDI 하우스 스타일 프리셋 ─────────────────────────────
function pdiPreset() {
  const c = (v, d) => ({ $type: 'color', $value: v, ...(d ? { $description: d } : {}) });
  const dim = (v) => ({ $type: 'dimension', $value: v });
  return {
    color: {
      brand: { red: c('#C00000', '도표 번호·질문 번호·핵심 수치·디바이더 번호에만 사용') },
      accent: {
        check: c('#8A6000', '「확인 필요」 표시 전용'),
        line: c('#1B7A5A', '브랜드 라인 전용'),
      },
      neutral: {
        black: c('#000000'), ink: c('#111111'),
        900: c('#1A1A1A'), 800: c('#2B2B2B'), 700: c('#424242'), 600: c('#5C5C5C'), 500: c('#7A7A7A'),
        400: c('#9E9E9E'), 300: c('#BDBDBD'), 200: c('#D6D6D6'), 100: c('#EBEBEB'), 50: c('#F5F5F5'),
      },
      surface: { base: c('#FFFFFF'), dark: c('{color.neutral.900}') },
      text: { body: c('{color.neutral.ink}'), muted: c('{color.neutral.600}'), onDark: c('#FFFFFF') },
    },
    font: {
      family: {
        base: { $type: 'fontFamily', $value: ['Paperlogy', 'Pretendard', 'SUIT', 'Noto Sans KR', 'sans-serif'] },
        accent: { $type: 'fontFamily', $value: ['DIN Condensed', 'Roboto Condensed', 'sans-serif'] },
      },
      weight: {
        light: { $type: 'fontWeight', $value: 300 },
        medium: { $type: 'fontWeight', $value: 500 },
        semibold: { $type: 'fontWeight', $value: 600 },
      },
      size: {
        cover: dim('18pt'), title: dim('14pt'), body: dim('12pt'), kpi: dim('10pt'),
        table: dim('10pt'), footnote: dim('8pt'), source: dim('7pt'),
      },
    },
    radius: { table: dim('3mm'), box: dim('3.5mm'), photo: dim('4mm'), pill: dim('999px') },
  };
}

export const PRESETS = Object.freeze({ pdi: pdiPreset, linkpilot: () => linkpilotPreset(), none: () => ({ color: {} }) });

// ── 토큰 → CSS 변수 ─────────────────────────────────────────
function walk(obj, path = [], out = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (k.startsWith('$')) continue;
    if (v && typeof v === 'object' && '$value' in v) out.push([[...path, k], v]);
    else if (v && typeof v === 'object') walk(v, [...path, k], out);
  }
  return out;
}

// 한글 등 글자와 숫자는 그대로 두고, 나머지 기호만 '-'로 바꿉니다
const cssName = (path) => '--ds-' + path.join('-').replace(/[^\p{L}\p{N}_-]/gu, '-').toLowerCase();
// 값이 :root 블록을 벗어나지 못하게 위험한 기호를 지웁니다
const cssSafe = (s) => String(s).replace(/[;{}<>\\\r\n]/g, '');

function cssValue(v) {
  const val = v.$value;
  if (typeof val === 'string') {
    const m = val.match(/^\{([^}]+)\}$/);
    if (m) return `var(${cssName(m[1].split('.'))})`;
    return cssSafe(val);
  }
  if (Array.isArray(val)) return val.map((f) => { const x = cssSafe(f).replace(/'/g, ''); return /\s/.test(x) ? `'${x}'` : x; }).join(', ');
  return cssSafe(val);
}

export function toCSS(tokens, { selector = ':root' } = {}) {
  const lines = walk(tokens).map(([p, v]) => `  ${cssName(p)}: ${cssValue(v)};`);
  return `/* ${ENGINE_META.name} ${ENGINE_META.rev} · updatedAt ${ENGINE_META.updatedAt} */\n${selector} {\n${lines.join('\n')}\n}\n`;
}

/** 경로로 토큰 값 읽기 (별칭은 끝까지 따라감) */
export function resolveToken(tokens, dotted, depth = 0) {
  if (depth > 10) throw new Error('별칭이 순환합니다: ' + dotted);
  let node = tokens;
  for (const k of dotted.split('.')) node = node && Object.prototype.hasOwnProperty.call(node, k) ? node[k] : undefined;
  if (!node || !('$value' in node)) return undefined;
  const m = typeof node.$value === 'string' && node.$value.match(/^\{([^}]+)\}$/);
  return m ? resolveToken(tokens, m[1], depth + 1) : node.$value;
}

// ── 토큰 검사 ───────────────────────────────────────────────
export function validateTokens(tokens, { preset } = {}) {
  const issues = [];
  for (const [p, v] of walk(tokens)) {
    const name = p.join('.');
    if (v.$type !== 'color') continue;
    let val;
    try { val = resolveToken(tokens, name); } catch (e) { issues.push(`${name}: ${e.message}`); continue; }
    if (val === undefined) { issues.push(`${name}: 별칭 대상이 없습니다`); continue; }
    if (isRgba(val)) continue;
    const hex6 = String(val).slice(0, 7);
    try { normHex(hex6); } catch { issues.push(`${name}: 색 코드 오류 ${val}`); continue; }
    if (preset === 'pdi') {
      const [h, s] = hexToHsl(hex6);
      if (h >= 190 && h <= 250 && s > 25) issues.push(`${name}: PDI 규칙상 파랑 계열은 쓰지 않습니다 (${hex6})`);
    }
  }
  if (preset === 'pdi') {
    const red = resolveToken(tokens, 'color.brand.red');
    const bg = resolveToken(tokens, 'color.surface.base');
    let ratio = 99;
    try { if (red && bg) ratio = contrastRatio(String(red).slice(0, 7), String(bg).slice(0, 7)); }
    catch { issues.push('color.brand.red 또는 color.surface.base 색 코드 오류'); }
    if (ratio < 4.5) issues.push('color.brand.red: 흰 배경 대비 4.5 미만');
  }
  return issues;
}

// ════════════════════════════════════════════════════════════
// 6) 보고서만들기 디자인·레이아웃 10종 고정 시스템
//    근거: LinkPilot_Design_Layout_10Systems_Work_Guide_v1.0 (2026-10-25)
// ════════════════════════════════════════════════════════════

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** 값의 출처 구분 (지침 10.1) — 실제 CSS 추출값, 사용자 지정, 신규 매핑, 미확인을 섞지 않습니다 */
export const VALUE_SOURCE = deepFreeze({
  CSS: 'css-extract',
  USER: 'user-spec',
  MAPPING: 'new-mapping',
  UNCONFIRMED: 'unconfirmed',
});

/** 플랫폼 CSS 원본 기록 (지침 부록 A). 이 엔진은 해시를 직접 대조하지 않았습니다 */
export const LP_CSS_SOURCE = deepFreeze({
  path: 'linkpilot-kind/linkpilot-platform.deploy.html',
  sha256: 'e51db3a007868cb13efb625a90d133432deef7bb30e5541030ab8d6be9c1623e',
  checkedAt: '2026-10-25',
  scope: 'local_snapshot',
  productionMatch: 'unverified',
  hashCheckedByEngine: false,
  externalStylesheet: { path: 'fonts/pretendard.css', status: VALUE_SOURCE.UNCONFIRMED },
  recordedFrom: 'LinkPilot_Design_Layout_10Systems_Work_Guide_v1.0 부록 A',
});

// [변수, 원문 선언값, 원본 행] — 부록 A 표를 그대로 옮겼습니다
const LP_VARS = [
  ['--lp-font', "Paperlogy,Cambria,-apple-system,'SF Pro Text',system-ui,'Apple SD Gothic Neo',Pretendard,sans-serif", 1286],
  ['--lp-ink', '#0A1419', 1287], ['--lp-ink-hover', '#2B3440', 1287], ['--lp-surface', '#FFFFFF', 1287],
  ['--lp-canvas', '#F2F2F7', 1287], ['--lp-surface-alt', '#F7F7FA', 1287],
  ['--lp-fill', 'rgba(120,120,128,.12)', 1288], ['--lp-fill-strong', '#E5E5EA', 1288],
  ['--lp-row-selected', '#EDEDF2', 1288], ['--lp-scrim', 'rgba(10,20,25,.36)', 1288],
  ['--lp-text-2', 'rgba(60,60,67,.78)', 1289], ['--lp-text-3', 'rgba(60,60,67,.73)', 1289], ['--lp-text-4', 'rgba(60,60,67,.57)', 1289],
  ['--lp-line', 'rgba(60,60,67,.16)', 1290], ['--lp-line-soft', 'rgba(60,60,67,.12)', 1290],
  ['--lp-line-strong', 'rgba(60,60,67,.3)', 1290], ['--lp-header-line', 'rgba(60,60,67,.2)', 1290],
  ['--lp-lime', '#AAE106', 1291], ['--lp-lime-hover', '#9BCE05', 1291], ['--lp-lime-ink', '#577508', 1291],
  ['--lp-lime-deep', '#3F5600', 1291], ['--lp-lime-tint', '#F0FAD8', 1291], ['--lp-lime-ring', 'rgba(170,225,6,.35)', 1291],
  ['--lp-danger', '#D70015', 1292], ['--lp-danger-tint', '#FFECEB', 1292], ['--lp-warn', '#B25000', 1292],
  ['--lp-warn-tint', '#FFF1DE', 1292], ['--lp-info', '#0063CC', 1292], ['--lp-info-tint', '#E6F0FF', 1292],
  ['--lp-r-card', '16px', 1293], ['--lp-r-panel', '14px', 1293], ['--lp-r-lg', '12px', 1293], ['--lp-r-btn', '10px', 1293],
  ['--lp-r-seg', '9px', 1293], ['--lp-r-sm', '8px', 1293], ['--lp-r-pill', '99px', 1293],
  ['--lp-h-btn', '40px', 1294], ['--lp-h-btn-lg', '44px', 1294], ['--lp-h-seg', '34px', 1294],
  ['--lp-h-seg-sm', '28px', 1294], ['--lp-h-tag', '22px', 1294],
  ['--lp-shadow-seg', '0 1px 3px rgba(0,0,0,.12),0 .5px 1px rgba(0,0,0,.08)', 1295],
  ['--lp-shadow-float', '0 1px 2px rgba(0,0,0,.1),0 0 0 1px rgba(60,60,67,.14)', 1296],
  ['--lp-shadow-dialog', '0 20px 60px rgba(0,0,0,.18),0 0 0 .5px rgba(60,60,67,.16)', 1297],
  ['--lp-brand', 'var(--lp-lime)', 1299], ['--lp-brand-deep', '#7BA10F', 1299], ['--lp-brand-soft', 'var(--lp-lime-tint)', 1299],
  ['--lp-brand-ink', 'var(--lp-ink)', 1299], ['--lp-navy', 'var(--lp-ink)', 1299],
  ['--lp-red', '#FF3B30', 1300], ['--lp-orange', '#FF9500', 1300], ['--lp-yellow', '#FFCC00', 1300],
  ['--lp-green', '#34C759', 1300], ['--lp-blue', '#007AFF', 1300], ['--lp-purple', '#AF52DE', 1300],
  ['--lp-surface-grouped', 'var(--lp-canvas)', 1301], ['--lp-surface-card', 'var(--lp-surface)', 1301],
  ['--lp-surface-glass', 'rgba(255,255,255,.94)', 1301],
  ['--lp-fill-3', 'var(--lp-fill)', 1302], ['--lp-hairline', 'var(--lp-line)', 1302], ['--lp-text-1', 'var(--lp-ink)', 1302],
];
export const LP_CSS_VARS = deepFreeze(LP_VARS.map(([name, value, line]) => ({ name, value, line })));
const LP_VAR_NAMES = new Set(LP_VARS.map((v) => v[0]));

const isRgba = (v) => /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/.test(String(v));

function linkpilotPreset() {
  const lp = {};
  const ext = (line) => ({ 'linkpilot.source': { kind: VALUE_SOURCE.CSS, line, file: LP_CSS_SOURCE.path } });
  for (const [name, value, line] of LP_VARS) {
    const key = name.replace(/^--lp-/, '');
    const alias = value.match(/^var\((--lp-[a-z0-9-]+)\)$/);
    let tok;
    if (alias) tok = { $type: null, $value: '{lp.' + alias[1].replace(/^--lp-/, '') + '}' };
    else if (name === '--lp-font') tok = { $type: 'fontFamily', $value: value.split(',').map((s) => s.trim().replace(/^'|'$/g, '')) };
    else if (/^#|^rgba?\(/.test(value)) tok = { $type: 'color', $value: value };
    else if (/^\d+(\.\d+)?px$/.test(value)) tok = { $type: 'dimension', $value: value };
    else tok = { $type: 'shadow', $value: value, $description: 'CSS box-shadow 원문' };
    lp[key] = { ...tok, $extensions: ext(line) };
  }
  for (const tok of Object.values(lp)) {
    if (tok.$type === null) {
      let t = tok, n = 0;
      while (t && t.$type === null && n++ < 10) t = lp[t.$value.slice(4, -1)];
      tok.$type = t ? t.$type : 'string';
    }
  }
  return { lp };
}

/** 글꼴 자산 기록 (지침 5.2·부록 A). 파일 배포·로딩·출력 임베딩은 아직 확인 전입니다 */
const unverified = () => ({ deployed: false, loaded: false, embedded: false });
export const FONT_ASSETS = deepFreeze([
  ...[[300, '3Light', 1277], [400, '4Regular', 1278], [500, '5Medium', 1279], [600, '6SemiBold', 1280], [700, '7Bold', 1281]]
    .map(([weight, n, line]) => ({
      family: 'Paperlogy', weight, file: `fonts/Paperlogy-${n}.woff2`, fontsource: null, sha256: null,
      source: VALUE_SOURCE.CSS, sourceLine: line, outputScope: null,
      fallback: ['var(--lp-font)'], verified: unverified(),
    })),
  { family: 'DIN Condensed', weight: 700, file: null, fontsource: null, sha256: null, source: VALUE_SOURCE.USER,
    status: '파일 필요 — Fontsource에 없음 (2026-10-25 조회 404)', outputScope: null,
    fallback: ['var(--lp-font)'], verified: unverified() },
  ...[['Bebas Neue', 400, 'bebas-neue'], ['Anton', 400, 'anton'], ['Roboto Condensed', 700, 'roboto-condensed'],
    ['Oswald', 700, 'oswald'], ['Montserrat', 800, 'montserrat']]
    .map(([family, weight, fs]) => ({
      family, weight, file: null, fontsource: fs, sha256: null, source: VALUE_SOURCE.USER, outputScope: null,
      fallback: ['var(--lp-font)'], verified: unverified(),
    })),
]);

// label 은 지침 표의 표기 그대로. weight 가 null 이면 굵기를 정하지 않습니다 (지침에 값 없음)
const F = (family, weight, label) => ({ family, weight, label });
const ROBOTO = F('Roboto Condensed', 700, 'Roboto Condensed Bold'), DIN = F('DIN Condensed', 700, 'DIN Condensed Bold'),
  PAPER = F('Paperlogy', null, 'Paperlogy');

/** 10개 고정 타입 (지침 3장). 추가·삭제·ID 재사용을 막기 위해 얼려 둡니다 */
export const DESIGN_TYPES = deepFreeze([
  { id: 'LP-DS-01', name: '기업표준 그리드형', layout: '제목·요약·본문·도표가 정돈된 기본 그리드', purpose: '기업소개·일반 보고·업무제안',
    fonts: { latinHeading: ROBOTO, displayNumber: ROBOTO },
    colorRefs: { text: '--lp-ink', background: '--lp-surface', accent: '--lp-lime-ink', accentFace: '--lp-lime-tint' },
    cover: '회사명·문서명·대표 사진·작성 기준일', body: '결론 요약을 먼저 놓고 설명·표·차트를 정렬',
    charts: '비교표·역할표·핵심 수치표', lastPage: '제안 요약·협의 요청·연락처',
    forbid: '페이지마다 다른 카드 모양·그림자·글꼴을 임의 적용하지 않음' },
  { id: 'LP-DS-02', name: '부동산·투자 IM형', layout: '투자 포인트·핵심 수치·사업구도·재무표', purpose: '부동산·지분투자·PF IM',
    fonts: { latinHeading: DIN, displayNumber: DIN },
    colorRefs: { text: '--lp-ink', background: '--lp-surface', accent: '--lp-info', accentFace: '--lp-info-tint' },
    cover: '본건 실제 사진 전체 흑백 배경, 사업명·투자요청 핵심 문구만 강조',
    body: '투자 포인트 → 사업개요 → 시장·입지 → 사업권·인허가 → 구조 → 재무 → 회수 → 제안 조건 (사업·투자 방식에 맞게 조정)',
    charts: '투자금 사용처·사업비·현금흐름·지분 및 자금구도·회수구조', lastPage: '투자 요청사항·협의 구조·담당 연락처',
    forbid: '투자규모·수익률·인허가·회수 가능성을 자료 없이 확정 문구로 만들지 않음' },
  { id: 'LP-DS-03', name: '사업계획 캔버스형', layout: '고객·사업모델·시장·운영·재무 모듈', purpose: '신규사업·사업확장 계획',
    fonts: { latinHeading: ROBOTO, displayNumber: ROBOTO },
    colorRefs: { text: '--lp-ink', background: '--lp-surface', accent: '--lp-lime-deep', accentFace: '--lp-lime-tint' },
    cover: '사업명·대상 고객·제공 가치', body: '고객·문제·해결방안·수익모델·사업 실행·파트너·비용·재무·성장계획 모듈',
    charts: '사업모델·가치사슬·수익 흐름·단계별 실행계획', lastPage: '실행 요청·자원 요청·의사결정 사항',
    forbid: '일반 모듈 배치를 특정 외부 표준 캔버스와 동일하다고 표기하지 않음' },
  { id: 'LP-DS-04', name: '공공·정책 보고형', layout: '번호 체계·목적·근거·추진계획·예산', purpose: '공공 제안·정책지원·기관 제출',
    fonts: { latinHeading: PAPER, displayNumber: PAPER },
    colorRefs: { text: '--lp-ink', background: '--lp-surface', face: '--lp-surface-alt', line: '--lp-line-strong' },
    cover: '문서명·제출기관·작성기관·기준일', body: '목적·근거·현황·추진내용·일정·예산·기대효과·결정사항',
    charts: '예산표·업무분장표·추진일정·정책 연계표', lastPage: null,
    forbid: '기관 제출 양식이 있으면 고정 레이아웃으로 필수 항목을 누락시키지 않음' },
  { id: 'LP-DS-05', name: '데이터분석 대시보드형', layout: '지표 카드·비교 차트·근거 표·해석', purpose: '시장조사·사업성·실적 보고',
    fonts: { latinHeading: ROBOTO, displayNumber: ROBOTO },
    colorRefs: { text: '--lp-ink', accent: '--lp-info', accentFace: '--lp-info-tint', face: '--lp-surface-alt' },
    cover: '분석 주제·지역·대상 기간', body: '결론 → 핵심 지표 → 비교·추세 → 근거 → 실행·결정',
    charts: '비교는 막대, 시간 변화는 선, 구성비는 구성 차트. 차트마다 제목·단위·기간·출처', lastPage: null,
    forbid: '서로 다른 통화·기간·분모를 설명 없이 한 차트에 합치지 않음' },
  { id: 'LP-DS-06', name: '인프라·사업구도형', layout: '큰 사업구도·참여자 역할·지도·자금 흐름', purpose: '인프라·에너지·개발사업',
    fonts: { latinHeading: DIN, displayNumber: DIN },
    colorRefs: { text: '--lp-ink', accent: '--lp-lime-deep', accentFace: '--lp-lime-tint', face: '--lp-info-tint' },
    cover: '대상 시설·사업지 실제 사진과 사업명', body: '사업구도·입지·수요·인허가·기술·자금 흐름·추진 체계',
    charts: '참여자 관계·SPC/JV·자금조달·계약 구조·시설 연결 (Figma 도식). 지도는 필지·도로·진입로를 별도 레이어로',
    lastPage: null,
    forbid: '계약관계·자금 흐름·물리적 시설 연결선을 같은 의미의 선으로 혼용하지 않음' },
  { id: 'LP-DS-07', name: '로드맵·추진일정형', layout: '단계·일정·역할·의사결정 시점', purpose: '프로젝트 진행·실행계획',
    fonts: { latinHeading: ROBOTO, displayNumber: ROBOTO },
    colorRefs: { text: '--lp-ink', progress: '--lp-info', scheduleWarn: '--lp-warn', background: '--lp-surface' },
    cover: '프로젝트명·추진 기간·현재 단계', body: '단계별 목표·일정·참여자 역할·선행조건·의사결정 시점',
    charts: '타임라인·간트·단계별 산출물·역할분담표', lastPage: null,
    forbid: '미정 일정을 임의 날짜로 채우거나 계획을 완료 실적으로 표시하지 않음' },
  { id: 'LP-DS-08', name: '분양·프로모션형', layout: '상품 이미지·가격·조건·핵심 혜택', purpose: '분양·가격 안내·프로모션',
    fonts: { price: F('Bebas Neue', 400, 'Bebas Neue'), event: F('Anton', 400, 'Anton') },
    colorRefs: { text: '--lp-ink', price: '--lp-lime-deep', event: '--lp-warn', eventFace: '--lp-warn-tint' },
    cover: '회원 프로필의 사진·로고, 흑백 전체 사진과 부분 컬러', body: '상품·시설·분양/가격 조건·적용 대상·유효기간·문의',
    charts: '가격 구성·공급 조건·면적·일정·상품 비교', lastPage: null,
    forbid: '근거 없는 할인율·가격 우위·판매 실적·잔여 수량 생성 금지. 이벤트 면을 본문 전체로 확장 금지' },
  { id: 'LP-DS-09', name: '사진·브로슈어형', layout: '선명한 사진·짧은 설명·위치·주요 특징', purpose: '시설소개·브로슈어·사업소개',
    fonts: { latinHeading: F('Oswald', 700, 'Oswald Bold'), displayNumber: F('Oswald', 700, 'Oswald Bold') },
    colorRefs: { text: '--lp-ink', background: '--lp-surface', face: '--lp-surface-alt', accent: '--lp-lime-ink' },
    cover: '선명한 실제 사진 전체 배경 (회원 표지는 흑백 + 부분 컬러)', body: '사진과 설명을 교차 배치, 시설 특징·위치·사용 장면',
    charts: '면적·시설·접근성·상품 특징 등 필요한 정보만', lastPage: null,
    forbid: '생성 이미지나 다른 시설 사진을 본건 실제 사진으로 표시하지 않음' },
  { id: 'LP-DS-10', name: '프리미엄 투자제안형', layout: '넓은 여백·흑백 사진·핵심 문구·절제된 도표', purpose: '고급 투자제안·주요 투자자 제안',
    fonts: { latinHeading: F('Montserrat', 800, 'Montserrat ExtraBold'), displayNumber: F('Montserrat', 800, 'Montserrat ExtraBold') },
    colorRefs: { text: '--lp-ink', chapterFace: '--lp-ink-hover', background: '--lp-surface', accent: '--lp-lime-ink' },
    cover: '전체 흑백 사진·절제된 제목·부분 컬러 포인트', body: '큰 여백·짧은 핵심 문장·선택한 수치·정제된 도표',
    charts: '선택한 수치만 정제된 도표로', lastPage: '옅은 흑색 면 + 일관된 로고 규칙',
    forbid: '작은 글씨·읽기 어려운 사진 위 본문·과도한 장식 금지' },
]);
const TYPE_BY_ID = new Map(DESIGN_TYPES.map((t) => [t.id, t]));

/** 공통 매핑 (지침 6.2) — 챕터·마지막 페이지의 옅은 흑색 면 후보. 실측값이 아닙니다 */
export const COMMON_MAPPINGS = deepFreeze({
  chapterFace: { ref: '--lp-ink-hover', value: '#2B3440', source: VALUE_SOURCE.MAPPING, note: '현행 IM 챕터 배경 실측값 아님' },
});

/** 표 규칙 (지침 7.1) — 문자·숫자·일자 모두 좌측 정렬, 10pt, 1줄 원칙·최대 2줄, 글자 축소 금지 */
export const TABLE_RULES = deepFreeze({
  align: 'left', fontSize: '10pt', preferredLines: 1, maxLines: 2, shrinkText: false,
  overMaxLines: '표를 나누거나 내용을 본문·각주로 옮김', emptyCell: '공란 유지 (0으로 바꾸지 않음)',
  emphasis: { background: 'accentFace 또는 face 역할 색', fontWeight: 600 },
  source: VALUE_SOURCE.USER,
});

export function getDesignType(id) {
  const t = TYPE_BY_ID.get(id);
  if (!t) throw new Error(`없는 디자인 타입입니다: ${id} (LP-DS-01 ~ LP-DS-10만 쓸 수 있습니다)`);
  return t;
}

/** 관리자 설정 (지침 4.3) — 노출 순서·사용 여부·버전만 바꾸고, 타입 자체는 늘리거나 줄이지 않습니다 */
const ADMIN_KEYS = new Set(['order', 'enabled', 'version', 'supportedDocs', 'outputFormats', 'preview']);
export function createTypeRegistry(input = {}) {
  const settings = structuredClone(input || {}); // 만든 뒤 바깥에서 고쳐도 반영되지 않게 복사
  for (const [id, s] of Object.entries(settings)) {
    if (!TYPE_BY_ID.has(id)) throw new Error(`새 타입은 추가할 수 없습니다: ${id}`);
    for (const k of Object.keys(s || {})) if (!ADMIN_KEYS.has(k)) throw new Error(`${id}: 관리자가 바꿀 수 없는 항목입니다 (${k})`);
    if ('enabled' in s && typeof s.enabled !== 'boolean') throw new Error(`${id}: enabled는 true/false`);
    if ('order' in s && !Number.isFinite(s.order)) throw new Error(`${id}: order는 숫자`);
    if ('version' in s && !SEMVER.test(String(s.version))) throw new Error(`${id}: version은 1.0.0 형식`);
  }
  deepFreeze(settings);
  const conf = (id) => ({ order: DESIGN_TYPES.findIndex((t) => t.id === id) + 1, enabled: true, version: '1.0.0', ...(settings[id] || {}) });
  return Object.freeze({
    /** 신규 문서 선택 화면용 — 사용 중지 타입은 빠집니다 */
    forNewDocument: () => DESIGN_TYPES.map((t) => ({ ...t, ...conf(t.id) })).filter((t) => t.enabled).sort((a, b) => a.order - b.order),
    /** 기존 문서는 사용 중지 후에도 원래 버전으로 엽니다 */
    canOpen: (record) => TYPE_BY_ID.has(record && record.type_id),
    settingsOf: (id) => (getDesignType(id), conf(id)),
  });
}

const fontStack = (f) => (f.family === 'Paperlogy' ? 'var(--lp-font)' : `${/\s/.test(f.family) ? `'${f.family}'` : f.family}, var(--lp-font)`);
const BODY_STACK = 'var(--lp-font)';
const SAFE_SCOPE = /^[A-Za-z0-9_\-.#\s\[\]="'>:()]+$/;

/** 글꼴 역할을 쓸 요소에 붙일 속성 (플랫폼의 Paperlogy 강제 규칙을 요소 단위로 비켜 갑니다) */
export function fontRoleAttrs(role) {
  if (!/^[a-zA-Z]+$/.test(String(role))) throw new Error('글꼴 역할 이름이 올바르지 않습니다');
  return `data-lp-font-role="${role}" data-lp-font-keep`;
}

/**
 * 타입별 문서 출력 CSS (출력 영역 .lp-doc[data-lp-ds] 안에서만 적용)
 * - 색: 플랫폼 변수 var(--lp-*)를 역할 이름으로 연결
 * - 글자 크기: 사용자 지정 7단계 (PDI 프리셋과 같은 값 재사용)
 * - 표: 전부 좌측 정렬, 10pt, 강조 칸 배경+굵게
 * - 영문 역할 글꼴: data-lp-font-keep 이 붙은 요소에만 (자식 요소에는 상속되지 않음에 주의)
 */
export function documentCSS(typeId, { scope } = {}) {
  const t = getDesignType(typeId);
  if (scope !== undefined && (typeof scope !== 'string' || !SAFE_SCOPE.test(scope) || /[{};@]/.test(scope))) throw new Error('scope 선택자가 올바르지 않습니다');
  const sel = scope || `.lp-doc[data-lp-ds="${t.id}"]`;
  const sizes = pdiPreset().font.size;
  const roleVars = Object.entries(t.colorRefs).map(([r, v]) => `  --ds-role-${r.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: var(${v});`);
  const sizeVars = Object.entries(sizes).map(([k, v]) => `  --ds-size-${k}: ${v.$value};`);
  const em = t.colorRefs.accentFace || t.colorRefs.face || t.colorRefs.eventFace || '--lp-surface-alt';
  const fontRules = Object.entries(t.fonts).map(([role, f]) =>
    `${sel} [data-lp-font-role="${role}"][data-lp-font-keep] { font-family: ${fontStack(f)};${f.weight ? ` font-weight: ${f.weight};` : ''} }`);
  return [
    `/* ${ENGINE_META.name} ${ENGINE_META.rev} · ${t.id} ${t.name} · updatedAt ${ENGINE_META.updatedAt} */`,
    `${sel} {`, ...roleVars, `  --ds-role-chapter-face: var(${COMMON_MAPPINGS.chapterFace.ref});`, ...sizeVars,
    `  color: var(--ds-role-text); font-family: ${BODY_STACK}; font-size: var(--ds-size-body);`, `}`,
    `${sel} table, ${sel} th, ${sel} td { text-align: left; font-size: ${TABLE_RULES.fontSize}; }`,
    `${sel} td.lp-em, ${sel} th.lp-em, ${sel} tr.lp-em > td { background: var(${em}); font-weight: ${TABLE_RULES.emphasis.fontWeight}; }`,
    // 챕터 면 위 글자색은 지침에 값이 없어 정하지 않았습니다
    `${sel} .lp-chapter, ${sel} .lp-last-page { background: var(--ds-role-chapter-face); }`,
    ...fontRules,
  ].join('\n') + '\n';
}

/** 타입에 필요한 영문 글꼴 @font-face (Fontsource) + Paperlogy 로컬 파일 @font-face */
export async function fontFacesForType(typeId, { fetch, paperlogyBase = '' } = {}) {
  const t = getDesignType(typeId);
  const parts = [], warnings = [];
  for (const a of FONT_ASSETS.filter((x) => x.family === 'Paperlogy')) {
    parts.push(`@font-face {\n  font-family: 'Paperlogy';\n  font-weight: ${a.weight};\n  font-display: swap;\n  src: url(${paperlogyBase}${a.file}) format('woff2');\n}`);
  }
  const seen = new Set();
  for (const f of Object.values(t.fonts)) {
    if (f.family === 'Paperlogy' || seen.has(f.family)) continue;
    seen.add(f.family);
    const asset = FONT_ASSETS.find((a) => a.family === f.family);
    if (!asset || !asset.fontsource) { warnings.push(`${f.family}: ${asset ? asset.status : '자산 기록 없음'} — 대체 글꼴 ${asset ? asset.fallback[0] : 'Paperlogy'}로 표시`); continue; }
    try {
      const font = await getFont(asset.fontsource, { fetch });
      const has = (font.weights || []).includes(f.weight);
      const w = has ? f.weight : (font.weights || [400]).slice(-1)[0];
      if (!has) warnings.push(`${f.family}: ${f.weight} 굵기가 없어 ${w}로 대체`);
      const css = fontFaceCSS(font, { weights: [w], subset: 'all' });
      if (!css) throw new Error('글꼴 파일 주소가 없습니다');
      parts.push(css);
    } catch (e) { warnings.push(`${f.family}: Fontsource 응답 실패 (${e.message})`); }
  }
  return { css: parts.join('\n'), warnings };
}

/** 관리 레코드 (지침 10.2) — 확인 안 된 자산은 null 또는 빈 목록으로 둡니다 */
const OUTPUT_FORMATS = new Set(['pdf', 'html', 'pptx', 'docx']);
const SEMVER = /^\d+\.\d+\.\d+$/;
export function createDesignRecord({ typeId, typeVersion = '1.0.0', companyProfileId = null, outputFormat = null, layoutVariant = null } = {}) {
  const t = getDesignType(typeId);
  if (!SEMVER.test(String(typeVersion))) throw new Error('typeVersion은 1.0.0 형식이어야 합니다');
  if (outputFormat !== null && !OUTPUT_FORMATS.has(outputFormat)) throw new Error(`지원 목록에 없는 출력 형식입니다: ${outputFormat}`);
  const fro = {};
  for (const [role, f] of Object.entries(t.fonts)) {
    if (role === 'displayNumber') continue; // 지침 예시에 없는 키
    fro[role.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())] = f.label;
  }
  fro.body = 'Paperlogy';
  return {
    type_id: t.id, type_version: typeVersion, type_name: t.name, company_profile_id: companyProfileId,
    source_css_path: LP_CSS_SOURCE.path, source_css_sha256: LP_CSS_SOURCE.sha256, source_scope: LP_CSS_SOURCE.scope,
    css_token_refs: [...new Set(Object.values(t.colorRefs))], layout_variant: layoutVariant,
    font_role_overrides: fro, logo_asset_refs: [], figma_asset_refs: [], map_scene_refs: [],
    output_format: outputFormat, enabled: false,
  };
}

export function validateDesignRecord(r) {
  const issues = [];
  if (!r || typeof r !== 'object') return ['레코드가 없습니다'];
  const t = TYPE_BY_ID.get(r.type_id);
  if (!t) issues.push(`type_id: 10종에 없는 값 (${r.type_id})`);
  else if (r.type_name !== t.name) issues.push(`type_name: ${t.id}의 이름은 「${t.name}」`);
  if (!SEMVER.test(String(r.type_version))) issues.push('type_version: 1.0.0 형식이어야 합니다');
  if (!Array.isArray(r.css_token_refs) || !r.css_token_refs.length) issues.push('css_token_refs: 비어 있지 않은 목록이어야 합니다');
  else {
    const allowed = t ? new Set(Object.values(t.colorRefs)) : null;
    for (const ref of r.css_token_refs) {
      if (!LP_VAR_NAMES.has(ref)) issues.push(`css_token_refs: 부록 A에 없는 변수 ${ref}`);
      else if (allowed && !allowed.has(ref)) issues.push(`css_token_refs: ${t.id}의 컬러 참조가 아님 ${ref}`);
    }
  }
  if (r.output_format !== null && !OUTPUT_FORMATS.has(r.output_format)) issues.push(`output_format: ${r.output_format}`);
  if (typeof r.enabled !== 'boolean') issues.push('enabled: true/false');
  for (const k of ['logo_asset_refs', 'figma_asset_refs', 'map_scene_refs']) if (!Array.isArray(r[k])) issues.push(`${k}: 목록이어야 합니다`);
  return issues;
}

/**
 * 문서 타입 변경 (지침 4.2) — 배치·스타일만 바꾸고 내용(content)은 그대로 둡니다.
 * 이전 디자인은 history에 쌓여 되돌릴 수 있습니다.
 */
const clone = (x) => (x == null ? x : structuredClone(x));
export function changeDocumentType(doc, typeId, { typeVersion } = {}) {
  if (!doc || typeof doc !== 'object') throw new Error('문서가 없습니다');
  getDesignType(typeId);
  const prev = doc.design;
  if (prev && prev.type_id === typeId && (!typeVersion || typeVersion === prev.type_version)) return doc; // 같은 타입이면 기록하지 않음
  const next = createDesignRecord({
    typeId, typeVersion: typeVersion || '1.0.0',
    companyProfileId: prev ? prev.company_profile_id : null, outputFormat: prev ? prev.output_format : null,
  });
  if (prev) {
    for (const k of ['logo_asset_refs', 'figma_asset_refs', 'map_scene_refs']) next[k] = [...(prev[k] || [])];
    next.enabled = typeof prev.enabled === 'boolean' ? prev.enabled : false;
    // layout_variant 는 이전 타입에 속한 값이라 새 타입에서는 비웁니다 (되돌리면 복원)
  }
  return { ...doc, design: next, history: [...(doc.history || []).map(clone), clone(prev)].filter(Boolean) };
}
export function undoDocumentType(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('문서가 없습니다');
  const h = doc.history || [];
  if (!h.length) return doc;
  return { ...doc, design: clone(h[h.length - 1]), history: h.slice(0, -1).map(clone) };
}

/** 회사별 변형 (지침 3장·4.2) — 원본 타입 ID·버전을 유지하고, 개정은 새 버전으로만 */
const SAFE_VALUE = (v) => /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/.test(v) || isRgba(v) || /^\d+(\.\d+)?px$/.test(v) || /^var\(--lp-[a-z0-9-]+\)$/.test(v);
function checkOverrides(overrides) {
  for (const [k, v] of Object.entries(overrides || {})) {
    if (!LP_VAR_NAMES.has(k)) throw new Error(`회사 변형은 부록 A 변수만 바꿀 수 있습니다: ${k}`);
    if (!SAFE_VALUE(String(v))) throw new Error(`${k}: 색(#RRGGBB·rgba), px, var(--lp-*) 값만 쓸 수 있습니다`);
  }
}
export function createCompanyVariant(typeId, { typeVersion = '1.0.0', companyProfileId, overrides = {} } = {}) {
  getDesignType(typeId);
  if (!SEMVER.test(String(typeVersion))) throw new Error('typeVersion은 1.0.0 형식이어야 합니다');
  if (!companyProfileId) throw new Error('회사 프로필이 필요합니다');
  checkOverrides(overrides);
  return deepFreeze({ base_type_id: typeId, base_type_version: typeVersion, company_profile_id: companyProfileId, variant_version: '1.0.0', overrides: { ...overrides } });
}
export function reviseCompanyVariant(v, overrides = {}) {
  if (!v || !SEMVER.test(String(v.variant_version))) throw new Error('회사 변형 버전이 올바르지 않습니다');
  const [a, b, c] = v.variant_version.split('.').map(Number);
  checkOverrides(overrides);
  return deepFreeze({ ...v, variant_version: `${a}.${b + 1}.${c}`, overrides: { ...v.overrides, ...overrides } });
}

/** 지도 레이어 (지침 8.2) — 색은 아직 정하지 않았으므로 비워 둡니다 */
export const MAP_LAYERS = deepFreeze([
  { id: 'base', name: '일반지도', shows: '주변 도로·시설·지역 맥락', color: null },
  { id: 'satellite', name: '위성지도', shows: '사업지·주변의 실제 공간 모습', color: null, requires: ['captureDate'] },
  { id: 'cadastral', name: '지적도', shows: '대상지와 인접 필지 경계·지번', color: null, requires: ['dataSource'] },
  { id: 'subject', name: '본건 강조', shows: '대상 필지 폴리곤·지번·범례', color: null, requires: ['parcelId'] },
  { id: 'road', name: '도로 강조', shows: '도로 부분·도로 필지·접면 구간', color: null },
  { id: 'access', name: '진입로 구상', shows: '대상지에서 도로까지 연결할 후보 필지', color: null },
]);
/** 접면(도형이 닿음)과 권원(쓸 권리)은 별개 — 원문이 있어야 「원문 확인」 */
export const ACCESS_RIGHT_STATUS = deepFreeze(['근거 부재', '원문 확인']);

export function validateMapScene(scene) {
  if (!scene || typeof scene !== 'object') return ['지도 장면 정보가 없습니다'];
  const issues = [];
  const colors = scene.colors || {};
  const norm = [];
  for (const k of ['subject', 'road', 'access']) {
    if (!colors[k]) continue;
    try { norm.push(normHex(colors[k])); } catch { issues.push(`${k} 색은 #RRGGBB 형식이어야 합니다`); }
  }
  if (['subject', 'road', 'access'].some((k) => !colors[k])) issues.push('본건·도로·진입로 색이 아직 정해지지 않았습니다');
  if (new Set(norm).size !== norm.length) issues.push('본건·도로·진입로 색이 서로 같습니다');
  if (!scene.crs) issues.push('좌표계(crs)가 없습니다');
  for (const k of ['geometryVersion', 'queriedAt', 'extent', 'designVersion', 'attribution']) if (!scene[k]) issues.push(`재현 기록 누락: ${k}`);
  const known = new Map(MAP_LAYERS.map((l) => [l.id, l]));
  if (!Array.isArray(scene.layers) || !scene.layers.length) issues.push('재현 기록 누락: layers (목록)');
  else for (const id of scene.layers) {
    const l = known.get(id);
    if (!l) { issues.push(`알 수 없는 레이어: ${id}`); continue; }
    for (const req of l.requires || []) if (!scene[req]) issues.push(`${l.name}: ${req} 필요`);
  }
  for (const c of scene.accessCandidates || []) {
    if (!c || typeof c !== 'object') { issues.push('진입로 후보 정보가 비어 있습니다'); continue; }
    if (!ACCESS_RIGHT_STATUS.includes(c.rightStatus)) issues.push(`진입로 ${c.parcel}: 권원 상태는 「근거 부재」 또는 「원문 확인」`);
    const ev = Array.isArray(c.evidence) ? c.evidence.filter((x) => typeof x === 'string' && x.trim()) : [];
    if (c.rightStatus === '원문 확인' && !ev.length) issues.push(`진입로 ${c.parcel}: 원문 확인에는 계약·등기·사용승낙 근거 목록이 필요합니다`);
  }
  return issues;
}

// ── 깊은 병합 (Figma 토큰을 프리셋 위에 덮어쓸 때) ─────────
function merge(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (UNSAFE_KEYS.has(k) || k === '$extensions') continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && !('$value' in v)) {
      target[k] = target[k] && typeof target[k] === 'object' ? target[k] : {};
      merge(target[k], v);
    } else target[k] = v;
  }
  return target;
}

// ── 엔진 진입점 ─────────────────────────────────────────────
/**
 * @param {object} o
 * @param {'pdi'|'none'} [o.preset='pdi']      시작 프리셋
 * @param {string} [o.seed]                       기준 색 (예: '#C00000') → 배색·단계색 추가
 * @param {string} [o.scheme='monochrome']        The Color API 배색 방식
 * @param {number} [o.count=5]                    배색 색 개수
 * @param {string} [o.iconQuery]                  아이콘 검색어 (예: 'handshake')
 * @param {string} [o.iconPrefix]                 아이콘 세트 (예: 'mdi', 'lucide')
 * @param {number} [o.iconLimit=12]
 * @param {object} [o.fontFilter]                 Fontsource 조건 (예: { subsets: 'korean' })
 * @param {object} [o.figma]                      { fileKey, token } — 서버에서만
 * @param {Function} [o.fetch]                    테스트용 fetch 주입
 */
export async function createDesignSystem(o = {}) {
  const {
    preset = 'pdi', seed, scheme = 'monochrome', count = 5,
    iconQuery, iconPrefix, iconLimit = 12, fontFilter, figma, fetch, designType,
  } = o;
  if (designType) getDesignType(designType);
  if (!Object.prototype.hasOwnProperty.call(PRESETS, preset)) throw new Error(`없는 프리셋입니다: ${preset}`);

  const tokens = PRESETS[preset]();
  const sources = [preset === 'none' ? null : preset === 'linkpilot' ? 'linkpilot-css' : preset].filter(Boolean);
  const warnings = [];

  if (seed) {
    const r = await colorScheme(seed, { mode: scheme, count, fetch });
    sources.push(r.source);
    if (r.error) warnings.push(`색 API 응답 실패로 내부 계산 사용: ${r.error}`);
    tokens.color.scheme = {};
    r.colors.forEach((hex, i) => { tokens.color.scheme[String(i + 1)] = { $type: 'color', $value: hex }; });
    tokens.color.seed = {};
    for (const [k, hex] of Object.entries(tonalScale(seed))) tokens.color.seed[k] = { $type: 'color', $value: hex };
  }

  if (figma && figma.fileKey) {
    try {
      const v = await figmaVariables(figma.fileKey, { token: figma.token, fetch });
      const ft = figmaVariablesToTokens(v);
      const skipped = (ft.$extensions && ft.$extensions['linkpilot.skipped']) || [];
      skipped.forEach((x) => warnings.push(`Figma 변수 건너뜀: ${x}`));
      merge(tokens, ft);
      sources.push('figma');
    } catch (e) { warnings.push(`Figma: ${e.message}`); }
  }

  let icons = [];
  if (iconQuery) {
    try {
      const ids = await searchIcons(iconQuery, { prefix: iconPrefix, limit: iconLimit, fetch });
      const tint = resolveToken(tokens, 'color.text.body');
      icons = ids.map((id) => ({ id, svgUrl: iconSvgUrl(id, tint ? { color: tint } : {}) }));
      sources.push('iconify');
    } catch (e) { warnings.push(`Iconify: ${e.message}`); }
  }

  let fonts = [];
  if (fontFilter) {
    try {
      fonts = (await findFonts(fontFilter, { fetch })).map((f) => ({ id: f.id, family: f.family, weights: f.weights, category: f.category }));
      sources.push('fontsource');
    } catch (e) { warnings.push(`Fontsource: ${e.message}`); }
  }

  const checks = validateTokens(tokens, { preset });
  const design = designType
    ? { type: getDesignType(designType), record: createDesignRecord({ typeId: designType }), documentCss: documentCSS(designType) }
    : null;
  return {
    design,
    meta: { ...ENGINE_META, builtAt: new Date().toISOString(), sources },
    tokens,
    css: toCSS(tokens),
    icons,
    fonts,
    warnings: [...warnings, ...checks],
  };
}

// ── LinkPilot 엔진 연결용 플러그인 규격 ─────────────────────
// 엔진은 describe()로 기능을 확인하고 run(입력)으로 실행합니다.
export const linkpilotPlugin = Object.freeze({
  id: 'design-system',
  title: '디자인 시스템',
  describe: () => ({ ...ENGINE_META, sources: SOURCES, presets: Object.keys(PRESETS),
    designTypes: DESIGN_TYPES.map((t) => ({ id: t.id, name: t.name, purpose: t.purpose })) }),
  run: (input = {}) => createDesignSystem(input),
});

// ── NAS 서버용 요청 처리 (GET /design-system?seed=C00000&icons=handshake) ──
export async function handleRequest(urlString, { fetch } = {}) {
  let u;
  try { u = new URL(String(urlString || '/'), 'http://localhost'); }
  catch { return { status: 400, body: { error: '주소 형식이 올바르지 않습니다' } }; }
  if (u.pathname === '/design-system/describe') return { status: 200, body: linkpilotPlugin.describe() };
  if (u.pathname === '/design-system/types') return { status: 200, body: DESIGN_TYPES };
  if (u.pathname === '/design-system/document-css') {
    try { return { status: 200, body: documentCSS(u.searchParams.get('type')), type: 'text/css; charset=utf-8' }; }
    catch (e) { return { status: 400, body: { error: e.message } }; }
  }
  if (u.pathname !== '/design-system') return { status: 404, body: { error: 'not found' } };
  const q = u.searchParams;
  try {
    const ds = await createDesignSystem({
      preset: q.get('preset') || 'pdi',
      seed: q.get('seed') ? '#' + q.get('seed').replace(/^#/, '') : undefined,
      scheme: q.get('scheme') || undefined,
      count: q.get('count') ? Number(q.get('count')) : undefined,
      iconQuery: q.get('icons') || undefined,
      iconPrefix: q.get('iconPrefix') || undefined,
      fontFilter: q.get('fontSubset') ? { subsets: q.get('fontSubset') } : undefined,
      designType: q.get('type') || undefined,
      fetch,
    });
    if (q.get('format') === 'css') return { status: 200, body: ds.css, type: 'text/css; charset=utf-8' };
    return { status: 200, body: ds };
  } catch (e) {
    return { status: 400, body: { error: String(e.message || e) } };
  }
}

/** node design-system-engine.js serve 8787 */
export async function serve(port = 8787) {
  const http = await import('node:http');
  const server = http.createServer(async (req, res) => {
    let r;
    try { r = await handleRequest(req.url); }
    catch (e) { r = { status: 500, body: { error: '엔진 내부 오류' } }; }
    try {
      const isText = typeof r.body === 'string';
      res.writeHead(r.status, { 'Content-Type': r.type || 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(isText ? r.body : JSON.stringify(r.body, null, 2));
    } catch { try { res.destroy(); } catch {} }
  });
  server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {} });
  server.listen(port);
  return server;
}

if (typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'serve') serve(Number(arg) || 8787).then(() => console.log(`디자인 시스템 엔진 대기 중: http://localhost:${Number(arg) || 8787}/design-system`));
  else createDesignSystem({ preset: 'pdi' }).then((ds) => process.stdout.write(ds.css));
}
