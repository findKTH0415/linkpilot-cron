'use strict';
/**
 * permit.test.js — 건축인허가 Connector (C-02).
 *
 * 이 파일에서 가장 중요한 검사는 **"기록이 없는 것을 미허가라고 적지 않는가"** 다.
 * 인허가 기록이 없는 이유는 셋이다 — 나대지 / 수록 지연 / 지번 불일치.
 * 셋을 구분하지 않고 "미허가"라고 적으면, 허가를 이미 받은 딜이 IM 에서
 * 미허가로 나간다. 조용히 틀리는 것이 아니라 **틀린 채로 대외에 나간다.**
 */
const test = require('node:test');
const assert = require('node:assert');

const molit = require('../connectors/molit');
const cache = require('../connectors/cache');
const geo = require('../agents/07-geo');
const dict = require('../core/dictionary');

/* ───────────── 단계 판정 ───────────── */

test('★ 진행 단계는 뒤에서부터 본다 (사용승인 > 착공 > 허가)', () => {
  const full = [{ kind: '신축', permitDate: '2024-03-01', startDate: '2024-06-01', approvalDate: '2026-05-20' }];
  assert.strictEqual(molit.permitStatus(full), '신축 · 사용승인 완료 (2026-05-20)',
    '사용승인이 있는데 "건축허가 취득"이라고 적으면 실제보다 이른 단계로 읽힌다');

  assert.strictEqual(
    molit.permitStatus([{ kind: '신축', permitDate: '2024-03-01', startDate: '2024-06-01', approvalDate: null }]),
    '신축 · 착공 (2024-06-01)');

  assert.strictEqual(
    molit.permitStatus([{ kind: null, permitDate: '2024-03-01', startDate: null, approvalDate: null }]),
    '건축허가 취득 (2024-03-01)');
});

test('★ 기록은 있는데 날짜가 없으면 단계를 지어내지 않는다', () => {
  assert.strictEqual(molit.permitStatus([{ kind: '신축', permitDate: null, startDate: null, approvalDate: null }]), null,
    '단계를 모르면 비운다 — 추측한 단계가 IM 에 실리는 것보다 낫다');
  assert.strictEqual(molit.permitStatus([]), null);
  assert.strictEqual(molit.permitStatus(null), null);
});

/* ───────────── 원본 해석 ───────────── */

test('YYYYMMDD 를 사람이 읽는 형식으로 바꾼다', () => {
  const r = molit.toPermit({
    archPmsDay: '20240301', realStcnsDay: '20240601', useAprDay: '',
    archGbCdNm: '신축', mainPurpsCdNm: '업무시설', totArea: '12,345.67', platArea: '3000',
    bldNm: '가온타워',
  });
  assert.strictEqual(r.permitDate, '2024-03-01');
  assert.strictEqual(r.startDate, '2024-06-01');
  assert.strictEqual(r.approvalDate, null, '빈 문자열은 날짜가 아니다');
  assert.strictEqual(r.totalAreaSqm, 12345.67, '쉼표가 섞인 숫자를 그대로 두면 NaN 이 된다');
  assert.strictEqual(r.kind, '신축');
  assert.strictEqual(r.name, '가온타워');
});

test('형식이 아닌 날짜는 버린다 (조용히 잘라 붙이지 않는다)', () => {
  assert.strictEqual(molit.toPermit({ archPmsDay: '2024' }).permitDate, null);
  assert.strictEqual(molit.toPermit({ archPmsDay: null }).permitDate, null);
});

/* ───────────── 기록 없음의 취급 ───────────── */

test('★ 기록 없음을 "미허가"라고 쓰지 않는다', async () => {
  const before = process.env.DATA_GO_KR_KEY;
  const root = process.env.IM_AGENT_CACHE;
  process.env.DATA_GO_KR_KEY = 'TESTKEY1234567890';
  // 빈 응답이 캐시에 있는 것처럼 만들어 네트워크를 타지 않게 한다
  process.env.IM_AGENT_CACHE = require('fs').mkdtempSync(
    require('path').join(require('os').tmpdir(), 'permit-'));
  try {
    const params = { sigunguCd: '11650', bjdongCd: '10300', platGbCd: '0', bun: '0012', ji: '0003' };
    cache.write('permit', params, []);   // 조회는 됐고 결과가 0건인 상태

    const r = await molit.buildingPermit(params);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.notFound, true, '실패가 아니라 "찾지 못함"으로 구분되어야 한다');
    assert.ok(!/미허가/.test(r.error) || /미허가라는 뜻이 아니다/.test(r.error),
      '기록 없음을 미허가로 단정하면 허가받은 딜이 IM 에서 미허가로 나간다');
    assert.match(r.error, /나대지/, '왜 비었는지 짚어 줘야 사람이 확인할 수 있다');
  } finally {
    if (before === undefined) delete process.env.DATA_GO_KR_KEY; else process.env.DATA_GO_KR_KEY = before;
    if (root === undefined) delete process.env.IM_AGENT_CACHE; else process.env.IM_AGENT_CACHE = root;
  }
});

test('키가 없으면 부르지 않는다', async () => {
  const before = process.env.DATA_GO_KR_KEY;
  delete process.env.DATA_GO_KR_KEY;
  try {
    const r = await molit.buildingPermit({ sigunguCd: '11650', bjdongCd: '10300' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.unavailable, true);
  } finally {
    if (before !== undefined) process.env.DATA_GO_KR_KEY = before;
  }
});

test('Encoding 인증키 차단이 인허가에도 걸린다', async () => {
  const before = process.env.DATA_GO_KR_KEY;
  process.env.DATA_GO_KR_KEY = 'abc%2Fdef%3D%3D';
  try {
    const r = await molit.buildingPermit({ sigunguCd: '11650', bjdongCd: '10300' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Decoding/, '어느 키를 넣어야 하는지 말해 줘야 같은 증상이 반복되지 않는다');
  } finally {
    if (before === undefined) delete process.env.DATA_GO_KR_KEY; else process.env.DATA_GO_KR_KEY = before;
  }
});

/* ───────────── 화면이 무엇을 믿는가 ───────────── */

test('★ 인허가 현황은 자동 채움으로 선언하지 않는다 (조건부다)', () => {
  assert.ok(!geo.FILLS.includes('legal.permit_status'),
    '개발사업은 대개 나대지에서 시작한다 — FILLS 에 넣으면 화면이 안 물어보고 빈칸이 남는다 (B-18)');

  const conditional = Object.values(geo.CONDITIONAL_FILLS).flat();
  assert.ok(conditional.includes('legal.permit_status'),
    '선언조차 없으면 "왜 여기서 인허가가 나오지"를 아무도 모른다');

  // 화면 계획도 같은 판단이어야 한다 — 여전히 사람에게 묻는다
  const plan = require('../core/fieldplan').plan('datacenter');
  assert.notStrictEqual(plan['legal.permit_status'].fill, 'public',
    '공공데이터가 채운다고 하면 안 물어보게 된다');
});

test('인허가 현황은 시점이 붙는 항목이다', () => {
  assert.strictEqual(dict.FIELDS['legal.permit_status'].dated, true,
    '언제 기준의 인허가 상태인지가 값의 절반이다');
});

/* ───────────── 기존 구조에 얹혔는가 ───────────── */

test('★ 기존 커넥터 구조를 그대로 쓴다 (cache + http)', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'connectors', 'molit.js'), 'utf8');
  assert.match(src, /'permit', \{ sigunguCd/, '캐시를 통과해야 쿼터 규칙 안에 있다');
  assert.strictEqual(cache.TTL.permit, 30 * 86400, '인허가 TTL 은 단계가 바뀔 때만 의미가 있다');
  assert.ok(!/\bfetch\(/.test(src), 'fetch 를 직접 부르면 재시도·마스킹이 빠진다');
});

test('최근 건이 먼저 온다', () => {
  const rows = [
    { archPmsDay: '20200101' }, { archPmsDay: '20240301' }, { archPmsDay: '20220615' },
  ].map(molit.toPermit);
  // buildingPermit 이 쓰는 것과 같은 정렬 규칙
  const sorted = rows.slice().sort((a, b) => {
    const k = r => r.permitDate || r.startDate || r.approvalDate || '';
    return k(b).localeCompare(k(a));
  });
  assert.strictEqual(sorted[0].permitDate, '2024-03-01', '옛 허가건이 현재 상태로 잡히면 안 된다');
});
