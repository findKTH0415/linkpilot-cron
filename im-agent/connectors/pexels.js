'use strict';
/**
 * pexels.js — Pexels 무료 이미지 Connector (표지·간지의 **참고 이미지**).
 *
 * 무엇에 쓰는가: IM 표지나 절 간지가 비어 보일 때 채우는 **장식용 사진**이다.
 * 그게 전부다.
 *
 * ★ **이 커넥터의 위험은 이 저장소에서 유일한 종류다.**
 *   다른 커넥터는 「없는 값을 지어낼까」를 걱정한다. 이것은 반대다 —
 *   **가져온 것이 진짜처럼 보이는 것**이 위험하다.
 *
 *   IM 에 공장 사진 한 장이 실리면, 읽는 사람은 그것을 **이 딜의 공장**으로 본다.
 *   아무도 「스톡 사진입니까」라고 묻지 않는다. 숫자는 출처를 따지지만
 *   **사진은 아무도 출처를 안 따진다.** 그래서 표시가 떨어지면 그 순간
 *   남의 공장 사진이 이 딜의 현장이 된다.
 *
 *   그래서 이 파일은 세 가지를 강제한다.
 *     ① **캡션 없이는 내려받을 수 없다** — `download()` 가 캡션을 함께 낸다
 *     ② **딜 자료·현장 그림과 다른 폴더에 둔다** (`09_IM/images/stock/`).
 *        `02_Source_Data`(받은 자료)와 `04_Property`(지적선으로 그린 그림)에는
 *        절대 쓰지 않는다 — 섞이면 어느 것이 이 딜의 것인지 사라진다
 *     ③ **fact 로 등록하지 않는다.** 사진은 값이 아니다
 *
 * ★ **자동으로 고르지 않는다** (§4.9). 검색어 하나에 수천 장이 나오고,
 *   그중 무엇이 이 딜에 어울리는지는 기계가 못 정한다. 후보를 내고 사람이 고른다.
 *
 * ★ **사람이 찍힌 사진은 권하지 않는다.** Pexels 라이선스는 식별 가능한 인물을
 *   특정 맥락에 쓰는 것을 제한하고, PDI 하우스 스타일도 개인 성명·인물을 대외
 *   문서에 넣지 않는다. API 가 「사람이 있는가」를 알려 주지 않으므로
 *   **판정하지 않고 경고만 남긴다** — 고르는 사람이 보고 정한다 (등록부 D-50).
 *
 * ★ **출처를 남긴다.** Pexels 라이선스는 출처 표기를 요구하지 않지만,
 *   이 시스템은 §4.7 로 「그 값이 어디서 왔는지」를 항상 남긴다. 사진도 같다 —
 *   반년 뒤에 이 사진을 어디서 가져왔는지 아무도 모르는 상태를 만들지 않는다.
 *
 * 인증키: PEXELS_API_KEY — pexels.com/api 에서 발급 (무료).
 *   ★ **Authorization 헤더**로 보낸다. 쿼리가 아니라서 일반 마스킹 규칙에
 *     안 걸린다 — `SECRET_ENV` 에 등록해 두었다 (§2).
 *   ★ 한도가 낮다: **시간당 200회 · 월 20,000회.** data.go.kr 의 1/50 이다.
 *     캐시를 반드시 경유하고, 목록 조회를 반복하지 않는다 (§4.5).
 */

// ★ `request` 를 뜯어내지 않고 모듈 객체로 붙든다 (M-08)
const http = require('./http');
const { buildUrl, redact } = http;
const cache = require('./cache');
const fs = require('fs');
const path = require('path');

const PROVIDER = 'pexels';
const BASE = 'https://api.pexels.com/v1';

/**
 * 내려받은 사진이 놓이는 곳. **한 곳으로 고정한다.**
 *
 * ★ `02_Source_Data`(받은 딜 자료)나 `04_Property`(지적선으로 그린 그림)에
 *   섞이면 어느 것이 이 딜의 것인지 사라진다. 그때는 파일 이름만 봐서는
 *   구분이 안 된다 — 폴더가 유일한 구분선이다.
 */
const STOCK_DIR = '09_IM/images/stock';

/** 이 폴더에는 절대 넣지 않는다 */
const FORBIDDEN_DIRS = ['02_Source_Data', '04_Property'];

/**
 * 캡션 앞머리. **떼면 남의 공장 사진이 이 딜의 현장이 된다.**
 * 문구를 한 곳에서만 만든다 — 두 벌로 두면 한쪽만 고치는 날 갈린다.
 */
const CAPTION_PREFIX = '참고 이미지 — 이 사업의 현장이 아니다';

function apiKey() {
  return (process.env.PEXELS_API_KEY || '').trim();
}

function isAvailable() {
  return Boolean(apiKey());
}

function unavailable(what) {
  return {
    ok: false, unavailable: true,
    error: `PEXELS_API_KEY 미설정 — ${what || '이미지 검색'} 생략. `
      + '이미지는 장식이므로 없으면 그 자리를 비운다 (지어내지 않는다)',
  };
}

function mask(text) {
  return redact(text, [apiKey()]);
}

/** 사진 한 건 → 우리 모양. **출처가 되는 값만 남긴다** */
function toPhoto(x) {
  const src = x.src || {};
  return {
    id: x.id,
    // ★ 촬영자와 원본 주소 — 라이선스가 요구하지 않아도 남긴다 (§4.7)
    photographer: x.photographer || null,
    photographerUrl: x.photographer_url || null,
    pageUrl: x.url || null,
    alt: x.alt || null,
    width: x.width || null,
    height: x.height || null,
    orientation: (x.width && x.height)
      ? (x.width > x.height ? 'landscape' : (x.width < x.height ? 'portrait' : 'square'))
      : null,
    // 내려받을 주소. 원본(original)은 수십 MB 가 되기도 해 기본은 large 를 쓴다
    files: { large: src.large2x || src.large || null, original: src.original || null },
  };
}

/**
 * 사진 검색. **후보를 내놓는 것까지가 전부다** (§4.9).
 *
 * @param {object} o { query, orientation, perPage }
 */
async function search(o) {
  const opt = o || {};
  if (!isAvailable()) return unavailable('이미지 검색');

  const query = String(opt.query || '').trim();
  if (!query) return { ok: false, error: '검색어가 필요하다 — 무엇을 찾을지 기계가 정하지 않는다' };

  const perPage = Math.min(Math.max(Number(opt.perPage) || 12, 1), 30);
  const orientation = ['landscape', 'portrait', 'square'].includes(opt.orientation) ? opt.orientation : undefined;

  // ★ 한도가 시간당 200회다. 같은 검색어를 두 번 부르지 않게 **길게** 붙든다
  return cache.through(PROVIDER, 'pexels', { query, orientation: orientation || '', perPage }, async () => {
    const url = buildUrl(`${BASE}/search`, { query, per_page: perPage, orientation });
    // ★ 키가 **헤더**로 간다 — 쿼리 마스킹 규칙에 안 걸린다
    const r = await http.request(url, { headers: { Authorization: apiKey() } });
    if (!r.ok) return { ok: false, error: mask(r.error) };

    let j;
    try { j = JSON.parse(r.body); } catch (_) {
      return { ok: false, error: 'Pexels 응답이 JSON 이 아니다 (키 확인)' };
    }
    if (j.error) return { ok: false, error: mask(`Pexels: ${j.error}`) };

    const photos = (j.photos || []).map(toPhoto).filter(p => p.files.large);
    if (!photos.length) {
      return { ok: false, notFound: true, error: `'${query}' 로 찾은 사진이 없다 — 검색어를 바꿔 본다` };
    }
    return { ok: true, value: { query, total: j.total_results ?? photos.length, photos } };
  }, { ttl: 30 * 86400 });
}

/**
 * 이 사진의 출처 한 줄. **라이선스가 요구하지 않아도 남긴다** (§4.7).
 */
function attribution(photo) {
  if (!photo) return null;
  const who = photo.photographer || '촬영자 미상';
  return `사진: ${who} / Pexels${photo.pageUrl ? ` (${photo.pageUrl})` : ''}`;
}

/**
 * IM 에 함께 실리는 캡션. **이것 없이는 내려받을 수 없다.**
 *
 * ★ 앞머리를 붙이는 이유: 숫자는 출처를 따지지만 **사진은 아무도 출처를 안
 *   따진다.** 표시가 없으면 읽는 사람은 이 딜의 현장으로 본다.
 */
function caption(photo, note) {
  return [CAPTION_PREFIX, note || null, attribution(photo)].filter(Boolean).join(' · ');
}

/**
 * 고른 사진 하나를 프로젝트 폴더에 내려받는다.
 *
 * ★ **폴더를 고정한다.** 받은 자료·지적선 그림과 섞이면 어느 것이 이 딜의
 *   것인지 사라진다.
 * ★ **manifest 를 함께 쓴다.** 파일만 남으면 반년 뒤에 출처를 알 수 없다.
 *
 * @param {object} o { photo, projectDir, name, note }
 */
async function download(o) {
  const opt = o || {};
  if (!isAvailable()) return unavailable('이미지 내려받기');

  const photo = opt.photo;
  if (!photo || !photo.files || !photo.files.large) {
    return { ok: false, error: '내려받을 사진을 지정해야 한다 — search() 후보 중에서 사람이 고른다' };
  }
  if (!opt.projectDir) return { ok: false, error: '프로젝트 폴더가 필요하다' };

  const destDir = path.join(opt.projectDir, STOCK_DIR);
  // ★ 폴더를 넘겨받아 쓰지 않는다. 부르는 쪽이 실수로 자료 폴더를 주면
  //   스톡 사진이 딜 자료 사이에 섞인다
  if (FORBIDDEN_DIRS.some(d => destDir.includes(`${path.sep}${d}${path.sep}`))) {
    return { ok: false, error: `스톡 사진은 ${FORBIDDEN_DIRS.join('·')} 에 두지 않는다` };
  }

  const r = await http.request(photo.files.large, { binary: true, timeoutMs: 30000 });
  if (!r.ok) return { ok: false, error: mask(r.error) };
  if (!Buffer.isBuffer(r.body) || !r.body.length) {
    return { ok: false, error: '빈 파일을 받았다' };
  }

  const base = String(opt.name || `pexels-${photo.id}`).replace(/[^\w.-]/g, '_');
  const file = `${base}.jpg`;
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, file), r.body);

  const entry = {
    file: `${STOCK_DIR}/${file}`,
    id: photo.id,
    photographer: photo.photographer,
    photographerUrl: photo.photographerUrl,
    pageUrl: photo.pageUrl,
    alt: photo.alt,
    bytes: r.body.length,
    // ★ 캡션을 **파일과 함께** 남긴다. 나중에 문서에 붙일 때 이걸 그대로 쓴다
    caption: caption(photo, opt.note),
    license: 'Pexels License (출처 표기 의무 없음 — 그래도 남긴다)',
    // ★ 사람이 찍혀 있는지는 API 가 말해 주지 않는다. **판정하지 않고 남긴다**
    check: '식별 가능한 인물이 있으면 대외 문서에 쓰지 않는다 (사람이 확인, 등록부 D-50)',
  };
  writeManifest(opt.projectDir, entry);

  return { ok: true, value: entry };
}

/** 폴더 안의 사진 목록. **파일만 남으면 출처를 알 수 없다** */
function manifestPath(projectDir) {
  return path.join(projectDir, STOCK_DIR, 'manifest.json');
}

function readManifest(projectDir) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(projectDir), 'utf8'));
  } catch (_) {
    return { images: [] };
  }
}

function writeManifest(projectDir, entry) {
  const m = readManifest(projectDir);
  m.images = (m.images || []).filter(x => x.file !== entry.file).concat([entry]);
  m.note = '이 폴더의 사진은 전부 **참고 이미지**다 — 이 사업의 현장이 아니다. '
    + '받은 자료(02_Source_Data)·지적선으로 그린 그림(04_Property)과 섞지 않는다.';
  fs.mkdirSync(path.dirname(manifestPath(projectDir)), { recursive: true });
  fs.writeFileSync(manifestPath(projectDir), JSON.stringify(m, null, 2), 'utf8');
  return m;
}

module.exports = {
  search, download, caption, attribution, toPhoto,
  readManifest, writeManifest, manifestPath,
  isAvailable, unavailable, mask,
  PROVIDER, BASE, STOCK_DIR, FORBIDDEN_DIRS, CAPTION_PREFIX,
};
