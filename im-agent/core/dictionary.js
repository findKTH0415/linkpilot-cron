'use strict';
/**
 * dictionary.js — Data Dictionary.
 *
 * 모든 프로젝트가 동일한 key 체계를 쓴다. 여기에 없는 key는 IM/재무모델에 들어가지 못한다.
 * (자유 서술 항목은 narrative.* 로 별도 관리)
 *
 * 정규화 단위(고정):
 *   금액  = 억원   (KRW 100M)
 *   면적  = ㎡
 *   전력  = MW
 *   비율  = %      (5.5 = 5.5%)
 *   기간  = 년
 */

const CATEGORY = {
  PROJECT: 'Project', LAND: 'Land', BUILDING: 'Building', CAPACITY: 'Capacity',
  INVESTMENT: 'Investment', REVENUE: 'Revenue', OPEX: 'OPEX', DEBT: 'Debt',
  EQUITY: 'Equity', TAX: 'Tax', SCHEDULE: 'Schedule', EXIT: 'Exit', LEGAL: 'Legal',
  // ★ 값이 아니라 **무엇을 대조할지 고르는 값**이다. 여기 있는 항목은 IM 본문에
  //   실리지 않는다 — 공공데이터를 어느 업종·어느 품목으로 부를지만 정한다.
  //   자동으로 고를 수 없어 사람이 넣는다 (§4.9). 등록부 D-48.
  CROSSCHECK: 'Crosscheck',
};

/**
 * field: { label, category, unit, type, aliases[], min, max, tolerance, requiredFor[] }
 *  - aliases: 문서에서 이 항목을 가리키는 표기 (추출 Agent가 사용)
 *  - tolerance: 값 충돌 판정 상대오차
 *  - requiredFor: 'financial' | 'im' | 'teaser'
 */
const FIELDS = {
  // ── Project ────────────────────────────────────────────────
  'project.name':        { label: '사업명', category: CATEGORY.PROJECT, unit: null, type: 'string', aliases: ['사업명', '프로젝트명', 'Project Name'], requiredFor: ['im', 'teaser'] },
  'project.assetType':   { label: '자산유형', category: CATEGORY.PROJECT, unit: null, type: 'string', aliases: ['자산유형', 'Asset Type'], requiredFor: ['im', 'teaser', 'financial'] },
  'project.sponsor':     { label: '시행사/스폰서', category: CATEGORY.PROJECT, unit: null, type: 'string', aliases: ['시행사', '시행자', '사업주체', 'Sponsor', 'Developer'], requiredFor: ['im'] },
  'project.location':    { label: '소재지', category: CATEGORY.PROJECT, unit: null, type: 'string', aliases: ['소재지', '주소', '위치', 'Location', 'Address'], requiredFor: ['im', 'teaser'] },

  // ── Land / Building ────────────────────────────────────────
  'land.area_sqm':       { label: '대지면적', category: CATEGORY.LAND, unit: '㎡', type: 'number', aliases: ['대지면적', '토지면적', '부지면적', 'Site Area', 'Land Area'], min: 0, tolerance: 0.001, requiredFor: ['im'] },
  'land.ownership':      { label: '토지 확보상태', category: CATEGORY.LAND, unit: null, type: 'string', aliases: ['토지소유', '소유권', '토지확보', 'Ownership'], requiredFor: ['im'] },
  'land.zoning':         { label: '용도지역', category: CATEGORY.LAND, unit: null, type: 'string', aliases: ['용도지역', '지목', 'Zoning'] },
  // 토지이용계획확인서의 지역·지구 전체. 대표 용도지역 하나만 보면 고도제한·
  // 토지거래허가 같은 조건이 통째로 사라진다 — 그것들이 딜을 좌우한다.
  //
  // ★ 두 작업선이 같은 것을 서로 다른 이름으로 담고 있었다 (`land.restrictions`).
  //   **실제 응답을 보고 만든 이쪽 이름으로 통일한다** (2026-08-16 병합).
  'land.use_districts':  { label: '지역·지구 지정 현황', category: CATEGORY.LAND, unit: null, type: 'string', aliases: ['지역지구', '토지이용계획', '지역·지구', '규제사항', '행위제한', '지구단위계획', '개발제한', 'Restrictions'] },
  'building.gfa_sqm':    { label: '연면적', category: CATEGORY.BUILDING, unit: '㎡', type: 'number', aliases: ['연면적', '총연면적', 'GFA', 'Gross Floor Area'], min: 0, tolerance: 0.001, requiredFor: ['im'] },
  'building.floors':     { label: '층수', category: CATEGORY.BUILDING, unit: '층', type: 'number', aliases: ['층수', '규모', 'Floors'], min: 0 },

  // ── Capacity ───────────────────────────────────────────────
  'capacity.it_load_mw': { label: 'IT Load', category: CATEGORY.CAPACITY, unit: 'MW', type: 'number', aliases: ['IT Load', 'IT부하', 'IT 용량', '전산부하'], min: 0, requiredFor: ['im', 'teaser'] },
  'capacity.power_mw':   { label: '수전용량', category: CATEGORY.CAPACITY, unit: 'MW', type: 'number', aliases: ['수전용량', '계약전력', '총 전력', 'Power Capacity'], min: 0 },
  'capacity.pue':        { label: 'PUE', category: CATEGORY.CAPACITY, unit: null, type: 'number', aliases: ['PUE'], min: 1.0, max: 2.5 },
  // REC 현물시장 실거래 단가. 시장가격이라 가정치가 아니다 — 사용자가 넣은
  // 매출 가정을 교차검증하는 근거로 쓴다. 매출 자동 산출은 하지 않는다(D-25).
  'market.rec_price':      { label: 'REC 단가', category: CATEGORY.REVENUE, unit: '원/REC', type: 'number', aliases: ['REC단가', 'REC가격', 'REC 현물가'], min: 0 },
  // 태양광 전용. 발전량이 아니라 **일사량까지만** 둔다 — 발전량은 시스템효율(PR)
  // 가정이 들어가고, 가정치는 IM 에 넣지 않는다 (2026-08-15 결정, 등록부 D-25).
  'site.solar_irradiance': { label: '연간 일사량', category: CATEGORY.CAPACITY, unit: 'kWh/㎡·년', type: 'number', aliases: ['일사량', '연간일사량', 'Irradiance', 'GHI'], min: 0 },
  'site.sunshine_hours':   { label: '연간 일조시간', category: CATEGORY.CAPACITY, unit: 'hr', type: 'number', aliases: ['일조시간', '연간일조시간'], min: 0 },
  // 풍력 전용. **일사량과 같은 자리다** — 풍속까지만 두고 발전량은 내지 않는다.
  // 발전량 = ½ρAv³ × Cp × 가동률인데 Cp·가동률·손실이 전부 가정이고, 풍속은
  // 세제곱으로 들어가 **1m/s 차이가 발전량을 30% 넘게 흔든다** (D-25 와 같은 줄).
  //
  // ★ 풍속은 **허브 높이 없이는 뜻이 없다.** 기상청 지상관측은 10m 기준이고
  //   허브는 통상 80~140m다. 둘을 잇는 것은 전단지수(α)인데 그것이 가정이다 —
  //   그래서 둘을 **짝으로** 받는다. 높이 없는 풍속은 쓰지 않는다.
  'site.wind_speed':       { label: '연평균 풍속', category: CATEGORY.CAPACITY, unit: 'm/s', type: 'number', aliases: ['풍속', '연평균풍속', 'Wind Speed'], min: 0, max: 20 },
  'site.hub_height_m':     { label: '허브 높이', category: CATEGORY.CAPACITY, unit: 'm', type: 'number', aliases: ['허브높이', '허브 높이', 'Hub Height'], min: 0 },
  'capacity.turbine_count': { label: '터빈 기수', category: CATEGORY.CAPACITY, unit: '기', type: 'number', aliases: ['터빈수', '기수', '풍력기수', 'Turbines'], min: 0 },
  'capacity.turbine_mw':   { label: '터빈 단기 용량', category: CATEGORY.CAPACITY, unit: 'MW', type: 'number', aliases: ['터빈용량', '단기용량', '기당 용량'], min: 0 },
  'capacity.wind_mw':      { label: '설비용량(풍력)', category: CATEGORY.CAPACITY, unit: 'MW', type: 'number', aliases: ['설비용량', '발전용량', '풍력 설비용량'], min: 0 },
  // 해상 전용. 이 둘이 해상풍력 사업비의 대부분을 정한다 — 그리고 **REC
  // 가중치가 이 둘로 갈린다**(연계거리·수심 복합 부여).
  'site.water_depth_m':    { label: '수심 (해상)', category: CATEGORY.CAPACITY, unit: 'm', type: 'number', aliases: ['수심', 'Water Depth'], min: 0 },
  'site.distance_to_shore_km': { label: '이안거리 (해상)', category: CATEGORY.CAPACITY, unit: 'km', type: 'number', aliases: ['이안거리', '연계거리', 'Distance to Shore'], min: 0 },
  // ESS 전용. **발전이 아니라 저장이라 성격이 다르다** (등록부 D-56).
  //
  // ★ **MWh 와 MW 는 짝이다.** 「100MWh ESS」만으로는 몇 시간짜리인지 모른다 —
  //   100MWh/100MW(1시간)와 100MWh/25MW(4시간)는 **수익모델도 사업비도 다른
  //   사업이다.** 둘 중 하나만 받으면 나머지를 가정으로 메우게 된다.
  // ★ **열화가 ESS 고유의 함정이다.** 배터리는 해마다 용량이 준다. 초기 용량으로
  //   전 기간 매출을 깔면 통째로 부풀려지는데, 문서에는 그 사실이 안 남는다.
  'capacity.ess_mwh':        { label: '저장용량', category: CATEGORY.CAPACITY, unit: 'MWh', type: 'number', aliases: ['저장용량', '배터리용량', '에너지용량', 'ESS 용량'], min: 0 },
  'capacity.ess_mw':         { label: '출력용량(PCS)', category: CATEGORY.CAPACITY, unit: 'MW', type: 'number', aliases: ['출력용량', 'PCS용량', 'PCS 용량', '충방전 출력'], min: 0 },
  'capacity.ess_degradation': { label: '연간 열화율', category: CATEGORY.CAPACITY, unit: '%/년', type: 'number', aliases: ['열화율', '용량저하율', 'Degradation'], min: 0, max: 20 },
  // 국내 ESS 는 화재 이후 충전율 상한 규제를 겪었다. 상한이 걸리면 **실효 용량이
  // 줄어드는데 사업계획서는 정격 용량으로 적혀 온다**
  'capacity.ess_soc_limit':  { label: 'SOC 상한', category: CATEGORY.CAPACITY, unit: '%', type: 'number', aliases: ['SOC 상한', '충전율 상한', '충전상한'], min: 0, max: 100 },
  // 무엇으로 버는 사업인지 — 이것이 안 정해지면 매출의 성격 자체를 모른다
  'revenue.ess_model':       { label: 'ESS 수익모델', category: CATEGORY.REVENUE, unit: null, type: 'string', aliases: ['수익모델', '정산방식', 'ESS 수익구조'] },
  'capacity.dc_kw':      { label: '설비용량(DC)', category: CATEGORY.CAPACITY, unit: 'kW', type: 'number', aliases: ['설비용량', 'DC용량', '모듈용량'], min: 0 },
  'capacity.ac_kw':      { label: '설비용량(AC)', category: CATEGORY.CAPACITY, unit: 'kW', type: 'number', aliases: ['AC용량', '인버터용량', '발전용량'], min: 0 },
  // 태양광 전용 (등록부 D-58).
  //
  // ★ **부지 유형이 REC 가중치를 가른다.** 임야는 다른 부지보다 낮게 매겨진다 —
  //   같은 용량이라도 매출이 갈리는데, 사업계획서에는 「태양광」이라고만 적혀 온다.
  // ★ **경사각·방위각이 있어야 일사량을 발전 기준으로 옮길 수 있다.** 기상청
  //   일사량은 **수평면(GHI)** 이고 모듈은 기울어져 있다 — 그 변환이 가정이라
  //   우리가 하지 않는다(D-25 와 같은 자리). 다만 값은 받아 적는다.
  'site.land_category':  { label: '부지 유형', category: CATEGORY.CAPACITY, unit: null, type: 'string', aliases: ['지목', '부지유형', '설치유형'], note: '임야·농지·잡종지·건축물·수상 — **REC 가중치가 여기서 갈린다**' },
  'site.tilt_angle':     { label: '모듈 경사각', category: CATEGORY.CAPACITY, unit: '°', type: 'number', aliases: ['경사각', '설치각', 'Tilt'], min: 0, max: 90 },
  'site.azimuth':        { label: '모듈 방위각', category: CATEGORY.CAPACITY, unit: '°', type: 'number', aliases: ['방위각', 'Azimuth'], min: 0, max: 360 },
  'legal.setback_m':     { label: '이격거리 조례', category: CATEGORY.LEGAL, unit: 'm', type: 'number', aliases: ['이격거리', '이격', 'Setback'], min: 0, note: '지자체 조례. 도로·주거에서 얼마를 띄워야 하는지 — **이것 하나로 부지가 통째로 못 쓰게 된다**' },
  'capacity.leasable_sqm': { label: '임대면적', category: CATEGORY.CAPACITY, unit: '㎡', type: 'number', aliases: ['임대면적', '전용면적', 'NLA', 'Leasable Area'], min: 0 },

  // ── 자산군 전용 지표 ───────────────────────────────────────
  //
  // ★ **requiredFor 를 붙이지 않는다.** 여기 붙이면 태양광 딜에서도 객실 수를
  //   묻는다. 자산군별 필수는 `core/assetclass.js` 가 정하고, 그 자산군을
  //   고른 프로젝트에서만 필수가 된다.
  // ★ 셋 다 있어야 뜻이 있는 값들이 있다 (객실수 × ADR × 점유율 = 매출).
  //   하나만 받아 두면 나머지를 가정으로 메우게 되고, 그건 §4.8 위반이다.
  'capacity.rooms':          { label: '객실 수', category: CATEGORY.CAPACITY, unit: '실', type: 'number', aliases: ['객실수', '객실 수', '실수', 'Keys', 'Rooms'], min: 0 },
  'capacity.units':          { label: '세대수/호실수', category: CATEGORY.CAPACITY, unit: '호', type: 'number', aliases: ['세대수', '가구수', '호실수', '분양세대', 'Units'], min: 0 },
  'capacity.dock_doors':     { label: '도크 수', category: CATEGORY.CAPACITY, unit: '개', type: 'number', aliases: ['도크', '도크수', 'Dock', 'Loading Dock'], min: 0 },
  'capacity.saleable_land_sqm': { label: '분양가능 면적', category: CATEGORY.CAPACITY, unit: '㎡', type: 'number', aliases: ['분양면적', '분양가능면적', '유효분양면적', 'Saleable Area'], min: 0 },
  // 단위가 업종마다 다르다 (톤·대·매). 숫자로 강제하면 단위를 잃는다 —
  // 단위째로 받아 적고, 계산에는 쓰지 않는다
  'capacity.production':     { label: '생산능력', category: CATEGORY.CAPACITY, unit: null, type: 'string', aliases: ['생산능력', '생산량', 'CAPA', 'Capacity', '연산'] },
  // ── 대조 선택값 (제조 딜) ──────────────────────────────────
  //
  // ★ **IM 에 실리는 값이 아니다.** 공공데이터를 어느 업종·어느 품목·어느 사업장으로
  //   부를지만 정한다. 비워 두면 그 대조만 건너뛴다 — 보고서는 그대로 나온다.
  // ★ **자동으로 고르지 않는다** (§4.9). 업종을 잘못 잡아도 계수는 그럴듯하게
  //   나오고 문서에는 「대조함」만 남는다. 그래서 사람이 고른다.
  // ★ 별칭을 두지 않는다 — 원본자료에서 뽑을 수 있는 값이 아니다.
  //   (별칭이 있으면 `fieldplan` 이 「자료 추출」로 분류해 안 물어본다)
  'crosscheck.ppi_item':     { label: '생산자물가 업종코드', category: CATEGORY.CROSSCHECK, unit: null, type: 'string', aliases: [], note: '단가 시점수정에 쓴다. ECOS 업종 목록에서 고른다 — 「1차 금속」과 「기타 기계 및 장비」는 몇 년 새 두 자릿수로 갈린다' },
  'crosscheck.kosis_table':  { label: '가동률 통계표 ID', category: CATEGORY.CROSSCHECK, unit: null, type: 'string', aliases: [], note: 'KOSIS 통계표. 같은 조사에 지수(2020=100)와 평균가동률(%)이 함께 있다' },
  'crosscheck.kosis_item':   { label: '가동률 항목코드', category: CATEGORY.CROSSCHECK, unit: null, type: 'string', aliases: [], note: '**% 항목**을 고른다. 지수를 고르면 「가동률 102%」가 나온다' },
  'crosscheck.factory_name': { label: '공장등록 조회 상호', category: CATEGORY.CROSSCHECK, unit: null, type: 'string', aliases: [], note: '생산능력의 물리적 상한(제조시설면적)을 본다. 같은 이름이 여럿이면 고르지 않고 후보를 보여 준다' },
  'crosscheck.hs_code':      { label: 'HS 코드', category: CATEGORY.CROSSCHECK, unit: null, type: 'string', aliases: [], note: '수출입 실거래 단가를 본다. 4·6·10단위' },
  'crosscheck.sales_channel': { label: '판로 (수출/내수)', category: CATEGORY.CROSSCHECK, unit: null, type: 'string', aliases: [], note: '내수 딜은 수출단가와 견주지 않는다 — FOB 기준이라 기준 자체가 다르다' },
  'crosscheck.enviro_name':  { label: '환경 인허가 조회 상호', category: CATEGORY.CROSSCHECK, unit: null, type: 'string', aliases: [], note: '통합환경허가·대기·수질·배출권. **「확인되지 않음」은 「문제 없음」이 아니다**' },

  // ── 전력계통 (데이터센터·태양광·풍력) — 등록부 D-54 ────────
  //
  // ★ 위 넷과 성격이 갈린다. `grid_region` 은 **조회를 부르는 값**이고,
  //   나머지 셋은 **API 로 나오지 않아 사람이 받아 적는 값**이다.
  //   변전소 좌표가 국가중요시설 사유로 비식별 처리되어 거리를 계산할 방법이 없다.
  'crosscheck.grid_region':       { label: '계통 조회 지역', category: CATEGORY.CROSSCHECK, unit: null, type: 'string', aliases: [], note: '시·군·구. 선로별 여유용량을 부른다 — **전국 값으로 대체하지 않는다**' },
  'crosscheck.substation_name':   { label: '변전소명 (사전검토 회신)', category: CATEGORY.CROSSCHECK, unit: null, type: 'string', aliases: [], note: '한전 지사 사전검토에서 받아 적는다. **API 로는 안 나온다** — 좌표가 비식별 처리된다' },
  'crosscheck.substation_km':     { label: '변전소 거리', category: CATEGORY.CROSSCHECK, unit: 'km', type: 'number', aliases: [], min: 0, note: '사전검토 회신값. 자동 산출이 불가능한 자리다' },
  'crosscheck.substation_km_basis': { label: '거리 기준 (직선/선로)', category: CATEGORY.CROSSCHECK, unit: null, type: 'string', aliases: [], note: '**밝히지 않으면 그 거리는 쓰지 않는다** — 직선과 선로가 실무상 1.3~2배 갈린다' },
  'crosscheck.grid_reviewed_at':  { label: '사전검토 회신일', category: CATEGORY.CROSSCHECK, unit: null, type: 'string', aliases: [], note: '여유용량은 시점 스냅샷이다. 회신일이 없으면 언제 기준인지 모른다' },

  'building.clear_height_m': { label: '유효층고', category: CATEGORY.BUILDING, unit: 'm', type: 'number', aliases: ['층고', '유효층고', '천장고', 'Clear Height'], min: 0, max: 30 },
  'building.floor_load_kn':  { label: '바닥하중', category: CATEGORY.BUILDING, unit: 'kN/㎡', type: 'number', aliases: ['바닥하중', '적재하중', 'Floor Load'], min: 0 },
  'revenue.adr':             { label: '평균 객실단가(ADR)', category: CATEGORY.REVENUE, unit: '원/실·박', type: 'number', aliases: ['ADR', '객실단가', '평균객실요금', 'Average Daily Rate'], min: 0 },
  'revenue.occupancy':       { label: '점유율/임대율', category: CATEGORY.REVENUE, unit: '%', type: 'number', aliases: ['점유율', '객실점유율', '임대율', '공실률', 'Occupancy', 'OCC'], min: 0, max: 100 },
  'schedule.concession_years': { label: '운영권 기간', category: CATEGORY.SCHEDULE, unit: '년', type: 'number', aliases: ['운영권', '관리운영권', '실시협약기간', 'Concession'], min: 0, max: 60 },

  // ── Investment (금액 = 억원) ────────────────────────────────
  'investment.total':        { label: '총사업비', category: CATEGORY.INVESTMENT, unit: '억원', type: 'number', aliases: ['총사업비', '총투자비', '사업비', 'Total Project Cost', 'TPC'], min: 0, tolerance: 0.005, requiredFor: ['financial', 'im', 'teaser'] },
  'investment.land':         { label: '토지비', category: CATEGORY.INVESTMENT, unit: '억원', type: 'number', aliases: ['토지비', '토지매입비', '용지비', 'Land Cost'], min: 0, tolerance: 0.005, requiredFor: ['financial'] },
  'investment.construction': { label: '공사비', category: CATEGORY.INVESTMENT, unit: '억원', type: 'number', aliases: ['공사비', '건축공사비', '도급공사비', 'CAPEX', 'Construction Cost'], min: 0, tolerance: 0.005, requiredFor: ['financial'] },
  'investment.other':        { label: '기타사업비', category: CATEGORY.INVESTMENT, unit: '억원', type: 'number', aliases: ['기타사업비', '간접비', '설계감리비', 'Soft Cost'], min: 0, tolerance: 0.005 },
  'investment.contingency_pct': { label: '예비비율', category: CATEGORY.INVESTMENT, unit: '%', type: 'number', aliases: ['예비비', 'Contingency'], min: 0, max: 30 },

  // ── Revenue / OPEX ─────────────────────────────────────────
  'revenue.annual':      { label: '연간 매출(안정화)', category: CATEGORY.REVENUE, unit: '억원', type: 'number', aliases: ['연매출', '연간매출', '안정화매출', 'Annual Revenue'], min: 0, tolerance: 0.005, requiredFor: ['financial'] },
  'revenue.unit_price':  { label: '단가/임대료', category: CATEGORY.REVENUE, unit: null, type: 'number', aliases: ['임대료', '단가', '월임대료', 'Rent', 'Tariff'], min: 0 },
  'revenue.escalation':  { label: '매출 상승률', category: CATEGORY.REVENUE, unit: '%', type: 'number', aliases: ['임대료상승률', '매출상승률', 'Escalation'], min: -10, max: 20 },
  'revenue.ramp_years':  { label: '매출 안정화 소요기간', category: CATEGORY.REVENUE, unit: '년', type: 'number', aliases: ['안정화기간', 'Ramp-up'], min: 0, max: 10 },
  'opex.annual':         { label: '연간 운영비', category: CATEGORY.OPEX, unit: '억원', type: 'number', aliases: ['운영비', '연간운영비', 'OPEX'], min: 0, tolerance: 0.005 },
  'opex.ratio':          { label: '운영비율(매출대비)', category: CATEGORY.OPEX, unit: '%', type: 'number', aliases: ['운영비율', 'OPEX Ratio'], min: 0, max: 100 },
  'opex.escalation':     { label: '운영비 상승률', category: CATEGORY.OPEX, unit: '%', type: 'number', aliases: ['운영비상승률'], min: -10, max: 20 },

  // ── Debt / Equity ──────────────────────────────────────────
  'debt.amount':         { label: '차입금', category: CATEGORY.DEBT, unit: '억원', type: 'number', aliases: ['차입금', '대출금', '타인자본', 'Debt', 'Loan'], min: 0, tolerance: 0.005 },
  'debt.ltc':            { label: 'LTC(총사업비 대비 차입비율)', category: CATEGORY.DEBT, unit: '%', type: 'number', aliases: ['LTC', '차입비율'], min: 0, max: 100 },
  'debt.ltv':            { label: 'LTV', category: CATEGORY.DEBT, unit: '%', type: 'number', aliases: ['LTV', '담보인정비율'], min: 0, max: 100 },
  'debt.rate':           { label: '차입금리', category: CATEGORY.DEBT, unit: '%', type: 'number', aliases: ['금리', '이자율', '차입금리', 'Interest Rate'], min: 0, max: 30, requiredFor: ['financial'] },
  // ★ 차입금리가 아니라 **기준선**이다. PF 금리 = 기준금리 + 스프레드이고 스프레드는
  //   딜마다 다르다. 이 값으로 debt.rate 를 대체하면 IRR 이 통째로 부풀려진다 (ecos.js)
  'debt.benchmark_rate': { label: '기준금리(시장)', category: CATEGORY.DEBT, unit: '%', type: 'number', min: 0, max: 30 },
  'debt.tenor_years':    { label: '대출기간', category: CATEGORY.DEBT, unit: '년', type: 'number', aliases: ['대출기간', '만기', 'Tenor', 'Maturity'], min: 0, max: 50 },
  'debt.grace_years':    { label: '거치기간', category: CATEGORY.DEBT, unit: '년', type: 'number', aliases: ['거치기간', 'Grace Period'], min: 0, max: 20 },
  'debt.fee_pct':        { label: '취급수수료', category: CATEGORY.DEBT, unit: '%', type: 'number', aliases: ['취급수수료', '주선수수료', 'Arrangement Fee'], min: 0, max: 10 },
  'equity.amount':       { label: '자기자본', category: CATEGORY.EQUITY, unit: '억원', type: 'number', aliases: ['자기자본', '자본금', 'Equity'], min: 0, tolerance: 0.005 },

  // ── Tax / Schedule / Exit ──────────────────────────────────
  'tax.rate':            { label: '법인세율', category: CATEGORY.TAX, unit: '%', type: 'number', aliases: ['법인세율', '세율', 'Tax Rate'], min: 0, max: 50 },
  'tax.depreciation_years': { label: '감가상각 내용연수', category: CATEGORY.TAX, unit: '년', type: 'number', aliases: ['내용연수', '감가상각기간'], min: 1, max: 60 },
  'schedule.construction_years': { label: '공사기간', category: CATEGORY.SCHEDULE, unit: '년', type: 'number', aliases: ['공사기간', '건설기간', 'Construction Period'], min: 0, max: 15, requiredFor: ['financial'] },
  'schedule.ops_years':  { label: '운영기간', category: CATEGORY.SCHEDULE, unit: '년', type: 'number', aliases: ['운영기간', '사업기간', 'Operating Period'], min: 1, max: 50, requiredFor: ['financial'] },
  'exit.cap_rate':       { label: 'Exit Cap Rate', category: CATEGORY.EXIT, unit: '%', type: 'number', aliases: ['Cap Rate', '환원율', 'Exit Cap', '자본환원율'], min: 1, max: 20, requiredFor: ['financial'] },
  'exit.year':           { label: 'Exit 시점(운영 n년차)', category: CATEGORY.EXIT, unit: '년', type: 'number', aliases: ['Exit 시점', '매각시점'], min: 1, max: 50 },
  'exit.selling_cost_pct': { label: '매각부대비용', category: CATEGORY.EXIT, unit: '%', type: 'number', aliases: ['매각비용', 'Selling Cost'], min: 0, max: 10 },

  // ── Geo / 지적 (공공데이터 연동으로 채워지는 항목) ──────────
  'geo.pnu':             { label: '필지고유번호(PNU)', category: CATEGORY.LAND, unit: null, type: 'string', aliases: ['PNU', '필지고유번호'] },
  'geo.lat':             { label: '위도', category: CATEGORY.LAND, unit: null, type: 'number', aliases: [], min: 33, max: 39 },
  'geo.lon':             { label: '경도', category: CATEGORY.LAND, unit: null, type: 'number', aliases: [], min: 124, max: 132 },
  'land.official_price': { label: '개별공시지가', category: CATEGORY.LAND, unit: '원/㎡', type: 'number', aliases: ['개별공시지가', '공시지가'], min: 0, tolerance: 0.01 },
  // 공시지가 시점수정용. 한국부동산원 공표 통계라 가정치가 아니다.
  'land.price_change_rate': { label: '지가변동률(누적)', category: CATEGORY.LAND, unit: '%', type: 'number', aliases: ['지가변동률', '시점수정'] },
  'land.far_limit':      { label: '용적률 상한', category: CATEGORY.LAND, unit: '%', type: 'number', aliases: ['용적률'], min: 0, max: 2000 },
  'land.bcr_limit':      { label: '건폐율 상한', category: CATEGORY.LAND, unit: '%', type: 'number', aliases: ['건폐율'], min: 0, max: 100 },
  'building.footprint_sqm': { label: '건축면적', category: CATEGORY.BUILDING, unit: '㎡', type: 'number', aliases: ['건축면적'], min: 0, tolerance: 0.001 },
  'building.height_m':   { label: '최고높이', category: CATEGORY.BUILDING, unit: 'm', type: 'number', aliases: ['최고높이', '건축물높이'], min: 0, max: 700 },

  // ── 이미 받아 오면서 버리고 있던 값 (2026-08-16) ──────────────
  //
  // ★ 새로 호출하는 것이 **하나도 없다.** 건축물대장·건축인허가·지적도 응답에
  //   이미 실려 오던 것을 등록만 한다. 쿼터도 안 쓰고 호출도 안 는다.
  //
  // ★ 실적치와 법정 상한을 **다른 항목으로 둔다.** 한 칸에 섞으면 "용적률 320%"
  //   가 지어도 되는 한도인지 이미 지은 결과인지 알 수 없다.
  'building.bcr':        { label: '건폐율(실적)', category: CATEGORY.BUILDING, unit: '%', type: 'number', aliases: ['건폐율', '건폐율실적'], min: 0, max: 100 },
  'building.far':        { label: '용적률(실적)', category: CATEGORY.BUILDING, unit: '%', type: 'number', aliases: ['용적률', '용적률실적'], min: 0, max: 2000 },
  'building.basement_floors': { label: '지하층수', category: CATEGORY.BUILDING, unit: '층', type: 'number', aliases: ['지하층수', '지하층'], min: 0, max: 20 },
  'building.main_use':   { label: '주용도', category: CATEGORY.BUILDING, unit: null, type: 'string', aliases: ['주용도', '건물용도', '주요용도'] },
  'building.approval_date': { label: '사용승인일', category: CATEGORY.BUILDING, unit: null, type: 'string', aliases: ['사용승인일', '준공일', '준공연도'] },
  'land.jibun':          { label: '지번', category: CATEGORY.LAND, unit: null, type: 'string', aliases: ['지번', '소재지번'] },

  // ── Legal ──────────────────────────────────────────────────
  'legal.permit_status': { label: '인허가 현황', category: CATEGORY.LEGAL, unit: null, type: 'string', aliases: ['인허가', '허가현황', '건축허가', 'Permit'], requiredFor: ['im'] },
  'legal.spc':           { label: 'SPC/사업시행법인', category: CATEGORY.LEGAL, unit: null, type: 'string', aliases: ['SPC', '시행법인', '특수목적법인'] },

  // ── 법인평가 (등록부 D-59) ─────────────────────────────
  //
  // ★ **딜의 값이 아니라 법인의 값이다.** `project.sponsor` 와 이름이 같아도
  //   평가 대상은 따로 밝힌다 — 시행사와 모회사가 다른 경우가 흔하다.
  // ★ **순손익은 3개 연도를 다 받는다.** 한 해만 받으면 그 해가 곧 수익가치가
  //   되는데, 법령이 3년 가중평균(3:2:1)을 쓰는 이유가 바로 그것이다.
  'corp.name':            { label: '평가대상 법인', category: CATEGORY.LEGAL, unit: null, type: 'string', aliases: ['평가대상법인', '피평가법인'] },
  'corp.net_asset':       { label: '순자산가액', category: CATEGORY.EQUITY, unit: '억원', type: 'number', aliases: ['순자산', '순자산가액', '자본총계'], tolerance: 0.005 },
  'corp.net_income_1':    { label: '순손익액 (직전 1년)', category: CATEGORY.EQUITY, unit: '억원', type: 'number', aliases: ['순손익액', '당기순이익'] },
  'corp.net_income_2':    { label: '순손익액 (직전 2년)', category: CATEGORY.EQUITY, unit: '억원', type: 'number', aliases: [] },
  'corp.net_income_3':    { label: '순손익액 (직전 3년)', category: CATEGORY.EQUITY, unit: '억원', type: 'number', aliases: [] },
  'corp.shares':          { label: '발행주식총수', category: CATEGORY.EQUITY, unit: '주', type: 'number', aliases: ['발행주식수', '주식수'], min: 0 },
  // 자산총액 중 부동산 비율. **이 값 하나로 법령이 정한 가중치가 3:2 에서 2:3 으로 뒤집힌다**
  'corp.real_estate_pct': { label: '자산 중 부동산 비율', category: CATEGORY.EQUITY, unit: '%', type: 'number', aliases: ['부동산비율'], min: 0, max: 100 },
};

/**
 * 계산으로만 생성되는 key (추출/입력 금지 — Financial Agent 전용 출력).
 * 표시 라벨을 여기서 함께 관리해야 IM 본문에 raw key 가 노출되지 않는다.
 *
 * ★ `label` 은 **IM 본문·출처표에 찍히는 이름**이다. 화면 표시가 마음에 안 든다고
 *   여기를 고치면 산출물 문구가 같이 바뀐다. 화면에 한글·영문을 나란히 보이려면
 *   `ko`/`en` 을 쓴다 — `label` 은 둘 중 하나와 반드시 같아야 하고
 *   (`fields.test.js` 가 검사한다), 세 번째 이름을 만들지 않는다.
 *
 * ★ 한글 이름을 억지로 번역하지 않는다. DSCR·NOI·IRR 은 실무에서 그대로 쓰는 말이라
 *   「부채상환비율」로 바꿔 적으면 오히려 무슨 항목인지 못 알아본다.
 */
const COMPUTED_FIELDS = {
  'returns.project_irr':    { label: 'Project IRR', ko: '사업 내부수익률', en: 'Project IRR', unit: '%' },
  'returns.equity_irr':     { label: 'Equity IRR', ko: '자기자본 내부수익률', en: 'Equity IRR', unit: '%' },
  'returns.project_moic':   { label: 'Project MOIC', ko: '사업 투자배수', en: 'Project MOIC', unit: 'x' },
  'returns.equity_moic':    { label: 'Equity Multiple', ko: '자기자본 투자배수', en: 'Equity Multiple', unit: 'x' },
  'returns.npv':            { label: 'NPV', ko: '순현재가치', en: 'NPV', unit: '억원' },
  'returns.min_dscr':       { label: '최소 DSCR', ko: '최소 DSCR', en: 'Minimum DSCR', unit: 'x' },
  'returns.avg_dscr':       { label: '평균 DSCR', ko: '평균 DSCR', en: 'Average DSCR', unit: 'x' },
  'returns.debt_yield':     { label: 'Debt Yield', ko: '부채수익률', en: 'Debt Yield', unit: '%' },
  'returns.payback_years':  { label: '자본 회수기간', ko: '자본 회수기간', en: 'Payback Period', unit: '년' },
  'returns.exit_value':     { label: 'Exit Value', ko: '매각가치', en: 'Exit Value', unit: '억원' },
  'returns.noi_stabilized': { label: '안정화 NOI', ko: '안정화 NOI', en: 'Stabilized NOI', unit: '억원' },

  // 감정평가 Agent 산출 (참고용 간이 평가 — 법정 감정평가 아님)
  'appraisal.land_value_official':    { label: '토지가치(공시지가 기준)', ko: '토지가치(공시지가 기준)', en: 'Land Value (Official Land Price)', unit: '억원' },
  'appraisal.land_value_comparison':  { label: '토지가치(거래사례비교법)', ko: '토지가치(거래사례비교법)', en: 'Land Value (Sales Comparison)', unit: '억원' },
  'appraisal.land_value_income':      { label: '토지가치(수익환원법)', ko: '토지가치(수익환원법)', en: 'Land Value (Income Capitalization)', unit: '억원' },
  'appraisal.land_value_concluded':   { label: '토지가치(참고 결론)', ko: '토지가치(참고 결론)', en: 'Land Value (Indicated)', unit: '억원' },
  'appraisal.market_price_per_sqm':   { label: '인근 실거래 단가(중앙값)', ko: '인근 실거래 단가(중앙값)', en: 'Median Transaction Price per ㎡', unit: '원/㎡' },

  // 매스 검토 Agent 산출
  'massing.gfa_allowed_sqm': { label: '법정 허용 연면적', ko: '법정 허용 연면적', en: 'Maximum Allowable GFA', unit: '㎡' },
  'massing.far_planned':     { label: '계획 용적률', ko: '계획 용적률', en: 'Planned FAR', unit: '%' },
  'massing.bcr_planned':     { label: '계획 건폐율', ko: '계획 건폐율', en: 'Planned BCR', unit: '%' },
};

const COMPUTED_KEYS = Object.keys(COMPUTED_FIELDS);

/**
 * 출처일(sourceDate)을 물어야 하는 항목 — **값이 시점에 따라 달라지는 것만.**
 *
 * 시행사명·연면적·대지면적은 언제 조회했든 같은 값이다. 금리·매출·인허가 현황은
 * 다르다. 안 변하는 값에 날짜를 물으면 사람은 **오늘 날짜를 적고**, 그 날짜는
 * 아무것도 뜻하지 않는다. 뜻 없는 값이 출처표에 실리면 출처표 전체가 덜 믿긴다.
 *
 * ★ 판정은 여기(사전)에서만 한다. 화면은 `def.dated` 를 읽기만 한다 —
 *   화면이 카테고리를 보고 판단하기 시작하면 사전과 갈린다.
 */
const DATED_CATEGORIES = new Set([
  CATEGORY.INVESTMENT,   // 견적 시점이 곧 값의 의미다
  CATEGORY.REVENUE, CATEGORY.OPEX,
  CATEGORY.DEBT, CATEGORY.EQUITY,
  CATEGORY.TAX,          // 세율은 개정된다
  CATEGORY.EXIT,         // Cap Rate 는 시장이다
  CATEGORY.LEGAL,        // 인허가는 시점이 곧 정보다
]);

/** 카테고리 규칙에서 벗어나는 개별 항목 (규칙과 같은 값을 적어 두면 테스트가 잡는다) */
const DATED_OVERRIDE = {
  'land.official_price': true,   // 개별공시지가 — 연 1회 고시, 몇 년치인지가 핵심
  'land.ownership': true,        // 토지 확보상태 — 협의중/계약/이전완료가 시점마다 바뀐다
};

function needsSourceDate(key) {
  if (Object.prototype.hasOwnProperty.call(DATED_OVERRIDE, key)) return DATED_OVERRIDE[key];
  const f = FIELDS[key];
  return !!(f && DATED_CATEGORIES.has(f.category));
}

// 정의에 박아 둔다 — `GET /fields` 가 그대로 내려보내고 화면은 읽기만 한다
Object.keys(FIELDS).forEach((k) => { FIELDS[k].dated = needsSourceDate(k); });

function field(key) { return FIELDS[key] || COMPUTED_FIELDS[key] || null; }

/** 사람이 읽는 항목명. 정의가 없으면 key 그대로 (조용히 빈 문자열로 만들지 않는다) */
function labelFor(key) {
  const f = field(key);
  return f ? f.label : key;
}

function requiredFor(purpose) {
  return Object.entries(FIELDS)
    .filter(([, f]) => (f.requiredFor || []).includes(purpose))
    .map(([k]) => k);
}

/** alias 문자열 → dictionary key (긴 alias 우선 매칭) */
const ALIAS_INDEX = (() => {
  const idx = [];
  for (const [key, f] of Object.entries(FIELDS)) {
    for (const a of f.aliases || []) idx.push({ alias: a, aliasLower: a.toLowerCase(), key });
  }
  idx.sort((a, b) => b.alias.length - a.alias.length);
  return idx;
})();

function keyForAlias(text) {
  const t = String(text).trim().toLowerCase();
  const hit = ALIAS_INDEX.find(e => e.aliasLower === t);
  return hit ? hit.key : null;
}

/** 값이 dictionary 정의 범위를 벗어나는지 (Validation Agent가 사용) */
function rangeViolation(key, value) {
  const f = FIELDS[key];
  if (!f || f.type !== 'number') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return `${f.label}: 숫자가 아님 (${value})`;
  if (f.min !== undefined && n < f.min) return `${f.label}: ${n}${f.unit || ''} < 허용 최소 ${f.min}`;
  if (f.max !== undefined && n > f.max) return `${f.label}: ${n}${f.unit || ''} > 허용 최대 ${f.max}`;
  return null;
}

module.exports = {
  FIELDS, CATEGORY, COMPUTED_FIELDS, COMPUTED_KEYS,
  field, labelFor, requiredFor, keyForAlias, rangeViolation, ALIAS_INDEX,
  needsSourceDate, DATED_CATEGORIES, DATED_OVERRIDE,
};
