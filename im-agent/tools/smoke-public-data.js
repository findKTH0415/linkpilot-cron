#!/usr/bin/env node
'use strict';
/**
 * smoke-public-data.js — 공공데이터 API 실측 진단.
 *
 * 목적: Connector 가 기대하는 필드명이 **실제 응답과 같은지** 확인한다.
 *   엔드포인트·파라미터는 공식 문서 기준으로 작성했지만 응답 필드명이 다를 수 있고,
 *   그러면 조회는 성공하는데 값이 전부 null 로 들어온다 — 가장 잡기 어려운 종류의 오류다.
 *
 * 실행:
 *   VWORLD_KEY=... DATA_GO_KR_KEY=... node im-agent/tools/smoke-public-data.js
 *   VWORLD_KEY=... node im-agent/tools/smoke-public-data.js --address "인천광역시 남동구 ..."
 *
 * ★ 키를 인자로 넘기지 않는다. 환경변수로만 받는다 (셸 히스토리에 남지 않게).
 * ★ 키는 출력에 절대 찍지 않는다.
 * ★ 이 스크립트는 아무것도 저장하지 않는다. 캐시도 임시 폴더를 쓴다.
 */

const os = require('os');
const path = require('path');

process.env.IM_AGENT_CACHE = process.env.IM_AGENT_CACHE
  || path.join(os.tmpdir(), `lp-smoke-${Date.now()}`);

// ★ 커넥터가 키를 읽기 **전에** .env 를 올린다. 아래에서 require 하는 순간
//   isAvailable() 이 평가되므로 순서를 바꾸면 조용히 '미설정'이 된다
//   (connectors.test.js 가 이 순서를 검사한다)
const envFile = require('../core/env').load();

const vworld = require('../connectors/vworld');
const nsdi = require('../connectors/nsdi');
const molit = require('../connectors/molit');
const ecos = require('../connectors/ecos');
const { looksUrlEncoded } = require('../connectors/http');
const pnuUtil = require('../connectors/pnu');
const geometry = require('../geo/geometry');

const ADDRESS = argOf('--address') || '인천광역시 남동구 남동대로 215';
const results = [];

/**
 * 키 형식 점검.
 * ★ 안내문의 자리표시자(<...>)를 그대로 복사해 넣는 실수가 흔하다.
 *   그 상태로 호출하면 인증 오류만 나고 원인이 안 보이므로 여기서 먼저 잡는다.
 *   값은 절대 출력하지 않는다 — 길이와 형식만 본다.
 */
function checkKeyFormat(name, raw, expect) {
  if (!raw) return { ok: false, fatal: false, message: '미설정' };

  const problems = [];
  let value = raw;

  if (/^<.*>$/.test(value)) {
    problems.push('꺾쇠괄호 < > 가 값에 포함되어 있다 — 안내문의 자리표시자를 그대로 복사한 것이다');
    value = value.slice(1, -1);
  }
  if (/^['"].*['"]$/.test(value)) {
    problems.push('따옴표가 값 안에 포함되어 있다');
    value = value.slice(1, -1);
  }
  if (/\s/.test(value)) problems.push('공백이 포함되어 있다');

  // ★ data.go.kr 의 Encoding 인증키 — 가장 흔하고 가장 안 보이는 실수다.
  //   화면 위쪽에 있는 것이 Encoding 이라 그냥 복사하면 그쪽을 집는다.
  //   호출 시 한 번 더 인코딩되어 인증만 실패하고, 증상은 "키가 틀렸다"와 같다.
  if (looksUrlEncoded(value)) {
    problems.push('URL 인코딩된 값이다 — data.go.kr 의 **Encoding 인증키**를 복사한 것이다. '
      + '마이페이지에서 바로 아래의 Decoding(일반) 인증키를 써야 한다');
  }

  if (expect === 'uuid' && !/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(value)) {
    problems.push(`VWorld 키는 UUID 형식이어야 한다 (현재 ${value.length}자)`);
  }

  return {
    ok: problems.length === 0,
    fatal: problems.length > 0,
    cleaned: value,
    message: problems.length ? problems.join(' / ') : `형식 정상 (${value.length}자)`,
  };
}

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

function report(name, ok, detail, expectedFields = null, raw = null) {
  results.push({ name, ok });
  console.log(`\n${ok ? '●' : '✕'} ${name}`);
  console.log(`  ${detail}`);

  // 필드명 대조 — 조회는 됐는데 값이 null 이면 여기서 원인이 드러난다
  if (expectedFields && raw) {
    const actual = Object.keys(raw);
    const missing = expectedFields.filter(f => !(f in raw));
    console.log(`  실제 응답 필드(${actual.length}개): ${actual.slice(0, 14).join(', ')}${actual.length > 14 ? ' …' : ''}`);
    if (missing.length) {
      console.log(`  ⚠ Connector 가 기대하지만 없는 필드: ${missing.join(', ')}`);
      console.log('    → 이 필드명을 실제 응답에 맞게 고쳐야 값이 채워진다');
    } else {
      console.log('  ✓ 기대 필드가 모두 존재한다');
    }
  }
}

async function main() {
  console.log('공공데이터 API 실측 진단');
  console.log('─'.repeat(60));

  // ── 0. 키 형식 점검 (호출 전에 먼저) ──────────────────────
  const vk = checkKeyFormat('VWORLD_KEY', process.env.VWORLD_KEY, 'uuid');
  const dk = checkKeyFormat('DATA_GO_KR_KEY', process.env.DATA_GO_KR_KEY, null);

  if (vk.fatal || dk.fatal) {
    console.log('\n✕ 키 형식 오류 — 호출하기 전에 고쳐야 한다\n');
    if (vk.fatal) console.log(`  VWORLD_KEY     : ${vk.message}`);
    if (dk.fatal) console.log(`  DATA_GO_KR_KEY : ${dk.message}`);
    console.log('\n  올바른 예 (꺾쇠·따옴표 없이 값만):');
    // ★ 자리표시자는 **한눈에 가짜여야 한다.** 진짜처럼 생긴 값을 예시로 쓰면
    //   그게 진짜인지 예시인지 아무도 구분 못 하고, 실제로 여기에 실키가 박혀
    //   공개 저장소에 올라간 적이 있다 (2026-08-15 발견 · 재발급 완료)
    console.log("    export VWORLD_KEY=00000000-0000-0000-0000-000000000000   # UUID 8-4-4-4-12");
    console.log("    export VWORLD_DOMAIN=nas.example.com");
    console.log('\n  DATA_GO_KR_KEY 는 data.go.kr 마이페이지 › 인증키의 **Decoding(일반)** 쪽이다.');
    console.log('  Encoding 쪽은 %2F·%3D 처럼 %XX 가 들어 있어 인증에 실패한다.\n');
    process.exit(1);
  }

  // 정상 형식이면 정리된 값으로 교체 (따옴표 등 무해한 껍데기 제거)
  if (vk.cleaned) process.env.VWORLD_KEY = vk.cleaned;
  if (dk.cleaned) process.env.DATA_GO_KR_KEY = dk.cleaned;

  if (envFile.exists) {
    console.log(`.env       : ${envFile.loaded.length}개 적용`
      + (envFile.skipped.length ? ` · ${envFile.skipped.length}개는 셸 값이 우선` : ''));
  }
  console.log(`대상 주소 : ${ADDRESS}`);
  console.log(`VWORLD_KEY     : ${vworld.isAvailable() ? vk.message : '미설정 — 지오코딩/지적/공시지가 건너뜀'}`);
  console.log(`VWORLD_DOMAIN  : ${vworld.domain() || '미설정 ⚠ 서버 호출은 등록 도메인을 명시해야 허용된다'}`);
  console.log(`DATA_GO_KR_KEY : ${molit.isAvailable() ? dk.message : '미설정 — 실거래가/건축물대장 건너뜀'}`);
  console.log(`ECOS_API_KEY   : ${ecos.isAvailable() ? '설정됨' : '미설정 — 시장금리 건너뜀 (금리가 가정치로 남는다)'}`);

  // ── 0-2. 시장금리 (주소와 무관 — 먼저 확인한다) ──────────
  if (ecos.isAvailable()) {
    const mr = await ecos.marketRate();
    if (mr.ok) {
      report('한국은행 ECOS 시장금리', true,
        `${mr.value.label} ${mr.value.rate}${mr.value.unit} (${mr.value.date} 고시)`);
      console.log('  ※ 이 값은 기준선(debt.benchmark_rate)이다 — 차입금리를 대체하지 않는다');
    } else {
      report('한국은행 ECOS 시장금리', false, mr.error);
      console.log('  → 통계표코드(817Y002)·항목코드가 바뀌었을 수 있다. 응답 필드명 DATA_VALUE·TIME 확인');
    }
  }

  let lat = null, lon = null, parsedPnu = null;

  // ── 1. 지오코딩 ────────────────────────────────────────
  if (vworld.isAvailable()) {
    const g = await vworld.geocode(ADDRESS);
    if (g.ok) {
      ({ lat, lon } = g.value);
      report('VWorld 지오코딩', true, `좌표 ${lat}, ${lon} (${g.value.matchedType})`);
    } else {
      report('VWorld 지오코딩', false, g.error);
      if (g.attempts) {
        for (const a of g.attempts) console.log(`    · ${a.type} 시도 → ${a.error}`);
      }
      if (g.hint) console.log(`  → ${g.hint}`);
      if (process.env.IM_AGENT_DEBUG_HTTP !== '1') {
        console.log('  ※ 원문 응답을 보려면: IM_AGENT_DEBUG_HTTP=1 npm run im:smoke');
      }
    }
  }

  // ── 2. 필지(지적도) ────────────────────────────────────
  if (lat !== null) {
    const p = await vworld.parcelAt(lon, lat);
    if (p.ok) {
      const areaCalc = p.value.polygon.length >= 3 ? geometry.polygonAreaSqm(p.value.polygon) : null;
      report('VWorld 연속지적도', true,
        `PNU ${p.value.pnu} · 공부면적 ${p.value.officialAreaSqm}㎡ · 폴리곤 ${p.value.polygon.length}점`
        + (areaCalc ? ` · 실측 ${Math.round(areaCalc)}㎡` : ''));
      if (p.value.pnu) {
        parsedPnu = pnuUtil.parse(p.value.pnu);
        console.log(`  PNU 분해: 시군구 ${parsedPnu.sigunguCd} · 법정동 ${parsedPnu.bjdongCd} · 지번 ${parsedPnu.jibun}`);
      }
      if (!p.value.officialAreaSqm) {
        console.log('  ⚠ 공부상 면적이 비었다 — 응답의 면적 필드명 확인 필요 (lndpcl_ar 등)');
      }
    } else {
      report('VWorld 연속지적도', false, p.error);
    }
  }

  // ── 3. 개별공시지가 ────────────────────────────────────
  if (parsedPnu && nsdi.isAvailable()) {
    const lp = await nsdi.landPrice(parsedPnu.pnu);
    if (lp.ok) {
      report('개별공시지가 (VWorld NED)', true, `${lp.value.year}년 ${lp.value.pricePerSqm?.toLocaleString('ko-KR')}원/㎡`);
      if (!lp.value.pricePerSqm) {
        console.log('  ⚠ 가격이 비었다 — 필드명 확인 (pblntfPclnd / pblntf_pclnd)');
      }
    } else {
      report('개별공시지가 (VWorld NED)', false, lp.error);
    }
  }

  // ── 4. 토지이용계획 ────────────────────────────────────
  if (parsedPnu && nsdi.isAvailable()) {
    const lu = await nsdi.landUse(parsedPnu.pnu);
    if (lu.ok) {
      report('토지이용계획 (VWorld NED)', true,
        `용도지역 ${lu.value.zone}` + (lu.value.limits ? ` · 용적률 ${lu.value.limits.far}% / 건폐율 ${lu.value.limits.bcr}%` : ' · 법정한도 테이블 미매칭'));
      if (!lu.value.limits) {
        console.log(`  ⚠ '${lu.value.zone}' 가 ZONE_LIMITS 테이블에 없다 — connectors/nsdi.js 에 추가 필요`);
      }
    } else {
      report('토지이용계획 (VWorld NED)', false, lu.error);
    }
  }

  // ── 5. 건축물대장 ──────────────────────────────────────
  if (parsedPnu && molit.isAvailable()) {
    const b = await molit.buildingRegister(parsedPnu);
    if (b.ok) {
      report('건축물대장 (국토교통부)', true,
        `${b.value.name || '(무명)'} · 연면적 ${b.value.totalAreaSqm}㎡ · 지상 ${b.value.groundFloors}층`,
        ['platArea', 'archArea', 'totArea', 'bcRat', 'vlRat', 'grndFlrCnt'], b.raw);
      const nulls = Object.entries(b.value).filter(([, v]) => v === null).map(([k]) => k);
      if (nulls.length) console.log(`  ⚠ 비어 있는 항목: ${nulls.join(', ')} — 필드명 확인 필요`);
    } else {
      report('건축물대장 (국토교통부)', false, b.error);
    }
  }

  // ── 6. 건축인허가 ──────────────────────────────────────
  if (parsedPnu && molit.isAvailable()) {
    const p = await molit.buildingPermit({
      ...parsedPnu, platGbCd: parsedPnu.isMountain ? '1' : '0',
    });
    if (p.ok) {
      report('건축인허가 (국토교통부)', true,
        `${p.records.length}건 · 현재 상태: ${p.value || '(단계 불명)'}`,
        ['archPmsDay', 'realStcnsDay', 'useAprDay', 'archGbCdNm'], p.raw);
    } else if (p.notFound) {
      // ★ 기록 없음은 실패가 아니다. 나대지면 원래 없는 것이 맞다
      report('건축인허가 (국토교통부)', true, '기록 없음 (나대지이거나 미수록 — 미허가라는 뜻이 아니다)');
    } else {
      report('건축인허가 (국토교통부)', false, p.error);
    }
  }

  // ── 7. 실거래가 ────────────────────────────────────────
  if (parsedPnu && molit.isAvailable()) {
    const months = pnuUtil.recentMonths(3);
    for (const type of ['land', 'commercial']) {
      const t = await molit.trades(parsedPnu.sigunguCd, months, type);
      if (t.ok) {
        const withPrice = t.value.filter(x => x.pricePerSqm);
        report(`실거래가 (${t.label})`, true,
          `${months.join(',')} · ${t.value.length}건 (단가 산출 ${withPrice.length}건)`);
        if (t.value.length && !withPrice.length) {
          console.log('  ⚠ 거래는 있는데 단가가 안 나온다 — 거래금액/면적 필드명 확인');
          console.log(`    첫 건 원본 필드: ${Object.keys(t.value[0]).join(', ')}`);
        } else if (withPrice.length) {
          const s = withPrice[0];
          console.log(`  예시: ${s.dealDate || s.ym} ${s.dong || ''} ${s.areaSqm}㎡ ${s.dealAmountEok}억원 → ${s.pricePerSqm?.toLocaleString('ko-KR')}원/㎡`);
        }
      } else {
        report(`실거래가 (${type})`, false, t.error);
      }
    }
  }

  // ── 요약 ───────────────────────────────────────────────
  const ok = results.filter(r => r.ok).length;
  console.log('\n' + '─'.repeat(60));
  console.log(`결과: ${ok}/${results.length} 통과`);
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.log(`실패: ${failed.map(f => f.name).join(', ')}`);
    console.log('\n실패 내용과 위의 ⚠ 표시를 그대로 전달하면 Connector 를 실제 응답에 맞게 고칠 수 있다.');
  }
  console.log('\n※ 이 스크립트는 아무것도 저장하지 않았다. 키는 출력에 포함되지 않는다.');
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(e => {
  console.error('\n✕ 진단 중단:', e.message);
  process.exit(1);
});
