'use strict';
/**
 * kst.js — 모든 날짜/시각 처리는 Asia/Seoul을 명시적으로 지정한다.
 * 서버 로컬타임(GitHub Actions = UTC)에 절대 의존하지 않는다.
 */

const TZ = 'Asia/Seoul';

const DT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

/** '2026-08-13T06:05:00+09:00' */
function kstStamp(d = new Date()) {
  return DT.format(d).replace(' ', 'T') + '+09:00';
}

/** '2026-08-13' */
function kstDate(d = new Date()) {
  return DT.format(d).slice(0, 10);
}

/** 2026 (KST 기준 연도 — UTC 연도와 다를 수 있다) */
function kstYear(d = new Date()) {
  return Number(kstDate(d).slice(0, 4));
}

/** 파일/폴더명용 '20260813-060500' */
function kstSlug(d = new Date()) {
  return DT.format(d).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2');
}

/** ISO 날짜 문자열 간 경과일수 (act/365 계산용, 타임존 무관 순수 날짜 연산) */
function daysBetween(fromISO, toISO) {
  const a = Date.UTC(...fromISO.slice(0, 10).split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)));
  const b = Date.UTC(...toISO.slice(0, 10).split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)));
  return Math.round((b - a) / 86400000);
}

module.exports = { TZ, kstStamp, kstDate, kstYear, kstSlug, daysBetween };
