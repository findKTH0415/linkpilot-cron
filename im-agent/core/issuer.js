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
 *   { "en": "...", "kr": "...", "tag": "...", "mark": "PDI", "contact": "..." }
 *   en 만 있어도 된다. mark 는 로고 자리 이니셜 — 없으면 en 에서 만든다.
 */

const fs = require('fs');
const path = require('path');

const FILE = 'issuer.json';

/** 이름에서 로고 자리 이니셜을 만든다 (최대 4글자) */
function markFrom(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const words = s.replace(/[(주)㈜]/g, ' ').split(/[\s,.]+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words.slice(0, 4).map(w => w[0]).join('').toUpperCase();
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

module.exports = { read, resolve, markFrom, UNSET, FILE };
