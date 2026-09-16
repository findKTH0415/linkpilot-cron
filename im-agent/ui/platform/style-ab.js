/* style-ab.js — 문서 종류별 **스타일 두 안(A·B)**.
 *
 * ★★★ 이 파일은 **손으로 고치지 않는다.** `npm run im:styles` 가
 *   `design/options.js` 를 돌려 만든다. 규칙은 그쪽 한 곳에 있고 여기는 결과다.
 *
 * ★ 앞 판은 화면(`reports.html`)에 테마 셋을 손으로 박아 두었는데, 그중 둘
 *   (`modern` · `pdi`)이 `themes.js` 에 **없는 이름**이었다 — 고르면 엔진이
 *   `알 수 없는 디자인 테마` 로 던진다. 화면에서는 멀쩡히 눌렸다.
 *
 * 의존성 없음. 브라우저·Node 양쪽에서 돈다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    var m = factory();
    root.LP_THEME_IDS = m.THEME_IDS;
    root.LP_STYLE_PAIRS = m.PAIRS;
    root.LP_THEME_CARDS = m.THEME_CARDS;
    root.lpStylePair = m.pair;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * ★ **이 스크립트가 어느 판인가** 〈D-93 · M-29〉.
   *   `build-stamp.js` 가 채운다 — 손으로 고치지 않는다. 생성기는 빈 값으로 내고,
   *   지문 찍기가 그 자리를 메운다. 그래서 다시 만들어도 지문이 안 흔들린다.
   */
  var LP_BUILD = '865a916d';

  /** themes.js 에 실제로 있는 이름 — 화면이 고른 값을 이 목록으로 거른다 */
  var THEME_IDS = ["institutional","global_ib","private_equity","real_estate","corporate","premium","minimal","technology","renewable","infrastructure","luxury","government","custom"];

  /** 문서 종류 → { A, B } */
  var PAIRS = {
    "im": {
      "A": {
        "id": "global_ib",
        "role": "A",
        "roleKr": "권장안",
        "name": "Global Investment Bank",
        "kr": "M&A / 글로벌 투자자",
        "color": "#0B1B2B",
        "shape": "사진+글자 분할 표지 · 표준 · 경영진 요약형 · 차트색 5단",
        "docFit": true
      },
      "B": {
        "id": "infrastructure",
        "role": "B",
        "roleKr": "보수·공식안",
        "name": "Infrastructure",
        "kr": "SOC / 물류 / 산업단지",
        "color": "#263238",
        "shape": "괘선 표지 · 표준 · 기술전문형 · 차트색 5단",
        "docFit": true
      },
      "axes": 2,
      "note": "두 안은 2가지가 갈린다 — 다만 **색은 가깝다**(둘 다 같은 계열). 갈리는 것은 형식이지 색이 아니다."
    },
    "teaser": {
      "A": {
        "id": "premium",
        "role": "A",
        "roleKr": "권장안",
        "name": "Premium",
        "kr": "호텔 / 복합개발 / 랜드마크",
        "color": "#14100E",
        "shape": "사진 전면 표지 · 여백형 · 투자설득형 · 차트색 5단",
        "docFit": true
      },
      "B": {
        "id": "minimal",
        "role": "B",
        "roleKr": "보수·공식안",
        "name": "Minimal",
        "kr": "CEO / Executive 보고",
        "color": "#111827",
        "shape": "괘선 표지 · 여백형 · 쉬운 설명형 · 차트색 5단",
        "docFit": true
      },
      "axes": 2,
      "note": "두 안은 2가지가 갈린다 — 다만 **색은 가깝다**(둘 다 같은 계열). 갈리는 것은 형식이지 색이 아니다."
    },
    "ic_memo": {
      "A": {
        "id": "institutional",
        "role": "A",
        "roleKr": "권장안",
        "name": "Institutional",
        "kr": "기관투자자 / PF / Credit",
        "color": "#10233C",
        "shape": "괘선 표지 · 표준 · 경영진 요약형 · 차트색 5단",
        "docFit": true
      },
      "B": {
        "id": "private_equity",
        "role": "B",
        "roleKr": "현대·시각안",
        "name": "Private Equity",
        "kr": "PE / VC / 대체투자",
        "color": "#14213D",
        "shape": "괘선 표지 · 고밀도 · 투자설득형 · 차트색 5단",
        "docFit": true
      },
      "axes": 2,
      "note": "두 안은 2가지가 갈린다 — 다만 **색은 가깝다**(둘 다 같은 계열). 갈리는 것은 형식이지 색이 아니다."
    },
    "financial_report": {
      "A": {
        "id": "institutional",
        "role": "A",
        "roleKr": "권장안",
        "name": "Institutional",
        "kr": "기관투자자 / PF / Credit",
        "color": "#10233C",
        "shape": "괘선 표지 · 표준 · 경영진 요약형 · 차트색 5단",
        "docFit": true
      },
      "B": {
        "id": "global_ib",
        "role": "B",
        "roleKr": "현대·시각안",
        "name": "Global Investment Bank",
        "kr": "M&A / 글로벌 투자자",
        "color": "#0B1B2B",
        "shape": "사진+글자 분할 표지 · 표준 · 경영진 요약형 · 차트색 5단",
        "docFit": true
      },
      "axes": 1,
      "note": "★ 이 딜에서는 갈리는 축이 1가지뿐이다 — 두 안이 비슷하다는 뜻이고, 그것이 사실이다 — 다만 **색은 가깝다**(둘 다 같은 계열). 갈리는 것은 형식이지 색이 아니다."
    },
    "technical_report": {
      "A": {
        "id": "institutional",
        "role": "A",
        "roleKr": "권장안",
        "name": "Institutional",
        "kr": "기관투자자 / PF / Credit",
        "color": "#10233C",
        "shape": "괘선 표지 · 표준 · 경영진 요약형 · 차트색 5단",
        "docFit": true
      },
      "B": {
        "id": "renewable",
        "role": "B",
        "roleKr": "현대·시각안",
        "name": "Renewable Energy",
        "kr": "Solar / Wind / ESS / Hydrogen",
        "color": "#0F3D2E",
        "shape": "사진 전면 표지 · 표준 · 기술전문형 · 차트색 5단",
        "docFit": true
      },
      "axes": 2,
      "note": "두 안은 2가지가 갈린다 — 다만 **색은 가깝다**(둘 다 같은 계열). 갈리는 것은 형식이지 색이 아니다."
    },
    "dd_report": {
      "A": {
        "id": "institutional",
        "role": "A",
        "roleKr": "권장안",
        "name": "Institutional",
        "kr": "기관투자자 / PF / Credit",
        "color": "#10233C",
        "shape": "괘선 표지 · 표준 · 경영진 요약형 · 차트색 5단",
        "docFit": true
      },
      "B": {
        "id": "global_ib",
        "role": "B",
        "roleKr": "현대·시각안",
        "name": "Global Investment Bank",
        "kr": "M&A / 글로벌 투자자",
        "color": "#0B1B2B",
        "shape": "사진+글자 분할 표지 · 표준 · 경영진 요약형 · 차트색 5단",
        "docFit": true
      },
      "axes": 1,
      "note": "★ 이 딜에서는 갈리는 축이 1가지뿐이다 — 두 안이 비슷하다는 뜻이고, 그것이 사실이다 — 다만 **색은 가깝다**(둘 다 같은 계열). 갈리는 것은 형식이지 색이 아니다."
    },
    "legal_dd": {
      "A": {
        "id": "institutional",
        "role": "A",
        "roleKr": "권장안",
        "name": "Institutional",
        "kr": "기관투자자 / PF / Credit",
        "color": "#10233C",
        "shape": "괘선 표지 · 표준 · 경영진 요약형 · 차트색 5단",
        "docFit": true
      },
      "B": {
        "id": "global_ib",
        "role": "B",
        "roleKr": "현대·시각안",
        "name": "Global Investment Bank",
        "kr": "M&A / 글로벌 투자자",
        "color": "#0B1B2B",
        "shape": "사진+글자 분할 표지 · 표준 · 경영진 요약형 · 차트색 5단",
        "docFit": true
      },
      "axes": 1,
      "note": "★ 이 딜에서는 갈리는 축이 1가지뿐이다 — 두 안이 비슷하다는 뜻이고, 그것이 사실이다 — 다만 **색은 가깝다**(둘 다 같은 계열). 갈리는 것은 형식이지 색이 아니다."
    },
    "pf_proposal": {
      "A": {
        "id": "institutional",
        "role": "A",
        "roleKr": "권장안",
        "name": "Institutional",
        "kr": "기관투자자 / PF / Credit",
        "color": "#10233C",
        "shape": "괘선 표지 · 표준 · 경영진 요약형 · 차트색 5단",
        "docFit": true
      },
      "B": {
        "id": "renewable",
        "role": "B",
        "roleKr": "현대·시각안",
        "name": "Renewable Energy",
        "kr": "Solar / Wind / ESS / Hydrogen",
        "color": "#0F3D2E",
        "shape": "사진 전면 표지 · 표준 · 기술전문형 · 차트색 5단",
        "docFit": true
      },
      "axes": 2,
      "note": "두 안은 2가지가 갈린다 — 다만 **색은 가깝다**(둘 다 같은 계열). 갈리는 것은 형식이지 색이 아니다."
    },
    "feasibility": {
      "A": {
        "id": "infrastructure",
        "role": "A",
        "roleKr": "권장안",
        "name": "Infrastructure",
        "kr": "SOC / 물류 / 산업단지",
        "color": "#263238",
        "shape": "괘선 표지 · 표준 · 기술전문형 · 차트색 5단",
        "docFit": true
      },
      "B": {
        "id": "real_estate",
        "role": "B",
        "roleKr": "현대·시각안",
        "name": "Real Estate Investment",
        "kr": "부동산 개발 / 매입 / 매각",
        "color": "#12314B",
        "shape": "사진 전면 표지 · 표준 · 투자설득형 · 차트색 5단",
        "docFit": true
      },
      "axes": 2,
      "note": "두 안은 2가지가 갈린다 — 다만 **색은 가깝다**(둘 다 같은 계열). 갈리는 것은 형식이지 색이 아니다."
    },
    "investor_presentation": {
      "A": {
        "id": "institutional",
        "role": "A",
        "roleKr": "권장안",
        "name": "Institutional",
        "kr": "기관투자자 / PF / Credit",
        "color": "#10233C",
        "shape": "괘선 표지 · 표준 · 경영진 요약형 · 차트색 5단",
        "docFit": true
      },
      "B": {
        "id": "premium",
        "role": "B",
        "roleKr": "현대·시각안",
        "name": "Premium",
        "kr": "호텔 / 복합개발 / 랜드마크",
        "color": "#14100E",
        "shape": "사진 전면 표지 · 여백형 · 투자설득형 · 차트색 5단",
        "docFit": true
      },
      "axes": 3,
      "note": "두 안은 3가지가 갈린다 — 다만 **색은 가깝다**(둘 다 같은 계열). 갈리는 것은 형식이지 색이 아니다."
    },
    "dashboard": {
      "A": {
        "id": "corporate",
        "role": "A",
        "roleKr": "권장안",
        "name": "Corporate",
        "kr": "기업 보고서 / 사업계획서",
        "color": "#17457A",
        "shape": "괘선 표지 · 표준 · 경영진 요약형 · 차트색 5단",
        "docFit": true
      },
      "B": {
        "id": "technology",
        "role": "B",
        "roleKr": "현대·시각안",
        "name": "Technology / Data Center",
        "kr": "Data Center / AI / ICT",
        "color": "#0E1A2B",
        "shape": "사진+글자 분할 표지 · 고밀도 · 기술전문형 · 차트색 5단",
        "docFit": true
      },
      "axes": 4,
      "note": "두 안은 4가지가 갈린다 — 색까지 갈린다."
    }
  };

  /** 테마 13종의 표지 그리는 값 — 화면이 「모양 보고 고르기」에 쓴다 */
  var THEME_CARDS = [
    {
      "id": "institutional",
      "no": "01",
      "name": "Institutional",
      "kr": "기관투자자 / PF / Credit",
      "purpose": "은행·기관투자자·금융기관·Credit Committee 제출용",
      "shape": "rule",
      "color": "#10233C",
      "accent": "#A6813C",
      "surface": "#F7F5F0",
      "serif": true
    },
    {
      "id": "global_ib",
      "no": "02",
      "name": "Global Investment Bank",
      "kr": "M&A / 글로벌 투자자",
      "purpose": "글로벌 투자은행 및 해외 투자자용",
      "shape": "split",
      "color": "#0B1B2B",
      "accent": "#B08D57",
      "surface": "#F6F4EF",
      "serif": true
    },
    {
      "id": "private_equity",
      "no": "03",
      "name": "Private Equity",
      "kr": "PE / VC / 대체투자",
      "purpose": "PE·VC·Alternative Investment Fund",
      "shape": "rule",
      "color": "#14213D",
      "accent": "#C9A227",
      "surface": "#F6F5F1",
      "serif": true
    },
    {
      "id": "real_estate",
      "no": "04",
      "name": "Real Estate Investment",
      "kr": "부동산 개발 / 매입 / 매각",
      "purpose": "부동산 개발·매입·매각·투자 프로젝트",
      "shape": "full",
      "color": "#12314B",
      "accent": "#A6813C",
      "surface": "#F7F5F0",
      "serif": true
    },
    {
      "id": "corporate",
      "no": "05",
      "name": "Corporate",
      "kr": "기업 보고서 / 사업계획서",
      "purpose": "기업 보고서 및 사업계획서",
      "shape": "rule",
      "color": "#17457A",
      "accent": "#8C6D3F",
      "surface": "#F5F7FA",
      "serif": true
    },
    {
      "id": "premium",
      "no": "06",
      "name": "Premium",
      "kr": "호텔 / 복합개발 / 랜드마크",
      "purpose": "호텔·복합개발·고급 주거·랜드마크 프로젝트",
      "shape": "full",
      "color": "#14100E",
      "accent": "#C9A15A",
      "surface": "#F8F5F0",
      "serif": true
    },
    {
      "id": "minimal",
      "no": "07",
      "name": "Minimal",
      "kr": "CEO / Executive 보고",
      "purpose": "경영진 보고 및 Executive Presentation",
      "shape": "rule",
      "color": "#111827",
      "accent": "#6B7280",
      "surface": "#F7F7F8",
      "serif": true
    },
    {
      "id": "technology",
      "no": "08",
      "name": "Technology / Data Center",
      "kr": "Data Center / AI / ICT",
      "purpose": "Data Center·AI Infrastructure·Cloud·ICT 프로젝트",
      "shape": "split",
      "color": "#0E1A2B",
      "accent": "#2FA8B8",
      "surface": "#F2F7F8",
      "serif": true
    },
    {
      "id": "renewable",
      "no": "09",
      "name": "Renewable Energy",
      "kr": "Solar / Wind / ESS / Hydrogen",
      "purpose": "재생에너지·에너지 인프라 프로젝트",
      "shape": "full",
      "color": "#0F3D2E",
      "accent": "#7FA650",
      "surface": "#F3F7F3",
      "serif": true
    },
    {
      "id": "infrastructure",
      "no": "10",
      "name": "Infrastructure",
      "kr": "SOC / 물류 / 산업단지",
      "purpose": "도로·철도·항만·발전소·산업단지·물류",
      "shape": "rule",
      "color": "#263238",
      "accent": "#C07C2C",
      "surface": "#F5F6F7",
      "serif": true
    },
    {
      "id": "luxury",
      "no": "11",
      "name": "Luxury / Hospitality",
      "kr": "호텔 / 리조트 / 복합관광",
      "purpose": "호텔·리조트·복합관광개발",
      "shape": "full",
      "color": "#1B1410",
      "accent": "#BFA06A",
      "surface": "#F9F6F1",
      "serif": true
    },
    {
      "id": "government",
      "no": "12",
      "name": "Government / Public",
      "kr": "공공기관 / 지자체 / 정책사업",
      "purpose": "공공기관·지자체·정책사업·공공투자",
      "shape": "rule",
      "color": "#12365E",
      "accent": "#6E7A8C",
      "surface": "#F4F6F9",
      "serif": true
    },
    {
      "id": "custom",
      "no": "13",
      "name": "Custom",
      "kr": "사용자 지정",
      "purpose": "사용자가 직접 지정하거나 Brand Kit 을 적용",
      "shape": "rule",
      "color": "#10233C",
      "accent": "#A6813C",
      "surface": "#F7F5F0",
      "serif": true
    }
  ];

  /** 그 문서의 두 안. 모르는 종류면 기본(im)으로 돌려준다 — 지어내지 않는다 */
  function pair(docType) {
    return PAIRS[docType] || PAIRS.im || null;
  }

  return { BUILD: LP_BUILD, THEME_IDS: THEME_IDS, PAIRS: PAIRS, THEME_CARDS: THEME_CARDS, pair: pair };
}));
