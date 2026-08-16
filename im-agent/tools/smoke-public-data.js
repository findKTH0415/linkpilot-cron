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
const dart = require('../connectors/dart');
const kma = require('../connectors/kma');
const kpx = require('../connectors/kpx');
const reb = require('../connectors/reb');
const g2b = require('../connectors/g2b');
const rhino = require('../connectors/rhino');
const kosis = require('../connectors/kosis');
const factory = require('../connectors/factory');
const fsc = require('../connectors/fsc');
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
    // ★ 예시에는 실제 키를 쓰지 않는다. 한 번 그렇게 했다가 public 저장소에
    //   개발키가 그대로 커밋됐다 (2026-08-15 발견). 모양만 보여 주면 충분하다.
    console.log('\n  올바른 예 (꺾쇠·따옴표 없이 값만 — 아래는 형식 예시일 뿐이다):');
    console.log("    export VWORLD_KEY=00000000-0000-0000-0000-000000000000");
    console.log("    export VWORLD_DOMAIN=example.com");
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
  console.log(`ECOS_API_KEY   : ${ecos.isAvailable() ? '설정됨 (시장금리 + 생산자물가)' : '미설정 — 시장금리·생산자물가 건너뜀 (금리·단가가 가정치로 남는다)'}`);
  console.log(`DART_API_KEY   : ${dart.isAvailable() ? '설정됨' : '미설정 — 시행사 대조 건너뜀'}`);

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

    // ── 0-2-1. 생산자물가지수 (제조 딜의 단가 시점수정) ────
    //   ★ 업종을 **자동으로 고르지 않는다** (§4.9). 그래서 스모크가 확인하는 것은
    //     「통계표가 살아 있고 업종 후보가 나오는가」까지다 — 계수까지 보려면
    //     `--ppi-item <항목코드>` 로 사람이 고른 업종을 준다.
    const items = await ecos.ppiItems();
    if (items.ok) {
      const monthly = items.value.filter(x => !x.cycle || x.cycle === ecos.PPI.cycle);
      report(`한국은행 ECOS 생산자물가 업종목록 (${ecos.PPI.stat})`, true,
        `업종 ${items.value.length}종 (월별 ${monthly.length}종) · 예: `
        + items.value.slice(0, 3).map(x => `${x.code} ${x.name}`).join(' / '));
      console.log('  ※ 업종은 자동으로 고르지 않는다 — 「기타 기계 및 장비」와 「1차 금속」은 몇 년 새 두 자릿수로 갈린다');
    } else {
      report(`한국은행 ECOS 생산자물가 업종목록 (${ecos.PPI.stat})`, false, items.error);
      console.log('  → 통계표코드·주기가 문서 기준이고 아직 실측되지 않았다 (등록부 D-43)');
    }

    const ppiItem = argOf('--ppi-item');
    if (ppiItem) {
      const from = argOf('--ppi-from') || '202401';
      const to = argOf('--ppi-to') || ecos.month(new Date());
      const adj = await ecos.priceAdjustment({ item: ppiItem, from, to });
      if (adj.ok) {
        report(`ECOS 단가 시점수정 (${ppiItem})`, true,
          `${adj.value.label} ${adj.value.from}→${adj.value.to} `
          + `계수 ${adj.value.factor} (${adj.value.percent >= 0 ? '+' : ''}${adj.value.percent}% · ${adj.value.months}개월)`);
        console.log('  ※ 지수의 비다 — 변동률을 누적하지 않았다. 적용 여부는 사람이 정한다 (두 번 보정 위험)');
      } else {
        report(`ECOS 단가 시점수정 (${ppiItem})`, false, adj.error);
      }
    } else {
      console.log('  ※ 계수까지 보려면: npm run im:smoke -- --ppi-item <항목코드> [--ppi-from YYYYMM] [--ppi-to YYYYMM]');
    }
  }

  // ── 0-2-2. 제조업 가동률 (KOSIS) ─────────────────────────
  //   ★ **값을 채우는 것이 아니라 대조한다.** 개별 공장의 가동률은 공적으로
  //     나오지 않는다 — 나오는 것은 업종 평균뿐이다.
  if (kosis.isAvailable()) {
    const found = await kosis.tables(argOf('--kosis-search') || '가동률', { orgId: kosis.ORG_STATISTICS_KOREA });
    if (found.ok) {
      report('통계청 KOSIS 통계표 검색 (가동률)', true,
        `${found.value.length}건 · 예: `
        + found.value.slice(0, 3).map(x => `${x.tblId} ${x.name}`).join(' / '));
      console.log('  ※ 표를 자동으로 고르지 않는다 — 같은 조사에 지수(2020=100)와 평균가동률(%)이 함께 있다');
    } else {
      report('통계청 KOSIS 통계표 검색 (가동률)', false, found.error);
      console.log('  → 엔드포인트·응답 필드가 문서 기준이고 아직 실측되지 않았다 (등록부 D-44)');
    }

    const tblId = argOf('--kosis-tbl');
    if (tblId) {
      // ★ 항목을 먼저 보여 준다. **단위를 보고 골라야** 지수를 %로 읽지 않는다
      const m = await kosis.meta({ tblId, type: 'ITM' });
      if (m.ok) {
        report(`KOSIS 항목목록 (${tblId})`, true,
          m.value.map(x => `${x.code} ${x.name}[${x.unit || '단위?'}→${x.kind}]`).slice(0, 6).join(' / '));
        const idx = m.value.filter(x => x.kind === 'index').length;
        const pct = m.value.filter(x => x.kind === 'percent').length;
        console.log(`  ※ 지수 항목 ${idx}개 · % 항목 ${pct}개 — 가동률 대조에는 **% 항목**을 고른다`);
      } else {
        report(`KOSIS 항목목록 (${tblId})`, false, m.error);
      }

      const itmId = argOf('--kosis-item');
      if (itmId) {
        const bm = await kosis.benchmark({
          tblId, itmId, objL1: argOf('--kosis-obj') || 'ALL',
          prdSe: argOf('--kosis-prd') || 'M',
          from: argOf('--kosis-from') || '202401',
          to: argOf('--kosis-to') || '202606',
        });
        if (bm.ok) {
          report(`KOSIS 업종 평균 대조 (${itmId})`, true,
            `${bm.value.item || ''} 최근 ${bm.value.latest}${bm.value.unit || ''}(${bm.value.latestPeriod}) `
            + `· ${bm.value.n}개 시점 평균 ${bm.value.mean}${bm.value.unit || ''} [${bm.value.kind}]`);
          // ★ 단위 성격이 안 맞으면 여기서 드러나야 한다 — 뺄셈은 태연히 성립한다
          const c = kosis.compare(85, bm.value);
          console.log(c.ok ? `  예시(딜 85%): ${c.value.text}` : `  ※ 견주기 거부: ${c.error}`);
        } else {
          report(`KOSIS 업종 평균 대조 (${itmId})`, false, bm.error);
        }
      } else {
        console.log('  ※ 대조까지 보려면: --kosis-item <항목코드> [--kosis-obj <업종코드>] [--kosis-from/to]');
      }
    } else {
      console.log('  ※ 항목·대조까지 보려면: npm run im:smoke -- --kosis-tbl <통계표ID>');
    }
  }

  // ── 0-2-3. 공장등록 (제조 딜의 생산능력 물리적 상한) ──────
  //   ★ **면적을 뭉치지 않는다.** 용지면적은 제조시설면적의 보통 두세 배다 —
  //     바꿔 쓰면 상한이 세 배로 부풀고 문서에는 「공장등록 기준」만 남는다.
  const factoryName = argOf('--factory-name');
  if (factory.isAvailable() && factoryName) {
    const f = await factory.resolve({ name: factoryName, sido: argOf('--factory-sido') || '' });
    if (f.ok) {
      const kinds = ['land', 'building', 'manufacturing', 'auxiliary'];
      const shown = kinds.map((k) => {
        const a = factory.areaOf(f.value, k);
        return `${factory.AREA_KINDS[k].label} ${a.ok ? `${a.value.sqm}㎡` : '없음'}`;
      }).join(' / ');
      report(`공장등록 (${factoryName})`, true,
        `${f.value.name} · ${f.value.industryName || f.value.industryCode || '업종?'} · ${shown}`,
        ['fctryNm', 'lndarNm', 'manufAr', 'regstrDe'], null);
      console.log('  ※ 생산능력을 논할 때 봐야 하는 것은 **제조시설면적**이다 — 용지면적이 아니다');
      console.log(`  ※ 등록 ${f.value.registeredAt || '?'} · 변경 ${f.value.changedAt || '?'} — 변경신고가 없으면 갱신되지 않는다`);
    } else if (f.ambiguous) {
      report(`공장등록 (${factoryName})`, true, `후보 ${f.candidates.length}건 — 고르지 않는다`);
      f.candidates.slice(0, 5).forEach((c) => {
        console.log(`    · ${c.name} / ${c.address || '주소?'} / 제조시설 ${c.areas.manufacturing ?? '없음'}㎡`);
      });
    } else if (f.notFound) {
      report(`공장등록 (${factoryName})`, true, f.error);
    } else {
      report(`공장등록 (${factoryName})`, false, f.error);
      console.log('  → 기관·엔드포인트·응답 필드가 문서 기준이고 아직 실측되지 않았다 (등록부 D-45)');
    }
  } else if (factory.isAvailable()) {
    console.log('  ※ 공장등록을 보려면: npm run im:smoke -- --factory-name <상호> [--factory-sido <시도>]');
  }

  // ── 0-3. 시행사 대조 (주소와 무관) ───────────────────────
  //   ★ 값을 채우는 것이 아니라 **대조**다. 못 찾는 것이 정상인 경우가 많다
  if (dart.isAvailable()) {
    const name = argOf('--sponsor') || '삼성물산';
    const f = await dart.findCompany(name);
    if (f.ok) {
      const c = await dart.company(f.value.corpCode);
      report(`DART 시행사 대조 (${name})`, true,
        `${f.value.corpName} · 법인코드 ${f.value.corpCode}`
        + (c.ok ? ` · ${c.value.corpClass || ''} · 설립 ${c.value.establishedAt || '-'}` : ''),
        ['corp_name', 'jurir_no', 'adres', 'est_dt'], c.ok ? c.raw : null);
    } else if (f.notFound) {
      report(`DART 시행사 대조 (${name})`, true, '공시대상회사가 아니다 — 법인이 없다는 뜻이 아니다');
    } else if (f.ambiguous) {
      report(`DART 시행사 대조 (${name})`, true, `동명 법인 ${f.candidates.length}건 — 고르지 않는다`);
    } else {
      report(`DART 시행사 대조 (${name})`, false, f.error);
    }
  }
  console.log(`KMA_APIHUB_KEY : ${kma.isAvailable() ? '설정됨' : '미설정 — 일사량 건너뜀 (태양광 딜에만 필요)'}`);
  // ★ 나중에 붙인 커넥터도 **반드시 여기에 적는다.** 안 적으면 스모크를 돌린
  //   사람은 그 커넥터가 있는 줄도 모르고, 「0/0 통과」를 다 됐다고 읽는다
  //   (실제로 reb·g2b·rhino 셋이 한동안 목록에 없었다 — 교차검증에서 잡았다)
  console.log(`REB_API_KEY    : ${reb.isAvailable() ? '설정됨' : '미설정 — 지가지수 건너뜀 (공시지가 시점수정 불가)'}`);
  console.log(`조달청 낙찰     : ${g2b.isAvailable() ? 'DATA_GO_KR_KEY 로 조회 (⚠ 응답 필드 미검증 — 등록부 D-36)' : '미설정 — 공사비 대조 건너뜀'}`);
  console.log(`RHINO_COMPUTE  : ${rhino.isAvailable() ? '설정됨 (자체 호스팅)' : '미설정 — 매스 스터디 건너뜀 (Rhino 라이선스 필요, D-38)'}`);
  console.log(`KOSIS_API_KEY  : ${kosis.isAvailable() ? '설정됨 (⚠ 엔드포인트 미검증 — 등록부 D-44)' : '미설정 — 가동률 대조 건너뜀 (가동률이 근거 0인 가정치로 남는다)'}`);
  console.log(`공장등록        : ${factory.isAvailable() ? 'DATA_GO_KR_KEY 로 조회 (⚠ 기관·응답 필드 미검증 — 등록부 D-45)' : '미설정 — 생산능력 상한 대조 건너뜀'}`);

  let lat = null, lon = null, parsedPnu = null, polygonAreaSqm = null;

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
      polygonAreaSqm = p.value.polygon.length >= 3 ? geometry.polygonAreaSqm(p.value.polygon) : null;
      // 연속지적도에 면적 필드가 없는 것은 정상이다 (vworld.js parcelAt 주석 참고).
      // 면적은 아래 '토지특성'이 담당하므로 여기서는 경고하지 않는다.
      report('VWorld 연속지적도', true,
        `PNU ${p.value.pnu} · 폴리곤 ${p.value.polygon.length}점`
        + (polygonAreaSqm ? ` · 실측 ${Math.round(polygonAreaSqm)}㎡` : ''));
      if (p.value.pnu) {
        parsedPnu = pnuUtil.parse(p.value.pnu);
        console.log(`  PNU 분해: 시군구 ${parsedPnu.sigunguCd} · 법정동 ${parsedPnu.bjdongCd} · 지번 ${parsedPnu.jibun}`);
      }
    } else {
      report('VWorld 연속지적도', false, p.error);
    }
  }

  // ── 3. 토지특성 (공부상 대지면적) ───────────────────────
  // 나대지는 건축물대장이 없어 여기가 면적의 유일한 출처다.
  if (parsedPnu && nsdi.isAvailable()) {
    const chr = await nsdi.landCharacteristics(parsedPnu.pnu);
    if (chr.ok) {
      const gap = polygonAreaSqm
        ? ` · 폴리곤 실측과 ${(Math.abs(polygonAreaSqm - chr.value.areaSqm) / chr.value.areaSqm * 100).toFixed(1)}% 차이`
        : '';
      report('토지특성 (VWorld NED)', true,
        `${chr.value.year}년 공부면적 ${chr.value.areaSqm?.toLocaleString('ko-KR')}㎡ · 지목 ${chr.value.category}${gap}`);
      if (!chr.value.areaSqm) console.log('  ⚠ 면적이 비었다 — 필드명 확인 (lndpclAr)');
    } else {
      report('토지특성 (VWorld NED)', false, chr.error);
    }
  }

  // ── 4. 개별공시지가 ────────────────────────────────────
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

  // ── 5. 토지이용계획 ────────────────────────────────────
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

  // ── 6. 건축물대장 ──────────────────────────────────────
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

  // ── 8. 일사량 (기상청 API허브 — 태양광 딜) ──────────────
  // 키가 없으면 항목 자체를 세지 않는다. 태양광이 아닌 딜에서는 필요 없는 키다.
  if (kma.isAvailable() && lat !== null) {
    const near = await kma.nearestStation(lat, lon);
    if (!near.ok) {
      report('일사량 (기상청)', false,
        `${near.error} — 부지에서 가장 가까운 관측소를 고를 수 없다. `
        + 'KMA_STN 에 지점번호를 직접 넣으면 승인 전에도 동작한다 (예: 108 서울)');
    } else {
      const year = new Date().getFullYear() - 1;   // 진행 중인 해는 합계가 반토막 난다
      const s = await kma.annualSolar(near.value.stn, year);
      if (s.ok) {
        report('일사량 (기상청)', true,
          `${near.value.name || near.value.stn} 지점(${near.value.distanceKm === null ? '거리 미상·직접지정' : near.value.distanceKm + 'km'}) · `
          + `${year}년 ${s.value.irradianceKwh?.toLocaleString('ko-KR')}kWh/㎡ `
          + `(일평균 ${s.value.dailyAvgKwh}) · 일조 ${s.value.sunshineHours}시간`);
        if (s.value.coverage < 90) {
          console.log(`  ⚠ 결측 ${s.value.missingDays}일 (관측률 ${s.value.coverage}%) — 합계가 실제보다 작다`);
        }
      } else {
        report('일사량 (기상청)', false, s.error);
      }
    }
  }

  // ── 9. REC 현물시장 (전력거래소 — 태양광 딜) ────────────
  if (kpx.isAvailable()) {
    const rec = await kpx.recAverage({ months: 12, area: 'land' });
    if (rec.ok) {
      const v = rec.value;
      report('REC 현물시장 (전력거래소)', true,
        `최근 ${v.months}개월 육지 가중평균 ${v.weightedAvg?.toLocaleString('ko-KR')}원/REC `
        + `(${v.sessions}회 개장) · 최근가 ${v.latestPrice?.toLocaleString('ko-KR')}원 (${v.latestDate})`);
      const gap = Math.abs(v.weightedAvg - v.simpleAvg) / v.simpleAvg;
      if (gap > 0.05) {
        console.log(`  ⚠ 단순평균 ${v.simpleAvg?.toLocaleString('ko-KR')}원과 ${Math.round(gap * 100)}% 차이 — 거래가 얇다`);
      }
    } else {
      report('REC 현물시장 (전력거래소)', false, rec.error);
    }
  }

  // ── 10. 지가지수 (한국부동산원 — 공시지가 시점수정) ──────
  if (reb.isAvailable()) {
    const year = new Date().getFullYear();          // 공시지가 기준일 = 당해 1/1
    const region = await reb.resolveRegion(ADDRESS, `${year}01`);
    if (!region.ok) {
      report('지가지수 (부동산원)', false, region.error);
    } else {
      const adj = await reb.timeAdjustment({
        clsId: region.value.clsId, from: `${year}01`,
        to: `${year}${String(new Date().getMonth() + 1).padStart(2, '0')}`,
      });
      if (adj.ok) {
        const v = adj.value;
        report('지가지수 (부동산원)', true,
          `${v.region} 지수 ${v.baseIndex} → ${v.lastIndex} (${v.from}~${v.to}, ${v.months}개월 경과) `
          + `→ 시점수정 계수 ${v.factor} (${v.percent > 0 ? '+' : ''}${v.percent}%)`);
      } else {
        report('지가지수 (부동산원)', false, adj.error);
      }
    }
  }

  // ── 11. 건축인허가 (건축HUB — 인허가 현황 대조) ─────────
  if (parsedPnu && molit.isAvailable()) {
    const pm = await molit.buildingPermits(parsedPnu);
    if (pm.ok) {
      report('건축인허가 (건축HUB)', true,
        `이력 ${pm.count}건 · 최신 ${pm.latest.stage} ${pm.latest.date}`
        + (pm.latest.archType ? ` (${pm.latest.archType})` : ''));
      const done = pm.value.filter(x => x.useAprDay).length;
      console.log(`  단계 분포: 사용승인 ${done}건 · 착공 ${pm.value.filter(x => x.realStcnsDay).length}건 · 허가 ${pm.value.filter(x => x.archPmsDay).length}건`);
    } else {
      report('건축인허가 (건축HUB)', false, pm.error);
    }
  }

  // ── 12. 주택인허가 (건축HUB — 주택법 트랙) ──────────────
  // 30세대 이상 공동주택은 건축허가가 아니라 사업계획승인을 받는다.
  // 이 필지에 자료가 없는 것은 정상이다 (주택법 대상이 아닌 필지).
  if (parsedPnu && molit.isAvailable()) {
    const hp = await molit.housingPermits(parsedPnu);
    if (hp.ok) {
      report('주택인허가 (건축HUB)', true,
        `이력 ${hp.count}건 · 최신 ${hp.latest.stage} ${hp.latest.date}`
        + (hp.latest.households ? ` (${hp.latest.households}세대)` : ''));
    } else if (/자료 없음/.test(hp.error)) {
      report('주택인허가 (건축HUB)', true, `${hp.error} — 조회 자체는 정상`);
    } else {
      report('주택인허가 (건축HUB)', false, hp.error);
    }
  }

  // ── 13. 기업기본정보 (금융위 — 시행사 실체 확인) ─────────
  if (fsc.isAvailable()) {
    const NAME = argOf('--sponsor') || '롯데케미칼';
    const r = await fsc.corpOutline(NAME);
    if (!r.ok) {
      report('기업기본정보 (금융위)', false, r.error);
    } else if (r.ambiguous) {
      // 동명 법인이 실제로 있는 경우다 — 실패가 아니라 정상 동작이다
      report('기업기본정보 (금융위)', true, `'${NAME}' 동명 법인 ${r.candidates.length}곳 — 자동 선택하지 않는다 (정상)`);
    } else {
      const c = r.value;
      report('기업기본정보 (금융위)', true,
        `${c.name} · 법인번호 ${c.corpRegNo} · 설립 ${c.establishedOn} · `
        + `${c.market || '비상장'} · 감사의견 ${c.auditOpinion || '-'}`);
      if (JSON.stringify(c).includes('enpRprFnm')) {
        console.log('  ⚠ 대표자 성명이 응답 객체에 남아 있다 — 개인정보가 새어 나간다');
      }
    }
  }

  // ── 13. 조달청 공사 낙찰 (시공비 가정 대조 — 미검증 D-36) ──
  //
  // ★ 이 항목은 **엔드포인트·응답 필드가 아직 실제 키로 대조되지 않았다.**
  //   조회가 되더라도 필드명이 다르면 값이 전부 비는데, 그건 "조건에 맞는
  //   건이 없다"와 겉으로 구분이 안 된다. 그래서 원본 응답의 키를 함께 찍는다.
  if (g2b.isAvailable()) {
    const b = await g2b.benchmark({ region: '인천', months: 12, minEok: 10 });
    if (b.ok) {
      report('공사 낙찰 (조달청)', true,
        `${b.period} · ${b.count}건 중앙값 ${b.medianAwardEok?.toLocaleString('ko-KR')}억원`
        + (b.medianRate ? ` · 낙찰률 중앙값 ${b.medianRate}% (${b.rateCount}건)` : ' · 낙찰률 없음'));
      console.log(`  최근 건: ${b.latest.date} ${b.latest.title || '(공고명 없음)'} — ${b.latest.awardEok}억원`);
      if (!b.medianRate) {
        console.log('  ⚠ 기초금액이 응답에 없다 — 낙찰률을 낼 수 없다. 필드명(bssamt) 확인 필요');
      }
      console.log('  ※ ㎡당 단가는 내지 않는다 — 공고에 연면적이 없다 (사람이 나눈다)');
    } else {
      report('공사 낙찰 (조달청)', false, b.error);
      // 원본 키를 한 번 찍어 준다. 필드명이 달라서 빈 것인지 정말 없는 것인지 가른다
      const raw = await g2b.awards({ months: 12, minEok: 0 });
      if (raw.ok && raw.value.length) {
        console.log(`  참고: 조건 없이 부르면 ${raw.count}건 — 거르는 조건이 문제다`);
      }
    }
  }

  // ── 14. Rhino.Compute (매스 스터디 — 자체 호스팅) ──────
  //
  // ★ 이건 공공데이터가 아니라 **우리가 세운 서버**다. 살아 있는지만 본다 —
  //   실제 풀이는 Grasshopper 정의가 있어야 하고, 그 정의는 딜마다 다르다.
  if (rhino.isAvailable()) {
    const v = await rhino.version();
    if (v.ok) {
      report('Rhino.Compute (매스)', true,
        `서버 응답 ${typeof v.value === 'string' ? v.value : JSON.stringify(v.value)}`);
      console.log('  ※ 결과는 생성물이다 — fact 로 등록하지 않는다 (사람이 채택한다)');
    } else {
      report('Rhino.Compute (매스)', false, v.error);
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
