// scripts/shorts-images.mjs
//
// 쇼츠 스토리보드 — 대본 줄마다 «장면»(scene · 영어 검색어)에 맞는 사진을 Pexels 공식 API 로 고른다
// 〈2026-10-28 사장님: 「스토리보드에 맞게 자동으로 이미지도 넣어줘」〉
//
// ★ 남의 사진 규칙 일곱을 따른다 (CLAUDE.md §6-2-6):
//   공식 API 만 · 사진가와 출처를 적는다(영상 아래 작은 글자 · 올리기 설명 · 기록 _images.json) ·
//   원본 사진 내려받기는 주지 않는다(완성 영상에만 들어간다) · 사람·로고·상표·작품은 «설명 글자(alt)»로 거른다.
// ★ 설명 글자로 거른 것은 «확인한 것»이 아니다 — 기록에 people:null(눈 확인 전)으로 남긴다. false 로 적지 않는다.
// ★ 장면 검색어가 없는 줄 · 사진을 못 받은 줄은 잉크 바탕 그대로 둔다(빈 칸으로 안 메우고, 아무 사진으로 안 메운다).
// ★ 같은 편 안에서 같은 사진을 두 번 쓰지 않는다.

export const PEXELS = 'https://api.pexels.com/v1/search';
// 사람·로고·작품이 찍혔을 법한 설명 글자 — 걸리면 그 사진을 건너뛴다
export const AVOID = /\b(man|men|woman|women|person|people|girl|boy|child|children|kid|face|portrait|selfie|crowd|hand|hands|logo|brand|sign|signage|painting|artwork|art|statue|sculpture|mural|poster|museum)\b/i;

const code = (s) => (s === 401 || s === 403 ? 4 : s === 429 || s >= 500 ? 3 : 7);

/** 한 장면에 맞는 사진 한 장 — 이미 쓴 id(seen)는 건너뛴다 */
export async function pick({ query, key, seen = new Set(), fetchImpl = fetch }) {
  if (!key) return { ok: false, code: 2, say: 'PEXELS_API_KEY 가 없다' };
  if (!query) return { ok: false, code: 10, say: '장면 검색어가 없다' };
  const r = await fetchImpl(`${PEXELS}?query=${encodeURIComponent(query)}&orientation=portrait&size=large&per_page=20`, { headers: { Authorization: key } });
  const t = await r.text();
  if (!r.ok) return { ok: false, code: code(r.status), say: `Pexels 가 거절했다 (HTTP ${r.status})` };
  let photos = [];
  try { photos = JSON.parse(t).photos || []; } catch (_) {}
  const p = photos.find((x) => x && x.id && !seen.has(x.id) && !AVOID.test(String(x.alt || '')) && x.src && (x.src.portrait || x.src.large2x));
  if (!p) return { ok: false, code: 7, say: `«${query}» 에 쓸 만한 사진이 없다 (받은 ${photos.length}장 · 사람·로고 설명 글자는 거름)` };
  seen.add(p.id);
  return { ok: true, id: p.id, src: p.src.portrait || p.src.large2x, page: p.url, alt: p.alt || '', photographer: p.photographer || '', photographerUrl: p.photographer_url || '' };
}

/** 대본 전체 — 줄마다 {ok, file?, credit?} · 사진 바이트는 out 폴더에 둔다 */
export async function storyboard({ script, key, out, fetchImpl = fetch, write }) {
  const seen = new Set(); const rows = [];
  for (const [i, l] of script.lines.entries()) {
    const q = String(l.scene || '').trim();
    if (!q) { rows.push({ i, ok: false, code: 10, say: '장면 없음 — 잉크 바탕' }); continue; }
    let r;
    try { r = await pick({ query: q, key, seen, fetchImpl }); } catch (e) { r = { ok: false, code: 3, say: '부르다 끊겼다' }; }
    if (!r.ok) { rows.push({ i, query: q, ok: false, code: r.code, say: r.say }); if (r.code === 2 || r.code === 4) break; continue; }
    let bytes;
    try { const g = await fetchImpl(r.src); if (!g.ok) throw new Error('HTTP ' + g.status); bytes = Buffer.from(await g.arrayBuffer()); }
    catch (e) { rows.push({ i, query: q, ok: false, code: 3, say: '사진을 못 받았다 — ' + String(e && e.message).slice(0, 60) }); continue; }
    const file = `${out}/scene-${String(i + 1).padStart(2, '0')}.jpg`;
    await write(file, bytes);
    rows.push({ i, query: q, ok: true, file, credit: {
      source: 'Pexels', license: 'Pexels License', id: r.id, page: r.page, photographer: r.photographer, photographerUrl: r.photographerUrl,
      alt: r.alt, people: null, peopleCheck: '설명 글자(alt)로만 걸렀다 — 눈 확인 전',
    } });
  }
  return rows;
}

/** 기록에서 올리기 설명에 붙일 사진 줄 — 사진가가 겹치면 한 번만 */
export function creditLines(images) {
  const seen = new Set(); const out = [];
  for (const r of images || []) {
    const c = r && r.credit; if (!c || !c.photographer) continue;
    const k = c.photographer + '|' + c.photographerUrl; if (seen.has(k)) continue; seen.add(k);
    out.push(`- ${c.photographer} (Pexels) ${c.page || ''}`.trim());
  }
  return out;
}
