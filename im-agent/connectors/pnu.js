'use strict';
/**
 * pnu.js — 필지고유번호(PNU) 분해.
 *
 * PNU 19자리 = 법정동코드(10) + 대지구분(1) + 본번(4) + 부번(4)
 *   법정동코드(10) = 시군구코드(5) + 법정동코드(5)
 *
 * 지오코딩 1회로 얻은 PNU 하나에서 실거래가·건축물대장·공시지가 호출에 필요한
 * 코드들을 전부 파생시킨다 → 공공데이터 호출 횟수를 최소화한다.
 */

function parse(pnu) {
  const s = String(pnu || '').replace(/\D/g, '');
  if (s.length !== 19) return null;
  return {
    pnu: s,
    lawdCd: s.slice(0, 10),      // 법정동코드 10자리
    sigunguCd: s.slice(0, 5),    // 시군구코드 (실거래가 LAWD_CD)
    bjdongCd: s.slice(5, 10),    // 법정동코드 5자리
    landType: s.slice(10, 11),   // 1=일반, 2=산
    bun: s.slice(11, 15),        // 본번
    ji: s.slice(15, 19),         // 부번
    jibun: `${Number(s.slice(11, 15))}${Number(s.slice(15, 19)) ? '-' + Number(s.slice(15, 19)) : ''}`,
    isMountain: s.slice(10, 11) === '2',
  };
}

/** 실거래가 조회용 최근 N개월 YYYYMM 배열 (KST 기준) */
function recentMonths(n, fromDateISO) {
  const base = fromDateISO ? fromDateISO.slice(0, 7) : null;
  const [y, m] = base
    ? base.split('-').map(Number)
    : (() => {
      const d = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' })
        .format(new Date()).split('-').map(Number);
      return d;
    })();

  const out = [];
  let year = y, month = m;
  for (let i = 0; i < n; i++) {
    out.push(`${year}${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  return out;
}

module.exports = { parse, recentMonths };
