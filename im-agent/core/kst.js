'use strict';
/**
 * kst.js — 모든 날짜/시각 처리는 Asia/Seoul을 명시적으로 지정한다.
 * 서버 로컬타임(GitHub Actions = UTC)에 절대 의존하지 않는다.
 */

const TZ = 'Asia/Seoul';

/* ★ 2026-08-16 — 'sv-SE' 로케일 **출력 형식**에 기대지 않는다.
   [사고] Synology NAS 의 Node 20 은 ICU 는 있지만 sv-SE 로케일 데이터가 없어 en-US 로
          조용히 폴백했다("08/16/2026, 16:04:46"). slice(0,4) 가 "08/1" 이 되어 kstYear() 가
          NaN → 프로젝트 ID 가 LP-SOL-NaN-001 로 만들어지고 스키마 위반으로 생성이 막혔다.
          같은 코드가 macOS/GitHub Actions 에서는 정상이라 테스트로는 안 잡힌다.
   [규칙] 로케일이 아니라 **부품(formatToParts)** 으로 연·월·일·시·분·초를 꺼내 직접 조립한다.
          부품 이름(year/month/…)은 로케일과 무관하다. */
const DT_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});
function kstParts(d = new Date()) {
  const o = {};
  for (const p of DT_PARTS.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value;
  // 일부 ICU 는 자정을 "24" 로 낸다 — h23 를 지정해도 방어한다
  if (o.hour === '24') o.hour = '00';
  return o;
}
/** 'YYYY-MM-DD HH:mm:ss' — 예전 sv-SE 출력과 동일한 모양 */
const DT = {
  format(d = new Date()) {
    const o = kstParts(d);
    return `${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}:${o.second}`;
  },
};

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
