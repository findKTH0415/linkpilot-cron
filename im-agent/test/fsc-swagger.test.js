'use strict';
/**
 * fsc-swagger.test.js — odcloud 규격(api-docs)에서 부를 자리를 «읽기만» 하는가 〈2026-09-29〉
 *
 * ★ 실호출은 여기서 못 잰다(호스트가 막혀 있고 열쇠도 없다). 재는 것은 둘이다 —
 *   ① 규격 JSON 에서 뿌리·경로·방법·필수 인자를 **문서에 적힌 대로** 뽑는가
 *   ② 못 읽으면 null(「못 읽었다」) — 빈 목록(「경로가 없다」)으로 뭉개지 않는가 (§8).
 * ★★ 값이 필요한 인자를 지어 넣지 않는지는 소스로 센다 — 사업자번호 같은 값이 코드에 없어야 한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const SRC = path.resolve(__dirname, '..', '..', 'scripts', 'fsc-probe.mjs');

test('swagger 2 — host·basePath 로 뿌리를 만들고 경로·필수 인자를 뽑는다(serviceKey·header 는 뺀다)', async () => {
  const { swaggerOps } = await import(SRC);
  const doc = {
    swagger: '2.0', host: 'api.odcloud.kr', basePath: '/api',
    paths: {
      '/nts-businessman/v1/status': { post: { parameters: [{ in: 'body', name: 'body', required: true }, { in: 'query', name: 'serviceKey', required: true }] } },
      '/15121307/v1/uddi:abc': { get: { parameters: [{ in: 'query', name: 'page' }, { in: 'query', name: 'perPage' }, { in: 'header', name: 'Authorization', required: true }] } },
      '/x/v1/need': { get: { parameters: [{ in: 'query', name: 'b_no', required: true }] } },
    },
  };
  const s = swaggerOps(JSON.stringify(doc));
  assert.strictEqual(s.root, 'https://api.odcloud.kr/api');
  const post = s.ops.find((o) => o.method === 'POST');
  assert.deepStrictEqual(post, { method: 'POST', path: '/nts-businessman/v1/status', required: [], body: true });
  const get = s.ops.find((o) => o.path.startsWith('/15121307'));
  assert.deepStrictEqual(get.required, []);
  assert.deepStrictEqual(s.ops.find((o) => o.path === '/x/v1/need').required, ['b_no']);
});

test('openapi 3 — servers[0].url 로 뿌리 · 상대 주소면 뿌리를 비운다(지어 붙이지 않는다)', async () => {
  const { swaggerOps } = await import(SRC);
  assert.strictEqual(swaggerOps({ openapi: '3.0.1', servers: [{ url: '//api.odcloud.kr/api/' }], paths: { '/a': { get: {} } } }).root, 'https://api.odcloud.kr/api');
  assert.strictEqual(swaggerOps({ openapi: '3.0.1', servers: [{ url: '/api' }], paths: { '/a': { get: {} } } }).root, '');
});

test('못 읽으면 null — 빈 목록으로 뭉개지 않는다', async () => {
  const { swaggerOps } = await import(SRC);
  assert.strictEqual(swaggerOps('<html>swagger-ui</html>'), null);
  assert.strictEqual(swaggerOps({ swagger: '2.0' }), null);
});

test('값이 필요한 인자는 부르지 않고 이름만 적는다 · 규격만 읽고 못 부른 것은 «못 쟀다(1 · 닿았다)»', () => {
  const s = fs.readFileSync(SRC, 'utf8');
  assert.match(s, /지어 넣지 않아 안 불렀다/);
  assert.match(s, /odSpec \? \{ code: 1/);
  assert.doesNotMatch(s, /b_no['"]?\s*:\s*\[\s*['"]\d/, '사업자번호 값을 지어 넣으면 안 된다');
});

/* 〈2026-10-13 · Codex 리뷰 #220〉 — 서버가 대답한 411(몸통에 번호가 있어야 한다)을 «못 닿았다(3)»로 세면
   요약 첫 줄이 «도는 자리를 옮기라»를 시킨다. 닿았는데 사람이 넣을 값이 있어야 잰다는 1 로 갈라 적는가 */
test('몸통 값이 필요한 411 은 «못 닿음(3)»이 아니라 «닿음·사람 값 필요(1)» — 요약 글도 자리 옮기기를 안 시킨다', () => {
  const s = fs.readFileSync(SRC, 'utf8');
  assert.match(s, /bodyNeeded \? \{ code: 1/, '411 갈래가 3 으로 돌아가면 요약이 «자리를 옮기라»를 말한다');
  const m = s.match(/FSC_MEAN = \{ \.\.\.MEAN, 1: '([^']+)'/);
  assert.ok(m, '판정 1 의 뜻 글을 못 찾았다');
  assert.doesNotMatch(m[1], /못 닿았다|자리를 옮/, '판정 1 의 글이 «못 닿음»처럼 읽히면 안 된다');
  assert.match(s, /FSC_MEAN\[code\]/, '요약 첫 줄이 이 진단의 뜻 표(FSC_MEAN)를 읽어야 한다');
});

/* 〈2026-10-11 · KOTRA 국가정보 15034830 이 «뿌리/natnInfo» 에 «서비스 없음(12)»으로 답했다〉 —
   안내 페이지의 스웨거가 적은 host·basePath·경로 «통째»를 그대로 부를 자리로 만드는가. 지어내지 않는다. */
test('안내 페이지 스웨거 — basePath + 경로 통째(슬래시 둘)를 부를 자리로 · 다른 host 는 안 붙인다', async () => {
  const { discover } = await import(SRC);
  const page = 'x {"swagger":"2.0","host":"apis.data.go.kr","basePath":"/B410001/kotra_nationalInformation","paths":{"/natnInfo/natnInfo":{"get":{"parameters":[{"name":"isoWd2CntCd","required":true}]}}}}';
  const d = discover(page);
  assert.ok(d.full.includes('B410001/kotra_nationalInformation/natnInfo/natnInfo'), JSON.stringify(d.full));
  assert.deepStrictEqual(d.paths, ['/natnInfo/natnInfo']);
  assert.deepStrictEqual(d.required, ['isoWd2CntCd']);
  const other = discover(page.replace('apis.data.go.kr', 'api.odcloud.kr'));
  assert.ok(!other.full.some((x) => x.includes('natnInfo/natnInfo')), '포털 밖 host 를 data.go.kr 주소로 붙였다');
  /* 실측 모양 — basePath 없이 host 칸에 경로까지 적은 경우(KOTRA 2026-10-11) */
  const kotra = discover('x {"swagger":"2.0","host":"apis.data.go.kr/B410001/kotra_nationalInformation/natnInfo","paths":{"/natnInfo":{"get":{}}}}');
  assert.ok(kotra.full.includes('B410001/kotra_nationalInformation/natnInfo/natnInfo'), JSON.stringify(kotra.full));
  assert.ok(String(fs.readFileSync(SRC, 'utf8')).includes('스웨거 host·basePath'), '요약에 그 줄을 안 적는다');
});

/* 〈2026-10-12 · 한국산업은행 기금대출 15060633 — 안내 페이지가 «swaggerUrl» 변수로 규격을 따로 불러온다〉 —
   적힌 주소만 읽고(상대 주소는 www.data.go.kr 에 붙인다) · 빈 값·없음은 '' 이다. 그리고 그 규격을 «실제로 받아 읽는» 자리가 있는가. */
test('안내 페이지 swaggerUrl — 적힌 주소만 읽는다 · 빈 값은 못 읽은 것 · 받아서 필수 인자를 적는다', async () => {
  const { swaggerUrlOf } = await import(SRC);
  assert.strictEqual(swaggerUrlOf("var swaggerUrl = '/data/15060633/swagger.json';"), 'https://www.data.go.kr/data/15060633/swagger.json');
  assert.strictEqual(swaggerUrlOf('swaggerUrl="https://infuser.odcloud.kr/x.json"'), 'https://infuser.odcloud.kr/x.json');
  assert.strictEqual(swaggerUrlOf("var swaggerUrl = '';"), '');
  assert.strictEqual(swaggerUrlOf('<div>규격 없음</div>'), '');
  const s = String(fs.readFileSync(SRC, 'utf8'));
  assert.match(s, /const su = swaggerUrlOf\(html\)/, 'swaggerUrl 을 읽는 자리가 없다');
  assert.match(s, /swaggerOps\(await \(await fetch\(su,/, 'swaggerUrl 규격을 받아 읽지 않는다');
  assert.match(s, /swaggerUrl 규격 — 뿌리/, '요약에 그 줄을 안 적는다');
});

/* 〈2026-10-13 · data/_api/fsc-probe.md 실측 — 판정 5 열넷의 본문을 그대로 표본으로 쓴다〉 */
test('값 판정 — 빈 표 목록·빈 XML·필수 인자 오류는 값이 아니다 · KOTRA·XML item·odcloud data 는 값이다', async () => {
  const { hasItems } = await import(SRC);
  /* 아니다 — 실측 본문 */
  assert.strictEqual(hasItems('{"response":{"body":{"tableList":[{"items":{"item":[]},"title":"종금사_일반현황_임직원현황","totalCount":0},{"items":{"item":[]},"title":"종금사_일반현황_영업점포현황","totalCount":0}]},"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE.","pageNo":"1","numOfRows":"3"}}}'), false);
  assert.strictEqual(hasItems('<?xml version="1.0" encoding="utf-8" standalone="yes"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items/><numOfRows>3</numOfRows><pageNo>1</pageNo><totalCount>0</totalCount></body></response>'), false);
  assert.strictEqual(hasItems('{"body":{},"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE"}}'), false);
  assert.strictEqual(hasItems('{"response":{"header":{"resultCode":81,"resultMsg":"Not Exist Required Paramaters."},"body":null}}'), false);
  assert.strictEqual(hasItems('{"result":{"resultCode":"11","resultMsg":"NO_MANDATORY_REQUEST_PARAMETERS_ERROR"}}'), false);
  assert.strictEqual(hasItems('{"status_code":"REQUEST_DATA_MALFORMED"}'), false);
  assert.strictEqual(hasItems('{ "OpenAPI_ServiceResponse": { "cmmMsgHeader": { "errMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "returnAuthMsg": "x", "returnReasonCode": "30" } } }'), false);
  /* 이다 */
  assert.strictEqual(hasItems('{"response":{"header":{"resultCode":"00"},"body":{"itemList":[{"tretRealmCntnt":"무역","acplcAdvncYear":"1979","pcompNm":"가"}]}}}'), true);
  assert.strictEqual(hasItems('<response><body><items><item><pblancNm>공고</pblancNm></item></items></body></response>'), true);
  assert.strictEqual(hasItems('{"currentCount":3,"data":[{"AREA":2,"AS1":"서울특별시","AS2":"종로구"}]}'), true);
  assert.strictEqual(hasItems('<response><body><totalCount>12</totalCount></body></response>'), true);
});

test('필수 인자 값 — 스웨거가 적은 값 · 저장소가 받아 본 값만 붙이고 · 모르는 것은 «값 모름»으로 남긴다', async () => {
  const { paramHints, extraParams } = await import(SRC);
  const page = 'x {"paths":{"/a":{"get":{"parameters":[{"name":"areaCd","in":"query","required":true,"default":"11110"},{"name":"ucodeList","in":"query","required":true,"description":"용도지역지구 코드"},{"name":"cltrTypeCd","in":"query","required":true,"enum":["0001","0002"]}]}}}}';
  const h = paramHints(page);
  assert.deepStrictEqual(h.areaCd, { value: '11110', from: '스웨거 default' });
  assert.deepStrictEqual(h.cltrTypeCd, { value: '0001', from: '스웨거 enum 첫 값' });
  assert.strictEqual(h.ucodeList, undefined, '설명에 예시가 없으면 값을 만들면 안 된다');
  const lur = extraParams('1613000/LuLawInfoService/DTluLawInfo', '202512', ['areaCd', 'ucodeList', 'pageNo'], h);
  assert.deepStrictEqual(lur.q, { areaCd: '11110' });
  assert.deepStrictEqual(lur.missing, ['ucodeList']);
  /* 온비드 입찰결과 — 설명 속 코드 목록의 첫 코드 · yyyyMMdd 날짜는 기준월의 첫날·끝날 (2026-10-21 실측: 결과 11) */
  const onbid = paramHints('x {"name":"cltrTypeCd","in":"query","required":true,"description":"물건유형코드 (0001 : 부동산, 0002 : 자동차, 0003 : 동산)"} {"name":"prptDivCd","in":"query","required":true,"description":"재산유형코드(복수 요청일 경우 쉼표(,)로 구분자) (0007 : 압류재산, 0010 : 국유재산)"} {"name":"opbdDtStart","in":"query","required":true,"description":"검색할 개찰일 시작일자 입력(yyyyMMdd)"} {"name":"opbdDtEnd","in":"query","required":true,"description":"검색할 개찰일 종료일자 입력(yyyyMMdd)"} {"name":"note","in":"query","required":true,"description":"비고 (참고: 아무거나)"}');
  assert.strictEqual(onbid.cltrTypeCd.value, '0001');
  assert.strictEqual(onbid.prptDivCd.value, '0007', '앞의 «(복수 …)»·«(,)» 괄호는 코드가 아니다');
  assert.strictEqual(onbid.note, undefined, '숫자 코드가 아닌 괄호는 값으로 안 쓴다');
  const ob = extraParams('B010003/OnbidCltrBidRsltListSrvc2/getCltrBidRsltList2', '202502', ['cltrTypeCd', 'prptDivCd', 'opbdDtStart', 'opbdDtEnd'], onbid);
  assert.deepStrictEqual(ob.q, { cltrTypeCd: '0001', prptDivCd: '0007', opbdDtStart: '20250201', opbdDtEnd: '20250228' });
  assert.deepStrictEqual(ob.missing, []);
  assert.strictEqual(extraParams('B010003/x/y', '202412', ['opbdDtEnd'], onbid).q.opbdDtEnd, '20241231');
  /* 토지이용규제 법령정보 — 같은 실행에서 브이월드가 돌려준 지역지구 코드만 붙인다. 못 받았으면 «값 모름» */
  const { liveLurZone, LIVE } = await import(SRC);
  const T = '1613000/LuLawInfoService/DTluLawInfo';
  delete LIVE.lur;
  assert.deepStrictEqual(extraParams(T, '202512', ['areaCd', 'ucodeList'], {}).missing, ['areaCd', 'ucodeList'], '받기 전에는 값을 만들면 안 된다');
  LIVE.lur = await liveLurZone(async () => ({ ok: true, value: { zoneCodes: [{ name: '가축사육제한구역', code: null }, { name: '제2종일반주거지역', code: 'UQA122' }] } }));
  assert.deepStrictEqual(extraParams(T, '202512', ['areaCd', 'ucodeList'], {}).q, { areaCd: '52113', ucodeList: 'UQA122' });
  LIVE.lur = await liveLurZone(async () => ({ ok: false, error: 'HTTP 502' }), async () => ({ ok: true, value: { allZones: ['자연녹지지역'] } }));
  assert.strictEqual(LIVE.lur.ok, false, '저장된 파일에도 코드 칸이 없으면 못 받은 것이다');
  assert.ok(/코드 칸이 없다/.test(LIVE.lur.why) && /HTTP 502/.test(LIVE.lur.why), '두 까닭을 함께 적는다');
  assert.deepStrictEqual(extraParams(T, '202512', ['areaCd', 'ucodeList'], {}).missing, ['areaCd', 'ucodeList'], '못 받으면 지어 넣지 않는다');
  assert.strictEqual((await liveLurZone(async () => ({ ok: true, value: { zoneCodes: [{ name: 'x', code: null }] } }), async () => null)).ok, false);
  /* 러너에서 502 → NAS 에서 받아 올라온 파일의 코드를 쓴다 · 어디서 왔는지 적는다 */
  const sv = await liveLurZone(async () => ({ ok: false, error: 'HTTP 502' }), async () => ({ ok: true, value: { zoneCodes: [{ name: '자연녹지지역', code: 'UQA430' }] } }));
  assert.strictEqual(sv.ok, true); assert.strictEqual(sv.code, 'UQA430'); assert.ok(/yeoui893/.test(sv.from));
  delete LIVE.lur;
  /* 실측 표 — KOTRA · 실거래(기준월이 DEAL_YMD 로 따라간다) · 건축HUB */
  assert.deepStrictEqual(extraParams('B410001/kotra_nationalInformation/natnInfo/natnInfo', '202512', ['isoWd2CntCd'], {}).q, { isoWd2CntCd: 'BD', type: 'json' });
  assert.deepStrictEqual(extraParams('B410001/kotra_nationalInformation/natnInfo/natnInfo', '202512', ['isoWd2CntCd'], {}).base, { pageNo: '1', numOfRows: '10' }, 'KOTRA 는 받아 본 요청 그대로 — 진단 공통 인자(resultType·basYm)를 안 붙인다');
  assert.strictEqual(extraParams('1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent', '202506', ['LAWD_CD', 'DEAL_YMD'], {}).base, null);
  const rt = extraParams('1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent', '202506', ['LAWD_CD', 'DEAL_YMD'], {});
  assert.strictEqual(rt.q.DEAL_YMD, '202506');
  assert.ok(/^\d{5}$/.test(rt.q.LAWD_CD));
  assert.deepStrictEqual(rt.missing, []);
  /* 기금대출 — 필수 `bseYy` 를 기준월의 연도로 붙인다 (판정 5 «필수항목이 입력되지 않았습니다» · 2026-10-19) */
  assert.deepStrictEqual(extraParams('B190030/GetFundLoanInfoService/getFundLoanList', '202512', [], {}).q, { bseYy: '2025' });
  assert.deepStrictEqual(extraParams('B190030/GetFundLoanInfoService/getFundLoanList', '202406', [], {}).q, { bseYy: '2024' }, '기준월 되짚기를 따라 연도도 움직인다');
  const hub = extraParams('1613000/ArchPmsHubService/getApBasisOulnInfo', '202512', ['sigunguCd', 'bjdongCd'], {});
  assert.deepStrictEqual(Object.keys(hub.q).sort(), ['bjdongCd', 'sigunguCd']);
  assert.ok(hub.used.every((u) => /scripts\/\S+\.mjs/.test(u.from)), '실측 값에는 출처 파일을 적는다');
});

test('칸 이름 — XML 첫 item · items 밖 자리(KOTRA)도 줍는다 · 요청변수 표에서 이름만', async () => {
  const { itemKeys, requestVarsOf } = await import(SRC);
  assert.deepStrictEqual(itemKeys('<response><body><items><item><dealAmount>1</dealAmount><umdNm>x</umdNm></item></items></body></response>'), ['dealAmount', 'umdNm']);
  assert.deepStrictEqual(itemKeys('{"response":{"body":{"itemList":[{"a":"1","b":"2","c":"3"}]}}}'), ['a', 'b', 'c']);
  assert.deepStrictEqual(requestVarsOf('<h4>요청변수(Request Parameter)</h4><table><tr><td>serviceKey</td></tr><tr><td>fndNm</td></tr></table>'), ['fndNm']);
  assert.strictEqual(requestVarsOf('<div>없다</div>'), null);
});

/* 〈2026-10-17 · 실측: 기업은행 영업점 15084721 — 오퍼레이션이 «brcode»(get 으로 시작하지 않음)라 못 뽑고
   뿌리만 불러 «서비스 없음(12)»이 났다〉 — 안내 페이지 «요청주소» 칸의 통째 주소를 부를 자리로 줍는가. */
test('안내 페이지 요청주소 — get 으로 시작하지 않는 오퍼레이션도 통째로 줍는다', async () => {
  const { discover } = await import(SRC);
  const page = '<li> <strong class="key">요청주소</strong> <div class="value"> https://apis.data.go.kr/B190021/branchinfo/brcode </div> </li>';
  const d = discover(page);
  assert.ok(d.full.includes('B190021/branchinfo/brcode'), JSON.stringify(d.full));
  assert.ok(d.bases.includes('B190021/branchinfo'), JSON.stringify(d.bases));
  /* 요청주소 낱말이 없는 곳의 아무 주소 꼬리를 오퍼레이션으로 집지 않는다 */
  const plain = discover('see https://apis.data.go.kr/B190021/branchinfo/brcode');
  assert.ok(!plain.full.includes('B190021/branchinfo/brcode'), JSON.stringify(plain.full));
});

test('부를 차례 — 앞 검색이 cap 을 다 채워도 맨 뒤 열쇠의 첫 서비스가 불린다 (Codex #253)', async () => {
  const { probeOrder } = await import(SRC);
  const svc = [];
  for (let k = 0; k < 16; k++) for (let i = 0; i < 4; i++) svc.push({ key: 'K' + k, id: k + '-' + i });
  svc.push({ key: 'KSURE_COUNTRY_LIST', id: 'ks-0' }, { key: 'MOFA_RELATIONS_WITH_KOREA_BY_COUNTRY', id: 'mo-0' }, { key: 'MOFA_RELATIONS_WITH_KOREA_BY_COUNTRY', id: 'mo-1' });
  assert.ok(!svc.slice(0, 64).some((x) => /^(ks|mo)-/.test(x.id)), '표본이 «옛 자르기로는 빠지는» 모양이어야 한다');
  const got = probeOrder(svc, 64);
  assert.strictEqual(got.length, 64);
  assert.ok(got.some((x) => x.id === 'ks-0') && got.some((x) => x.id === 'mo-0'), '새 열쇠 둘의 첫 서비스가 cap 안에 든다');
  assert.deepStrictEqual(got.filter((x) => x.key === 'K0').map((x) => x.id), ['0-0', '0-1', '0-2', '0-3'].slice(0, got.filter((x) => x.key === 'K0').length), '열쇠 안의 차례는 그대로');
  assert.strictEqual(new Set(got.map((x) => x.id)).size, 64, '같은 것을 두 번 안 집는다');
  assert.deepStrictEqual(probeOrder([{ key: 'A', id: 1 }, { key: 'A', id: 2 }], 64).map((x) => x.id), [1, 2], 'cap 보다 적으면 전부');
});

test('필수 인자 설명 — 스웨거 «description» 을 그대로 줍고, 없으면 그 이름은 빠진다 (값을 지어내지 않는다 · 2026-10-20)', async () => {
  const { paramDocs } = await import(SRC);
  const html = '[{"name":"areaCd","in":"query","required":true,"type":"string","description":"지역코드(시군구)"},'
    + '{"name":"ucodeList","in":"query","required":true,"type":"string"},{"name":"other","description":"안 묻는 것"}]';
  const d = paramDocs(html, ['areaCd', 'ucodeList']);
  assert.deepStrictEqual(d, { areaCd: '지역코드(시군구)' }, '설명이 없는 ucodeList 는 «못 읽었다»로 빠지고, 묻지 않은 이름은 안 줍는다');
  assert.deepStrictEqual(paramDocs('', ['areaCd']), {});
  const src = fs.readFileSync(SRC, 'utf8');
  assert.ok(/REB_LAND_PRICE_CHANGE', keyword: '한국부동산원 전국지가변동률조사'/.test(src), '전국지가변동률조사를 포털 검색으로 찾는다');
  assert.ok(/'KICT_API_KEY', 'REB_LAND_PRICE_CHANGE'\]/.test(src), '열쇠 이름 목록에도 들어 있다(없으면 포털 열쇠로 대신 건다)');
});

test('요약 첫 줄의 서비스 이름은 «그 줄이 잰 서비스»에서 읽는다 — 부르는 차례(probeOrder)가 바뀌어도 이름이 밀리지 않는다', () => {
  /* 2026-10-26 실측 — 첫 줄이 SERVICES[i] 로 이름을 붙여 «건축물대장 4»처럼 남의 판정을 적었다(서비스별 판정은 0) */
  const src = fs.readFileSync(SRC, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/results\.services\.map\(\(x, i\) => `\$\{SERVICES\[i\]/.test(src), '첫 줄이 차례 번호로 이름을 붙인다');
  const pushes = src.match(/results\.services\.push\(\{[^}]*\}/g) || [];
  assert.ok(pushes.length >= 2 && pushes.every((p) => /name: svc\.name/.test(p)), '판정 줄마다 이름을 싣지 않는다: ' + pushes.length);
});
