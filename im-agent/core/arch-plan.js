'use strict';
/**
 * arch-plan.js — 통합엔진의 단위세대 평면을 «디자인 A·B·C» 세 가지 모양으로 그린다 (CLAUDE.md §28)
 * 〈2026-10-27 사장님: 「AI 건축설계·법규·인허가 통합엔진 내에서 디자인 도면은 A,B,C 3가지 디자인 타입으로 선택할수 있도록」 + 참고 평면 세 장〉
 *
 *   A 라인 도면형 — 흰 바탕 · 굵은 검은 벽 · 문 열림 호 · 작은 실명(국문·영문) · 현관 화살표  (참고 1)
 *   B 치수 컬러형 — 실별 바닥색 · 바깥 치수선 두 단(mm) · 실마다 ㎡·평                       (참고 2)
 *   C 홍보형     — 베이지 바닥 · 회색 벽 · 아래 타입 이름 · 강조 구역 상자(자료에 있을 때만)     (참고 3)
 *
 * ★ 세 모양은 «같은 세대 자료»를 그린다 — 모양을 바꿔도 치수·면적·실 배치는 한 글자도 안 바뀐다(지침 §10 설계 데이터 일원화).
 * ★ 도면은 치수를 가진 벡터(SVG · mm 단위)에서 그리고, 글자는 그림 생성에 맡기지 않는다(지침 §9 · §12-6).
 * ★ 참고 그림의 상표·워터마크(liSQUARE · NHN · NEWSIS)는 옮기지 않는다 — 모양의 결만 따른다.
 * ★ 지금 세대 자료는 «개념 템플릿»이다(84㎡형·59㎡형 · 벽체 중심선 기준). 실제 평면이 오면 같은 함수로 그 자료를 그린다.
 *   모든 그림 아래에 «개념 템플릿 · 설계도서 아님»을 박는다 — 기본설계 검토도서를 완성본으로 표시하지 않는다(지침 §9).
 */

const PY = 3.305785; // 1평 = 3.305785㎡
const STYLES = {
  A: { id: 'A', name: '라인 도면형', ref: '참고 평면 1 (흑백 선 도면)' },
  B: { id: 'B', name: '치수 컬러형', ref: '참고 평면 2 (마감색 + 치수선)' },
  C: { id: 'C', name: '홍보형', ref: '참고 평면 3 (베이지 바닥 + 타입 이름)' },
};
const EN = { 거실: 'LIVING', 주방: 'KITCHEN', '주방/식당': 'KITCHEN', 안방: 'MASTER', 침실2: 'ROOM 2', 침실3: 'ROOM 3', 공용욕실: 'BATH 1', 안방욕실: 'BATH 2', 현관: 'ENT', 드레스룸: 'DRESS', 다용도실: 'UTILITY', 발코니: 'BALCONY' };

/* 개념 템플릿 — 방 사각형이 외곽을 빈틈없이 덮게 짰다(면적 합 = 외곽 면적). x 오른쪽 · y 아래(남쪽 = 앞) · mm */
const TEMPLATES = {
  84: {
    type: 84, label: '전용 84㎡형', w: 11200, d: 7500, balcony: 1500,
    rooms: [
      { name: '침실3', kind: 'bed', x: 0, y: 0, w: 2900, h: 3300 },
      { name: '현관', kind: 'ent', x: 2900, y: 0, w: 1700, h: 1300 },
      { name: '공용욕실', kind: 'bath', x: 2900, y: 1300, w: 1700, h: 2000 },
      { name: '주방/식당', kind: 'living', x: 4600, y: 0, w: 2400, h: 3300 },
      { name: '안방욕실', kind: 'bath', x: 7000, y: 0, w: 1800, h: 2000 },
      { name: '드레스룸', kind: 'util', x: 7000, y: 2000, w: 1800, h: 1300 },
      { name: '다용도실', kind: 'util', x: 8800, y: 0, w: 2400, h: 3300 },
      { name: '침실2', kind: 'bed', x: 0, y: 3300, w: 2900, h: 4200 },
      { name: '거실', kind: 'living', x: 2900, y: 3300, w: 4100, h: 4200 },
      { name: '안방', kind: 'bed', x: 7000, y: 3300, w: 4200, h: 4200 },
    ],
    doors: [
      { room: '현관', side: 'N', at: 400 }, { room: '현관', side: 'E', at: 200 },
      { room: '침실3', side: 'S', at: 2000 }, { room: '공용욕실', side: 'S', at: 400 }, { room: '침실2', side: 'N', at: 2000 },
      { room: '안방', side: 'N', at: 2300 }, { room: '안방욕실', side: 'S', at: 300 }, { room: '다용도실', side: 'W', at: 2300 },
    ],
    entry: { room: '현관', side: 'N' },
    windows: [{ room: '침실3', side: 'N' }, { room: '주방/식당', side: 'N' }, { room: '침실2', side: 'S' }, { room: '거실', side: 'S' }, { room: '안방', side: 'S' }, { room: '다용도실', side: 'N' }],
  },
  59: {
    type: 59, label: '전용 59㎡형', w: 8700, d: 6800, balcony: 1300,
    rooms: [
      { name: '침실3', kind: 'bed', x: 0, y: 0, w: 2700, h: 2900 },
      { name: '주방/식당', kind: 'living', x: 2700, y: 0, w: 3100, h: 2900 },
      { name: '현관', kind: 'ent', x: 5800, y: 0, w: 1600, h: 1200 },
      { name: '공용욕실', kind: 'bath', x: 5800, y: 1200, w: 1600, h: 1700 },
      { name: '다용도실', kind: 'util', x: 7400, y: 0, w: 1300, h: 2900 },
      { name: '침실2', kind: 'bed', x: 0, y: 2900, w: 2700, h: 3900 },
      { name: '거실', kind: 'living', x: 2700, y: 2900, w: 3100, h: 3900 },
      { name: '안방', kind: 'bed', x: 5800, y: 2900, w: 2900, h: 3900 },
    ],
    doors: [
      { room: '현관', side: 'N', at: 350 }, { room: '현관', side: 'W', at: 150 },
      { room: '침실3', side: 'S', at: 1900 }, { room: '공용욕실', side: 'W', at: 400 }, { room: '침실2', side: 'N', at: 1900 },
      { room: '안방', side: 'N', at: 1800 }, { room: '다용도실', side: 'W', at: 1900 },
    ],
    entry: { room: '현관', side: 'N' },
    windows: [{ room: '침실3', side: 'N' }, { room: '주방/식당', side: 'N' }, { room: '침실2', side: 'S' }, { room: '거실', side: 'S' }, { room: '안방', side: 'S' }],
  },
};

const r1 = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
const area = (r) => (r.w * r.h) / 1e6;

/** 템플릿이 스스로 맞는지 — 방이 겹치지 않고 외곽을 빈틈없이 덮는가 · 합계 면적 */
function audit(t) {
  const sum = t.rooms.reduce((s, r) => s + area(r), 0);
  const outer = (t.w * t.d) / 1e6;
  let overlap = false;
  for (let i = 0; i < t.rooms.length; i++) for (let j = i + 1; j < t.rooms.length; j++) {
    const a = t.rooms[i], b = t.rooms[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap = true;
  }
  const inside = t.rooms.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= t.w && r.y + r.h <= t.d);
  return { sum: r1(sum), outer: r1(outer), overlap, inside, tiled: !overlap && inside && Math.abs(sum - outer) < 1e-6 };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* 바깥 치수선 — 한 변을 지나는 방 경계로 칸을 나눈다(손으로 적지 않는다) */
function breaks(t, axis, edge) {
  const set = new Set([0, axis === 'x' ? t.w : t.d]);
  for (const r of t.rooms) {
    const onEdge = axis === 'x' ? (edge === 'N' ? r.y === 0 : r.y + r.h === t.d) : (edge === 'W' ? r.x === 0 : r.x + r.w === t.w);
    if (!onEdge) continue;
    if (axis === 'x') { set.add(r.x); set.add(r.x + r.w); } else { set.add(r.y); set.add(r.y + r.h); }
  }
  return [...set].sort((a, b) => a - b);
}

function render(t, styleId, opt = {}) {
  const S = STYLES[styleId];
  if (!S) throw new Error('디자인 타입은 A · B · C 중 하나');
  const M = styleId === 'B' ? 1900 : 1000;               // 여백(치수선 자리)
  const fy = M + t.d + t.balcony + (styleId === 'B' ? 1100 : 500); // 아래 글 자리 — 치수선·발코니 밑
  const W = t.w + M * 2, H = fy + 2400; // 아래 글이 래스터에서 잘리지 않게 넉넉히
  const ox = M, oy = M;
  const P = {
    A: { bg: '#FFFFFF', wall: '#111111', wallOut: 220, wallIn: 110, fill: () => '#FFFFFF', text: '#111111', sub: '#555555' },
    B: { bg: '#FFFFFF', wall: '#2B2B2B', wallOut: 180, wallIn: 90, fill: (k) => ({ living: '#C88A4F', bed: '#D9B98A', bath: '#C7CCD2', ent: '#E4E4E4', util: '#D3D3D3' }[k] || '#EEE'), text: '#1E1E1E', sub: '#3A3A3A' },
    C: { bg: '#FFFFFF', wall: '#4A4F55', wallOut: 260, wallIn: 140, fill: (k) => ({ bath: '#D4D6D8', util: '#D9D6CF', ent: '#DEDAD2' }[k] || '#E7E0D3'), text: '#3A3F44', sub: '#6B7177' },
  }[styleId];
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${Math.round(W / 10)}" height="${Math.round(H / 10)}" font-family="Paperlogy, Cambria, sans-serif" data-arch-style="${S.id}" data-arch-type="${t.type}">`);
  out.push(`<rect width="${W}" height="${H}" fill="${P.bg}"/>`);
  if (styleId === 'B') out.push('<defs><pattern id="chk" width="300" height="300" patternUnits="userSpaceOnUse"><rect width="300" height="300" fill="#FFFFFF"/><rect width="150" height="150" fill="#DADADA"/><rect x="150" y="150" width="150" height="150" fill="#DADADA"/></pattern></defs>');
  // 발코니(앞쪽 · 서비스면적 — 전용 합계에 넣지 않는다)
  const by = oy + t.d;
  out.push(`<rect x="${ox}" y="${by}" width="${t.w}" height="${t.balcony}" fill="${styleId === 'B' ? '#EFE4D2' : (styleId === 'C' ? '#EEE9E0' : '#FFFFFF')}" stroke="${P.wall}" stroke-width="${P.wallIn * 0.6}"/>`);
  out.push(`<text x="${ox + t.w / 2}" y="${by + t.balcony / 2 + 90}" font-size="${styleId === 'A' ? 200 : 260}" fill="${P.sub}" text-anchor="middle">${styleId === 'A' ? 'BALCONY · 발코니' : '발코니(서비스)'}</text>`);
  // 바닥
  for (const r of t.rooms) {
    const f = styleId === 'B' && r.kind === 'ent' ? 'url(#chk)' : P.fill(r.kind);
    out.push(`<rect x="${ox + r.x}" y="${oy + r.y}" width="${r.w}" height="${r.h}" fill="${f}"/>`);
  }
  // 내부 벽 · 외벽
  for (const r of t.rooms) out.push(`<rect x="${ox + r.x}" y="${oy + r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="${P.wall}" stroke-width="${P.wallIn}"/>`);
  out.push(`<rect x="${ox}" y="${oy}" width="${t.w}" height="${t.d}" fill="none" stroke="${P.wall}" stroke-width="${P.wallOut}"/>`);
  const find = (n) => t.rooms.find((r) => r.name === n);
  // 창 — 외벽 위 흰 칸 + 가는 두 줄
  for (const wdw of t.windows || []) {
    const r = find(wdw.room); if (!r) continue;
    const L = Math.min(r.w, r.h) * 0.55;
    const horiz = wdw.side === 'N' || wdw.side === 'S';
    const cx = ox + r.x + r.w / 2, cy = oy + r.y + r.h / 2;
    const x = horiz ? cx - L / 2 : (wdw.side === 'W' ? ox + r.x : ox + r.x + r.w);
    const y = horiz ? (wdw.side === 'N' ? oy + r.y : oy + r.y + r.h) : cy - L / 2;
    const ww = horiz ? L : 0, hh = horiz ? 0 : L;
    out.push(`<line x1="${x}" y1="${y}" x2="${x + ww}" y2="${y + hh}" stroke="${P.bg}" stroke-width="${P.wallOut + 10}"/>`);
    const d = 45;
    out.push(`<line x1="${x - (horiz ? 0 : d)}" y1="${y - (horiz ? d : 0)}" x2="${x + ww - (horiz ? 0 : d)}" y2="${y + hh - (horiz ? d : 0)}" stroke="${P.wall}" stroke-width="22"/>`);
    out.push(`<line x1="${x + (horiz ? 0 : d)}" y1="${y + (horiz ? d : 0)}" x2="${x + ww + (horiz ? 0 : d)}" y2="${y + hh + (horiz ? d : 0)}" stroke="${P.wall}" stroke-width="22"/>`);
  }
  // 문 — 벽에 900 구멍 + 열림 호
  for (const dr of t.doors || []) {
    const r = find(dr.room); if (!r) continue;
    const dw = 900, s = dr.side;
    const horiz = s === 'N' || s === 'S';
    const hx = horiz ? ox + r.x + dr.at : (s === 'W' ? ox + r.x : ox + r.x + r.w);
    const hy = horiz ? (s === 'N' ? oy + r.y : oy + r.y + r.h) : oy + r.y + dr.at;
    out.push(`<line x1="${hx}" y1="${hy}" x2="${hx + (horiz ? dw : 0)}" y2="${hy + (horiz ? 0 : dw)}" stroke="${P.fill(r.kind) === 'url(#chk)' ? '#FFF' : P.fill(r.kind)}" stroke-width="${P.wallIn + 8}"/>`);
    if (styleId !== 'C') {
      const into = (s === 'N' || s === 'W') ? 1 : -1;
      const ex = horiz ? hx : hx + into * dw, ey = horiz ? hy + into * dw : hy;
      out.push(`<line x1="${hx}" y1="${hy}" x2="${ex}" y2="${ey}" stroke="${P.wall}" stroke-width="30"/>`);
      const ax = horiz ? hx + dw : hx, ay = horiz ? hy : hy + dw;
      out.push(`<path d="M ${ex} ${ey} A ${dw} ${dw} 0 0 ${horiz ? (into > 0 ? 0 : 1) : (into > 0 ? 1 : 0)} ${ax} ${ay}" fill="none" stroke="${P.sub}" stroke-width="14"/>`);
    }
  }
  // 현관 표시
  if (t.entry && styleId === 'A') { // B·C 는 치수선·문 열림 호와 겹쳐 안 적는다
    const r = find(t.entry.room);
    if (r) {
      const s = t.entry.side;
      const ex = s === 'E' ? ox + r.x + r.w + 700 : (s === 'W' ? ox + r.x - 700 : ox + r.x + r.w / 2);
      const ey = s === 'N' ? oy + r.y - 650 : (s === 'S' ? oy + r.y + r.h + 650 : oy + r.y + r.h / 2);
      out.push(`<text x="${ex}" y="${ey}" font-size="230" font-weight="600" fill="${P.text}" text-anchor="middle">ENT. ▶</text>`);
    }
  }
  // 실명
  for (const r of t.rooms) {
    const cx = ox + r.x + r.w / 2, cy = oy + r.y + r.h / 2;
    const small = Math.min(r.w, r.h) < 1500;
    if (styleId === 'A') {
      out.push(`<text x="${cx}" y="${cy}" font-size="${small ? 150 : 190}" fill="${P.text}" text-anchor="middle" letter-spacing="20">${esc(EN[r.name] || r.name)}</text>`);
      out.push(`<text x="${cx}" y="${cy + 220}" font-size="${small ? 130 : 160}" fill="${P.sub}" text-anchor="middle">${esc(r.name)}</text>`);
    } else if (styleId === 'B') {
      out.push(`<text x="${cx}" y="${cy - 40}" font-size="${small ? 190 : 250}" font-weight="600" fill="${P.text}" text-anchor="middle">${esc(r.name)}</text>`);
      out.push(`<text x="${cx}" y="${cy + 230}" font-size="${small ? 160 : 210}" fill="${P.sub}" text-anchor="middle">${area(r).toFixed(2)}㎡ · ${(area(r) / PY).toFixed(2)}평</text>`);
    } else if (!small) {
      out.push(`<text x="${cx}" y="${cy + 80}" font-size="260" fill="${P.sub}" text-anchor="middle">${esc(r.name)}</text>`);
    }
    if (styleId === 'C' && r.highlight) {
      out.push(`<rect x="${ox + r.x - 120}" y="${oy + r.y - 120}" width="${r.w + 240}" height="${r.h + 240}" fill="none" stroke="#1E9AA8" stroke-width="70" rx="60"/>`);
      out.push(`<text x="${cx}" y="${cy - 300}" font-size="320" font-weight="700" fill="#1E9AA8" text-anchor="middle">${esc(r.highlight)}</text>`);
    }
  }
  // B 치수선 두 단(칸 · 전체)
  if (styleId === 'B') {
    const dim = (x1, y1, x2, y2, label, horiz) => {
      const t2 = 90;
      out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#555" stroke-width="16"/>`);
      for (const [px, py] of [[x1, y1], [x2, y2]]) out.push(`<line x1="${px - t2}" y1="${py + t2}" x2="${px + t2}" y2="${py - t2}" stroke="#555" stroke-width="22"/>`);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      out.push(horiz ? `<text x="${mx}" y="${my - 70}" font-size="170" fill="#333" text-anchor="middle">${label}</text>`
        : `<text x="${mx - 70}" y="${my}" font-size="170" fill="#333" text-anchor="middle" transform="rotate(-90 ${mx - 70} ${my})">${label}</text>`);
    };
    const fmt = (v) => v.toLocaleString('en-US');
    for (const [edge, yy] of [['N', oy - 450], ['N2', oy - 1050]]) {
      const b = edge === 'N' ? breaks(t, 'x', 'N') : [0, t.w];
      for (let i = 0; i < b.length - 1; i++) dim(ox + b[i], yy, ox + b[i + 1], yy, fmt(b[i + 1] - b[i]), true);
    }
    const bs = breaks(t, 'x', 'S'), yb = oy + t.d + t.balcony + 450;
    for (let i = 0; i < bs.length - 1; i++) dim(ox + bs[i], yb, ox + bs[i + 1], yb, fmt(bs[i + 1] - bs[i]), true);
    for (const [edge, xx] of [['W', ox - 450], ['W2', ox - 1050]]) {
      const b = edge === 'W' ? breaks(t, 'y', 'W') : [0, t.d];
      for (let i = 0; i < b.length - 1; i++) dim(xx, oy + b[i], xx, oy + b[i + 1], fmt(b[i + 1] - b[i]), false);
    }
  }
  // 방위 · 축척 막대(5m · 실제 길이) · 아래 글
  const nx = W - M * 0.55, ny = M * 0.6;
  out.push(`<g fill="${P.text}"><path d="M ${nx} ${ny - 300} L ${nx + 140} ${ny + 160} L ${nx} ${ny + 80} L ${nx - 140} ${ny + 160} Z"/><text x="${nx}" y="${ny + 380}" font-size="180" text-anchor="middle">N</text></g>`);
  const sy = fy + 200, sx = ox;
  out.push(`<g stroke="${P.text}" stroke-width="22"><line x1="${sx}" y1="${sy}" x2="${sx + 5000}" y2="${sy}"/>${[0, 1000, 2000, 5000].map((v) => `<line x1="${sx + v}" y1="${sy - 90}" x2="${sx + v}" y2="${sy + 90}"/>`).join('')}</g>`);
  out.push([0, 1, 2, 5].map((v) => `<text x="${sx + v * 1000}" y="${sy + 300}" font-size="150" fill="${P.sub}" text-anchor="middle">${v}${v === 5 ? 'm' : ''}</text>`).join(''));
  const total = t.rooms.reduce((s, r) => s + area(r), 0).toFixed(2);
  out.push(`<text x="${W / 2}" y="${fy + 1000}" font-size="${styleId === 'C' ? 380 : 300}" font-weight="700" fill="${P.text}" text-anchor="middle">${esc(t.label)}${styleId === 'C' ? '' : ` · 디자인 ${S.id}`}</text>`);
  out.push(`<text x="${W / 2}" y="${fy + 1400}" font-size="170" fill="${P.sub}" text-anchor="middle">전용 합계 ${total}㎡ (벽체 중심선 기준) · 개념 템플릿 · 설계도서 아님</text>`);
  out.push('</svg>');
  return out.join('');
}

function pickStyles(sel) {
  const s = String(sel || 'ABC').toUpperCase().replace(/[^ABC]/g, '');
  return [...new Set(s.split(''))].filter((x) => STYLES[x]);
}

module.exports = { PY, STYLES, TEMPLATES, audit, breaks, render, pickStyles };
