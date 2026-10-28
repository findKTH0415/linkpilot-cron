#!/usr/bin/env node
'use strict';
/**
 * find-image.js — 표지·간지에 쓸 **참고 이미지**를 찾아 고른다 (Pexels).
 *
 *   npm run im:image -- "factory exterior"                 후보만 본다
 *   npm run im:image -- "factory exterior" --pick 3 --project LP-GEN-2026-001
 *
 * ★ **두 단계로 나눈 것이 이 도구의 전부다.** 한 번에 받아 버리면 기계가 고른
 *   사진이 문서에 들어간다. 먼저 후보를 눈으로 보고, 번호로 고른다 (§4.9).
 *
 * ★ **받은 사진은 이 사업의 현장이 아니다.** 내려받을 때 캡션이 함께 붙고,
 *   `09_IM/images/stock/manifest.json` 에 출처가 남는다. 표시가 떨어지면
 *   남의 공장 사진이 이 딜의 현장이 된다 — 숫자와 달리 **사진은 아무도 출처를
 *   안 따진다.**
 *
 * ★ 키는 출력에 절대 안 찍는다.
 */

const path = require('path');
const pexels = require('../connectors/pexels');
const store = require('../core/store');

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

function usage() {
  console.log('참고 이미지 찾기 (Pexels)');
  console.log('─'.repeat(58));
  console.log('  npm run im:image -- "<검색어>" [--orientation landscape|portrait|square]');
  console.log('  npm run im:image -- "<검색어>" --pick <번호> --project <프로젝트ID> --no-people [--note "간지용"]');
  console.log('\n★ 받은 사진은 **이 사업의 현장이 아니다.** 캡션과 출처가 함께 남는다.');
  console.log('★ **인물 사진은 쓰지 않는다** (D-50). API 가 사람 유무를 알려 주지 않으므로');
  console.log('  사진을 눈으로 확인하고 --no-people 을 붙여야 받아진다.');
  console.log('★ **내부 검토본까지만** 쓴다 — 대외 배포본에서는 뺀다. 남아 있으면 승인이 막힌다.');
}

/** 값을 받는 플래그 — 그 **다음 인자**는 검색어가 아니다 */
const VALUE_FLAGS = new Set(['--pick', '--project', '--orientation', '--note']);

/** 첫 번째 자유 인자가 검색어다 */
function queryArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) continue;
    if (i > 0 && VALUE_FLAGS.has(argv[i - 1])) continue;   // 플래그의 값이다
    return argv[i];
  }
  return null;
}

async function main() {
  const query = queryArg(process.argv.slice(2));
  if (!query) { usage(); process.exit(1); }

  if (!pexels.isAvailable()) {
    console.log('PEXELS_API_KEY 미설정 — 이미지는 장식이라 없으면 그 자리를 비운다.');
    console.log('발급: pexels.com/api (무료) → 셸 환경변수나 GitHub Secrets 에만 넣는다.');
    process.exit(1);
  }

  const r = await pexels.search({ query, orientation: argOf('--orientation') || undefined });
  if (!r.ok) {
    console.log(`✕ ${r.error}`);
    process.exit(1);
  }

  const photos = r.value.photos;
  const pick = argOf('--pick');

  if (!pick) {
    console.log(`'${query}' — 후보 ${photos.length}건 (전체 ${r.value.total}건)`);
    console.log('─'.repeat(58));
    photos.forEach((p, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${p.width}×${p.height} ${p.orientation || ''}`);
      console.log(`      ${p.alt || '(설명 없음)'}`);
      console.log(`      ${pexels.attribution(p)}`);
    });
    console.log('\n─'.repeat(1) + '─'.repeat(57));
    console.log('★ **기계가 고르지 않는다.** 눈으로 보고 --pick <번호> 로 고른다.');
    console.log('   주소를 열어 사진을 확인한 뒤 고르는 것을 권한다.');
    console.log('★ **인물 사진은 쓰지 않는다** (D-50). 사진을 열어 사람이 없는지 확인하고');
    console.log('  --no-people 을 붙인다 — API 는 사람 유무를 알려 주지 않는다.');
    return;
  }

  const idx = Number(pick) - 1;
  const photo = photos[idx];
  if (!photo) {
    console.log(`✕ ${pick} 번 후보가 없다 (1~${photos.length})`);
    process.exit(1);
  }

  const projectId = argOf('--project');
  if (!projectId) {
    console.log('✕ --project <프로젝트ID> 가 필요하다 — 어느 프로젝트에 넣을지 정해야 한다');
    process.exit(1);
  }

  const dir = store.projectDir(projectId);
  // ★ 확인했다는 표시를 사람이 직접 붙인다. 기본값으로 두면 확인 없이 지나간다
  const noPeople = process.argv.includes('--no-people');
  const d = await pexels.download({
    photo, projectDir: dir, note: argOf('--note') || null, confirmedNoPeople: noPeople,
  });
  if (!d.ok) {
    console.log(`✕ ${d.error}`);
    process.exit(1);
  }

  console.log('● 내려받았다');
  console.log(`  ${d.value.file} (${Math.round(d.value.bytes / 1024)}KB)`);
  console.log(`  캡션: ${d.value.caption}`);
  console.log(`  출처는 ${path.join(pexels.STOCK_DIR, 'manifest.json')} 에 남았다`);
  console.log('\n★ 문서에 넣을 때 **캡션을 그대로 함께 넣는다.** 떼면 이 딜의 현장으로 읽힌다.');
  console.log('★ **내부 검토본까지만** 쓴다 — 대외 배포본에서는 뺀다 (D-50).');
  console.log(`  파일이 ${pexels.STOCK_DIR} 에 남아 있으면 **승인이 막힌다.** 뺐으면 파일도 지운다.`);
  console.log(`★ ${d.value.check}`);
}

if (require.main === module) {
  main().catch((e) => { console.log(`✕ ${e.message}`); process.exit(1); });
}
