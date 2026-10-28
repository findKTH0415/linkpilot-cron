'use strict';
/**
 * issuer.js — 발행 주체(회사 정보).
 *
 * IM 의 서명부·표지에 찍히는 이름이다. **코드에 박으면 안 된다.**
 * 이 시스템은 여러 회사가 쓰는 제품이고, 박아 두면 다른 회사가 만든 IM 에
 * 남의 회사 이름이 찍혀 나간다. 대외 배포 문서라 발견도 늦다.
 *
 * ★ 설정되지 않으면 **아무 회사 이름도 쓰지 않는다.** 기본값을 두면
 *   설정을 잊은 것과 일부러 그 회사인 것을 구분할 수 없다 — 잘못된 이름이
 *   찍힌 문서가 나가는 것보다 '미설정'이라고 적힌 문서가 나가는 편이 낫다.
 *
 * 읽는 순서 (먼저 찾은 것을 쓴다):
 *   ① 프로젝트별   <프로젝트>/01_Project/issuer.json
 *   ② 환경변수     IM_AGENT_ISSUER  (JSON 문자열)
 *   ③ 저장소 전체  <IM_AGENT_ROOT>/issuer.json
 *
 * 형식:
 *   { "en": "...", "kr": "...", "tag": "...", "mark": "PDI", "logo": "data:image/png;base64,...", "contact": "..." }
 *   en 만 있어도 된다. mark 는 로고 자리 이니셜 — 없으면 en 에서 만든다.
 *   logo 는 **제출자 로고 이미지**(data URL, PNG/JPG/SVG, 200KB 이하) — 있으면 표지·서명부의
 *   로고 자리에 이니셜 대신 이 그림이 찍힌다(요청 2026-08-16). 파일이 아니라 data URL 로 두는
 *   이유: issuer.json 하나로 프로젝트 폴더에 남아 배포·복사 때 그림이 따로 떨어지지 않는다.
 */

const fs = require('fs');
const path = require('path');

const FILE = 'issuer.json';

/**
 * 이름에서 로고 자리 이니셜을 만든다 (최대 4글자).
 *
 * ★★★ 〈2026-08-23 사장님 지적 — 「기본값 입력이 오류」〉 앞 판은 **세 가지가 틀렸다.**
 *
 *   `주식회사 대한개발` → **식대**   ← 「주」를 아무 데서나 지웠다
 *   `전주도시개발`      → **전도**   ← 같은 이유로 낱말이 쪼개졌다
 *   `PDI Global Infra Structure Development Co.,ltd` → **PGIS**
 *                                    ← 이미 약칭인 `PDI` 를 낱말로 세어 첫 글자만 떴다
 *
 *   ★ 원인 하나는 `[(주)㈜]` 가 **문자 클래스**였다는 것이다. `(주)` 라는 **낱말**을
 *     떼려던 것인데, 실제로는 `(` · `주` · `)` 를 **글자 단위로 아무 데서나** 지웠다.
 *     한글 회사명에 「주」는 흔하다(전주·제주·주식회사) — 그래서 조용히 틀렸다.
 *   ★ 원인 둘은 **약칭을 못 알아본 것**이다. 회사가 이미 `PDI` 라는 약칭을 이름
 *     앞에 달고 있으면 그것이 그 회사의 표시다. 첫 글자만 떼면 아무도 모르는
 *     글자가 나온다.
 *
 * ★★ 이 값은 **보고서 표지·서명부에 찍힌다.** 틀려도 오류가 안 나고 문서가
 *   그대로 나간다 — 그래서 조용히 틀리는 종류다.
 *
 * ★ 화면(`intake.html` 의 `autoMark`)에 **같은 규칙의 사본**이 있다.
 *   `issuer-mark.test.js` 가 둘을 같은 표로 대조한다 — 갈리면 거기서 잡힌다.
 */
function markFrom(name) {
  const s = String(name || '').trim();
  if (!s) return '';

  // ① 법인 표시를 **낱말 단위로** 뗀다 (글자 단위로 지우지 않는다)
  let t = s
    .replace(/\((주|유|재|사)\)|㈜/g, ' ')
    .replace(/(주식|유한|합자|합명)회사/g, ' ')
    .replace(/\b(Co|Ltd|Inc|Corp|Corporation|LLC|LLP|PLC|GmbH|SA|AG|Pte)\b\.?/gi, ' ');

  const words = t.split(/[\s,.·]+/).filter(Boolean);
  if (!words.length) return '';

  // ② ★ **이미 약칭인 낱말이 앞에 있으면 그것이 표시다** (PDI · SK · GID)
  const acronym = /^[A-Z][A-Z0-9&]{1,3}$/;
  if (acronym.test(words[0])) return words[0].slice(0, 4);

  // ③ 낱말이 하나면 앞에서 자른다 (한글 회사명이 대개 여기로 온다)
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();

  // ④ 여러 낱말이면 각 첫 글자
  return words.slice(0, 4).map(w => w[0]).join('').toUpperCase();
}

/** 로고 data URL 검증 — 형식(PNG/JPG/SVG)·크기(200KB) 밖이면 버린다(있는 척하지 않고 이니셜로 간다) */
const LOGO_MAX = 200 * 1024;
function logoFrom(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const m = /^data:image\/(png|jpeg|jpg|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/.exec(s);
  if (!m) return null;
  const bytes = Math.floor(m[2].replace(/\s+/g, '').length * 3 / 4);
  if (bytes > LOGO_MAX) return null;
  return s;
}

function parse(raw, where) {
  let o;
  try {
    o = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error(`발행 주체 설정을 읽을 수 없다 (${where}): ${e.message}`);
  }
  if (!o || typeof o !== 'object') return null;
  const en = String(o.en || o.name || '').trim();
  if (!en) return null;   // 이름 없는 설정은 설정이 아니다
  return {
    en,
    kr: String(o.kr || '').trim() || null,
    tag: String(o.tag || '').trim() || null,
    mark: (String(o.mark || '').trim() || markFrom(en)).slice(0, 4),
    logo: logoFrom(o.logo),
    contact: String(o.contact || '').trim() || null,
    source: where,
  };
}

function root() {
  return process.env.IM_AGENT_ROOT || path.join(process.cwd(), 'im-projects');
}

/**
 * @param {string} [projectId] 있으면 프로젝트별 설정을 먼저 본다
 * @returns {object|null} 설정되지 않았으면 null — 부르는 쪽이 그렇게 표시해야 한다
 */
function read(projectId) {
  if (projectId) {
    const p = path.join(root(), projectId, '01_Project', FILE);
    if (fs.existsSync(p)) {
      const got = parse(fs.readFileSync(p, 'utf8'), `프로젝트 설정 ${FILE}`);
      if (got) return got;
    }
  }
  if (process.env.IM_AGENT_ISSUER) {
    const got = parse(process.env.IM_AGENT_ISSUER, '환경변수 IM_AGENT_ISSUER');
    if (got) return got;
  }
  const g = path.join(root(), FILE);
  if (fs.existsSync(g)) {
    const got = parse(fs.readFileSync(g, 'utf8'), `저장소 설정 ${FILE}`);
    if (got) return got;
  }
  return null;
}

/** 미설정 상태를 문서에 어떻게 적을지 — 한 곳에서 정한다 */
const UNSET = {
  en: '발행 주체 미설정',
  kr: null,
  tag: null,
  mark: '—',
  contact: null,
  unset: true,
};

/** 항상 무언가를 돌려준다. 다만 미설정이면 unset:true 가 붙는다 */
function resolve(projectId) {
  return read(projectId) || Object.assign({}, UNSET);
}

/** 길이 한도 — 서명부는 3줄이다. 넘치면 표지 레이아웃이 무너진다 */
const LIMITS = { en: 120, kr: 120, tag: 80, mark: 4, contact: 200 };

/**
 * 사람이 입력한 값을 정리한다. 화면과 서버가 같은 규칙을 써야 하므로 여기 둔다.
 *
 * ★ 회사명은 설정값이지만 사람이 적는 값이다. 제어문자를 걷어내고 길이를 자른다.
 *   이스케이프는 그리는 쪽(a4.js)이 한다 — 저장값을 미리 이스케이프하면
 *   다시 편집할 때 `&amp;` 가 그대로 보인다.
 *
 * @returns {{ok:boolean, value?:object, error?:string}}
 */
function normalize(input) {
  const o = input || {};
  const clean = (v, max) => String(v === null || v === undefined ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

  const en = clean(o.en || o.name, LIMITS.en);
  if (!en) return { ok: false, error: '회사명(영문)을 입력하세요 — 서명부에 들어갈 이름입니다' };
  if (en.length < 2) return { ok: false, error: '회사명이 너무 짧습니다' };

  const kr = clean(o.kr, LIMITS.kr);
  const tag = clean(o.tag, LIMITS.tag);
  const contact = clean(o.contact, LIMITS.contact);
  const mark = clean(o.mark, LIMITS.mark).toUpperCase() || markFrom(en);
  /* 로고 — 형식·크기 밖이면 **거부**한다(조용히 버리면 사용자는 올린 줄 안다) */
  let logo = null;
  if (o.logo !== undefined && o.logo !== null && String(o.logo).trim() !== '') {
    logo = logoFrom(o.logo);
    if (!logo) return { ok: false, error: '로고는 PNG·JPG·SVG 이미지, 200KB 이하여야 합니다' };
  }

  return {
    ok: true,
    value: {
      en,
      kr: kr || null,
      tag: tag || null,
      mark,
      logo,
      contact: contact || null,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════
   저장해 둔 발행 주체 목록 〈2026-08-23 사장님 지시:
   「저장된 회사를 선택할수 있도록 · 자동 저장된 기업은 선택시 자동 노출」〉

   ★ 지금까지는 **한 곳에 하나**였다 (`issuer.json`). 회사를 바꿔 쓰는 사람은
     매번 다섯 칸을 다시 치고 로고를 다시 올려야 했다.
   ★ 그래서 **쓴 것을 자동으로 기억한다.** 프로젝트를 만들 때·발행 주체를
     고칠 때 자동으로 이 목록에 얹힌다 — 따로 「저장」을 누르지 않는다.
   ══════════════════════════════════════════════════════════════════ */

const LIST_FILE = 'issuers.json';
/** 기억할 개수. 늘리면 `/intake` 응답이 커진다 — 로고가 한 건에 200KB 까지다 */
const LIST_MAX = 8;
/**
 * ★★ 목록에 실어 보낼 **로고 총량 한도**. `/intake` 는 화면이 열릴 때마다
 *   부르는 길이라 여기에 로고 8건(최대 1.6MB)을 그대로 실으면 **화면이 늦게
 *   뜬다.** 그래서 앞에서부터 담다가 한도를 넘으면 나머지는 로고만 뺀다.
 *   ★ 뺐다는 사실을 `logoOmitted` 로 남긴다 — 조용히 빼면 화면은 「로고 없는
 *     회사」로 그리고, 사람은 지워진 줄 안다 (CLAUDE.md §4.9).
 */
const LIST_LOGO_BUDGET = 256 * 1024;

/** 같은 회사인가 — 영문 상호로 가른다(대소문자·공백 무시) */
function keyOf(v) {
  return String((v && v.en) || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function listPath() { return path.join(root(), LIST_FILE); }

/**
 * 저장해 둔 목록. **못 읽어도 던지지 않는다** — 목록이 없다고 프로젝트를
 * 못 만들면 안 된다 (§4.6).
 */
function list() {
  try {
    const p = listPath();
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter(v => v && v.en).slice(0, LIST_MAX);
  } catch (_) {
    return [];
  }
}

/**
 * 화면에 보낼 목록. 로고는 **총량 한도 안에서만** 싣는다.
 * @returns {Array} 각 항목에 `logoOmitted` 가 붙을 수 있다
 */
function listForClient() {
  let used = 0;
  return list().map((v) => {
    const logo = v.logo ? String(v.logo) : null;
    if (!logo) return { ...v, logo: null, logoOmitted: false };
    if (used + logo.length > LIST_LOGO_BUDGET) {
      return { ...v, logo: null, logoOmitted: true };
    }
    used += logo.length;
    return { ...v, logo, logoOmitted: false };
  });
}

/**
 * 쓴 주체를 목록 맨 앞으로 올린다. 같은 회사면 **덮어쓴다** — 두 벌이 남으면
 * 화면에 같은 이름이 두 번 뜨고 어느 쪽이 최신인지 알 수 없다.
 *
 * ★ 저장에 실패해도 **던지지 않는다.** 목록은 편의 기능이고, 이것 때문에
 *   프로젝트 생성이 죽으면 안 된다.
 *
 * @param {object} value `normalize()` 를 통과한 값
 * @param {string} [at] 기억한 시각 (KST 문자열). 부르는 쪽이 준다
 * @returns {boolean} 저장됐는가
 */
function remember(value, at) {
  const k = keyOf(value);
  if (!k) return false;
  try {
    const next = [{ ...value, savedAt: at || null }]
      .concat(list().filter(v => keyOf(v) !== k))
      .slice(0, LIST_MAX);
    const dir = root();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(listPath(), JSON.stringify(next, null, 2));
    return true;
  } catch (_) {
    return false;
  }
}

/** 목록에서 지운다. 없으면 false */
function forget(en) {
  const k = keyOf({ en });
  if (!k) return false;
  try {
    const cur = list();
    const next = cur.filter(v => keyOf(v) !== k);
    if (next.length === cur.length) return false;
    fs.writeFileSync(listPath(), JSON.stringify(next, null, 2));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  read, resolve, normalize, markFrom, UNSET, LIMITS, FILE, logoFrom, LOGO_MAX,
  list, listForClient, remember, forget, keyOf, LIST_FILE, LIST_MAX, LIST_LOGO_BUDGET,
};
