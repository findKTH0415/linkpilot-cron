'use strict';
/**
 * assetclass.js — **자산군마다 무엇을 받아야 하는가**의 단일 출처.
 *
 * 왜 필요한가: 지금까지 필수 항목은 문서 종류(IM·티저·재무모델)로만 갈렸다.
 * 그래서 호텔 딜에서도 객실 수를 안 물었고, 물류창고 딜에서도 층고를 안 물었다.
 * **그 값들이 없으면 매출 가정에 근거가 없다** — 객실 수를 모르면 객실매출을
 * 검증할 방법이 없고, 층고를 모르면 임대료 수준을 무엇과 견줄지 알 수 없다.
 * 그런데 화면은 「필수 17개 중 17개」라고 말하며 다 됐다고 한다.
 *
 * ★ 이 파일은 **무엇을 물을지**만 정한다. 값을 만들지 않는다.
 *   가정계수는 여전히 사람이 넣는다 (CLAUDE.md §4.8).
 *
 * ★ 재무 템플릿(`finance/templates.js`)과 **다른 축이다.**
 *   - 재무 템플릿 4종 = 현금흐름 모델의 기본 가정 (공사기간·금리·Cap Rate)
 *   - 자산군 12종 = IM 에 반드시 실려야 하는 값
 *   호텔과 오피스빌딩은 같은 재무 템플릿(realestate)을 쓰지만 받아야 할 값이
 *   전혀 다르다. 하나로 합치면 둘 중 하나가 반드시 틀린다. 그래서 각 자산군이
 *   `template` 으로 재무 템플릿을 가리키기만 한다.
 *
 * ★ `requires` 의 키는 **사전에 실제로 있는 것만** 쓴다. 없는 키를 적으면
 *   화면에 입력란이 안 생기는데 필수로는 세어져, 진행률이 영원히 100%가
 *   되지 않는다 (`assetclass.test.js` 가 잡는다).
 *
 * ★ `why` 는 장식이 아니다. 왜 이 값을 묻는지 화면에 그대로 나간다 —
 *   이유 없이 늘어난 입력란은 사용자가 대충 채우고, 대충 채운 값이 IM 에 실린다.
 *
 * 의존성 없음. 브라우저·Node 양쪽에서 동작한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotAssetClass = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @typedef {{id, label, en, template, keywords:string[], requires:Array<{key,why}>}} AssetClass
   *
   * template — `finance/templates.js` 의 id. 재무모델 기본 가정을 어디서 가져올지만 정한다.
   */
  var CLASSES = [
    {
      id: 'manufacturing', label: '제조', en: 'Manufacturing', template: 'generic',
      keywords: ['제조', '생산공장', 'manufacturing', '플랜트'],
      requires: [
        { key: 'capacity.production', why: '생산능력이 매출의 분모다. 모르면 연매출을 무엇으로 나눠 검증할지 알 수 없다' },
        { key: 'capacity.power_mw', why: '수전용량이 모자라면 증설이 물리적으로 막힌다 — 증설 전제 매출이 허공에 뜬다' },
        { key: 'land.area_sqm', why: '증설 여지를 판단하는 유일한 근거다' },
      ],
    },
    {
      id: 'infrastructure', label: '인프라스트럭처', en: 'Infrastructure', template: 'generic',
      keywords: ['인프라', 'infrastructure', '민자', 'BTO', 'BTL', '실시협약'],
      requires: [
        { key: 'schedule.concession_years', why: '운영권 기간이 현금흐름의 끝이다. 없으면 Exit 시점이 근거 없이 정해진다' },
        { key: 'schedule.ops_years', why: '운영권 기간과 어긋나면 협약보다 오래 버는 모델이 된다' },
        { key: 'revenue.annual', why: '수요예측이 아니라 협약 수입 기준인지 구분해야 한다' },
      ],
    },
    {
      id: 'logistics', label: '물류창고', en: 'Logistics Warehouse', template: 'realestate',
      keywords: ['물류', '물류창고', '물류센터', 'warehouse', 'logistics', '풀필먼트'],
      requires: [
        { key: 'capacity.leasable_sqm', why: '임대면적이 매출의 분모다. 연면적으로 대신 계산하면 매출이 부풀려진다' },
        { key: 'building.clear_height_m', why: '층고가 랙 단수를 정하고, 랙 단수가 임대료 수준을 정한다' },
        { key: 'building.floor_load_kn', why: '바닥하중이 안 맞으면 받을 수 있는 화주가 갈린다 — 임대료 비교 대상이 달라진다' },
        { key: 'capacity.dock_doors', why: '도크 수가 차량 회전율을 정한다. 같은 면적이라도 임차 수요가 다르다' },
      ],
    },
    {
      id: 'hotel', label: '호텔', en: 'Hotel', template: 'realestate',
      keywords: ['호텔', 'hotel', '숙박', '레지던스'],
      requires: [
        { key: 'capacity.rooms', why: '객실 수 × ADR × 점유율 이 객실매출이다 — 객실 수가 그 첫 항이다' },
        { key: 'revenue.adr', why: 'ADR 이 없으면 객실 수만으로는 매출이 안 나온다. 등급·입지에 따라 배가 갈린다' },
        { key: 'revenue.occupancy', why: '만실 전제로 계산하면 매출이 항상 최대치가 된다 — 그건 검토가 아니다' },
      ],
    },
    {
      id: 'datacenter', label: '데이터센터', en: 'Data Center', template: 'datacenter',
      keywords: ['데이터센터', 'data center', 'datacenter', 'IDC', '전산센터'],
      requires: [
        { key: 'capacity.it_load_mw', why: 'IT Load 가 임대 단위다 — 데이터센터는 면적이 아니라 kW 로 판다' },
        { key: 'capacity.power_mw', why: '수전용량이 IT Load 의 상한이다. 둘이 안 맞으면 팔 수 없는 용량을 판 것이 된다' },
        { key: 'capacity.pue', why: 'PUE 가 전력 운영비를 좌우한다. 빠지면 OPEX 가 근거 없는 비율로 잡힌다' },
      ],
    },
    {
      id: 'officetel', label: '오피스텔', en: 'Officetel', template: 'realestate',
      keywords: ['오피스텔', 'officetel'],
      requires: [
        { key: 'capacity.units', why: '분양·임대 단위가 호실이다. 면적만으로는 분양 수입을 못 만든다' },
        { key: 'capacity.leasable_sqm', why: '전용면적이 호실 단가의 기준이다' },
        { key: 'revenue.unit_price', why: '분양가(또는 임대료)가 없으면 호실 수만으로는 매출이 안 나온다' },
      ],
    },
    {
      id: 'mixed_use', label: '주상복합', en: 'Mixed-use Residential', template: 'realestate',
      keywords: ['주상복합', '복합개발', 'mixed use', '복합시설'],
      requires: [
        { key: 'capacity.units', why: '주거 부분의 매출 단위다' },
        { key: 'capacity.leasable_sqm', why: '상업 부분의 매출 단위다 — 주거와 단가 체계가 다르다' },
        { key: 'building.main_use', why: '용도별 면적을 안 나누면 한쪽 단가로 전체를 계산하게 된다' },
      ],
    },
    {
      id: 'apartment', label: '아파트', en: 'Apartment', template: 'realestate',
      keywords: ['아파트', '공동주택', 'apartment', '재건축', '재개발'],
      requires: [
        { key: 'capacity.units', why: '분양가 × 세대수 가 매출이다' },
        { key: 'revenue.unit_price', why: '분양가가 없으면 세대수만으로는 매출이 안 나온다. 이 값 하나가 사업성을 뒤집는다' },
        { key: 'legal.permit_status', why: '30세대 이상은 주택법 트랙이라 인허가 경로가 달라진다 (05 Validation 이 대조한다)' },
      ],
    },
    {
      id: 'office', label: '오피스빌딩', en: 'Office Building', template: 'realestate',
      keywords: ['오피스', '업무시설', 'office', '사옥'],
      requires: [
        { key: 'capacity.leasable_sqm', why: '임대면적 × 임대료 × 임대율 이 매출이다 — 연면적으로 대신 계산하면 부풀려진다' },
        { key: 'revenue.unit_price', why: '임대료 수준이 없으면 면적만으로는 매출이 안 나온다. 권역별로 크게 갈린다' },
        { key: 'revenue.occupancy', why: '만실 전제로 계산하면 매출이 항상 최대치가 된다 — 그건 검토가 아니다' },
      ],
    },
    {
      id: 'factory', label: '공장', en: 'Factory', template: 'realestate',
      keywords: ['공장', 'factory', '지식산업센터', '아파트형공장'],
      requires: [
        { key: 'land.zoning', why: '용도지역이 곧 가능 업종이다. 모르면 임차 가능한 업종을 특정할 수 없다' },
        { key: 'capacity.power_mw', why: '입주 업종이 요구하는 전력이 안 되면 그 임차 수요는 없는 것이다' },
        { key: 'building.gfa_sqm', why: '연면적이 임대·분양의 분모다' },
      ],
    },
    {
      id: 'industrial_park', label: '산업단지', en: 'Industrial Park', template: 'realestate',
      keywords: ['산업단지', '일반산업단지', '농공단지', 'industrial park', '단지조성'],
      requires: [
        { key: 'capacity.saleable_land_sqm', why: '총면적이 아니라 분양 가능 면적이 매출의 분모다. 도로·녹지·공공용지를 빼지 않으면 매출이 통째로 부풀려진다' },
        { key: 'land.area_sqm', why: '총면적과 분양 가능 면적의 차이가 곧 조성 원가의 성격을 말해 준다' },
        { key: 'land.use_districts', why: '유치 업종이 지역·지구로 제한된다' },
      ],
    },
    {
      id: 'resort', label: '리조트', en: 'Resort', template: 'realestate',
      keywords: ['리조트', 'resort', '콘도', '골프', '워터파크'],
      requires: [
        { key: 'capacity.rooms', why: '객실 수 × ADR × 점유율 이 숙박매출이다 — 부대시설 매출은 여기에 얹힌다' },
        { key: 'revenue.adr', why: 'ADR 이 없으면 객실 수만으로는 매출이 안 나온다. 성수기·비수기 평균인지 밝혀야 한다' },
        { key: 'revenue.occupancy', why: '리조트는 계절 편차가 커서 연평균 점유율을 못 박지 않으면 매출이 얼마든지 달라진다' },
        { key: 'land.area_sqm', why: '부지가 커서 토지비가 사업비를 좌우한다. 호텔과 갈리는 지점이다' },
      ],
    },
  ];

  var BY_ID = {};
  CLASSES.forEach(function (c) { BY_ID[c.id] = c; });

  /** 자산군의 전용 필수 키 (문서 종류 필수와 별개로 **더해지는** 것) */
  function requiredKeys(id) {
    var c = BY_ID[id];
    return c ? c.requires.map(function (r) { return r.key; }) : [];
  }

  /** 그 값을 왜 묻는지. 화면이 그대로 보여 준다 */
  function whyOf(id, key) {
    var c = BY_ID[id];
    if (!c) return null;
    for (var i = 0; i < c.requires.length; i++) {
      if (c.requires[i].key === key) return c.requires[i].why;
    }
    return null;
  }

  /** 재무모델 템플릿 id. 자산군이 없거나 모르면 generic */
  function templateOf(id) {
    var c = BY_ID[id];
    return c ? c.template : 'generic';
  }

  /**
   * 요청문·사업명에서 자산군을 짚는다. **못 짚으면 null 을 돌려준다** —
   * generic 으로 흘려보내면 그 자산군의 필수 항목이 통째로 안 물어봐지고,
   * 화면은 「다 채웠다」고 말한다.
   *
   * ★ 두 자산군이 함께 잡히면 **고르지 않는다** (CLAUDE.md §4.9).
   *   「주상복합 아파트」처럼 겹치는 말이 실제로 쓰인다.
   */
  function detect(text) {
    var t = String(text || '').toLowerCase();
    if (!t.trim()) return { id: null, candidates: [], reason: '문장이 비어 있습니다' };
    var hit = CLASSES.filter(function (c) {
      return c.keywords.some(function (k) { return t.indexOf(String(k).toLowerCase()) !== -1; });
    }).map(function (c) { return c.id; });

    if (hit.length === 1) return { id: hit[0], candidates: hit, reason: null };
    if (hit.length > 1) {
      return {
        id: null, candidates: hit,
        reason: '여러 자산군이 함께 읽힙니다 — 사람이 하나를 고릅니다',
      };
    }
    return { id: null, candidates: [], reason: '자산군을 짚을 말이 없습니다' };
  }

  /**
   * 화면이 쓰는 정의. `finance/templates.js` 의 `industryKeys` 와 같은 모양
   * (`own`/`foreign`)으로 돌려주므로 화면 코드가 그대로 돈다.
   *
   * @param {string} id 자산군 id
   * @param {object} FIELDS core/dictionary 의 FIELDS (주입 — 브라우저에서도 돌게)
   * @param {object} commonKeys 재무모델 공통 키 집합 (finance/templates COMMON_MAP 값)
   */
  function classKeys(id, FIELDS, commonKeys) {
    var fields = FIELDS || {};
    var own = {};
    (commonKeys || []).forEach(function (k) { own[k] = true; });
    requiredKeys(id).forEach(function (k) { own[k] = true; });

    // 문서 종류 필수는 자산군과 무관하게 남긴다 — 감추면 필수 항목이 화면에서
    // 사라지고, 사용자는 왜 진행률이 안 오르는지 알 수 없다
    Object.keys(fields).forEach(function (k) {
      if ((fields[k].requiredFor || []).length) own[k] = true;
    });

    var foreign = {};
    CLASSES.forEach(function (c) {
      if (c.id === id) return;
      requiredKeys(c.id).forEach(function (k) { if (!own[k]) foreign[k] = true; });
    });

    return { own: Object.keys(own).sort(), foreign: Object.keys(foreign).sort() };
  }

  return {
    CLASSES: CLASSES,
    requiredKeys: requiredKeys, whyOf: whyOf, templateOf: templateOf,
    detect: detect, classKeys: classKeys,
  };
}));
