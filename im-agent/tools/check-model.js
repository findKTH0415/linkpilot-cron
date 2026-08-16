#!/usr/bin/env node
'use strict';
/**
 * check-model.js — 설계 협력사가 보낸 모델이 **규격대로 왔는지** 확인한다.
 *
 *   npm run im:check-model -- ~/받은모델.ifc
 *
 * 왜 있는가: 2026-08-16 에 둘을 결정했다 — 형상에서 물량을 계산하지 않고(D-37),
 * Rhino 서버도 세우지 않는다(D-38). 둘 다 **협력사가 만든 것을 받는다**는 뜻이다.
 *
 * ★ **받는다는 결정에는 검사가 따라와야 한다.** 안 그러면 「받았다」와 「쓸 수
 *   있다」가 같은 말이 되는데, 실제로는 파일이 멀쩡하고 형상도 다 들어 있는데
 *   **수량만 없는 경우**가 흔하다. 그 상태로 파이프라인에 넣으면 물량이 「없음」
 *   으로 남고, 사람은 파일을 줬으니 된 줄 안다.
 *
 * ★ **협력사가 직접 돌릴 수 있어야 한다.** 그래서 값을 찍지 않는다 — 무엇이
 *   빠졌고 무엇을 켜서 다시 내보내면 되는지만 말한다. 이 출력을 그대로 붙여
 *   넣어도 딜 정보가 새지 않는다.
 *
 * ★ **고치라고만 하지 않는다.** 도구별로 어느 메뉴인지까지 적는다 —
 *   「Base Quantities 를 켜세요」만으로는 어디 있는지 찾느라 하루가 간다.
 */

const fs = require('fs');
const path = require('path');
const ifc = require('../core/ifc');

/** 규격 문서와 **같은 말**을 쓴다 — 두 벌로 두면 한쪽만 고치는 날 갈린다 */
const SPEC = 'docs/설계-협력사-산출물-규격.md';

const EXPORT_HINT = [
  '  Revit    : IFC 내보내기 › Property Sets 탭 › Export base quantities',
  '  ArchiCAD : IFC 변환 설정 › Property Mapping › Base Quantities',
  '  Rhino/GH : IFC 내보내기 플러그인의 Quantity Sets 옵션',
];

/**
 * 단위가 mm 계열로 들어왔는지 짐작한다.
 *
 * ★ **짐작이라고 말한다.** 진짜로 큰 건물일 수도 있다 — 단정하면 멀쩡한 모델을
 *   되돌려 보내게 된다. 그래서 「확인해 달라」까지만 한다.
 */
function suspiciousUnits(totals) {
  const area = totals.grossArea || totals.netArea || 0;
  // 100만㎡ 는 실제로는 초대형 단지다. mm² 로 들어오면 여기를 아주 쉽게 넘는다
  return area > 1e6
    ? `면적 합계가 ${Math.round(area).toLocaleString()} 로 지나치게 크다 — `
      + '모델 단위가 mm 로 잡혀 있을 수 있다 (면적이 백만 배가 된다). '
      + '길이 m · 면적 ㎡ 로 내보냈는지 확인해 주십시오'
    : null;
}

function check(file) {
  const out = { file: path.basename(file), ok: false, problems: [], notes: [] };

  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    out.problems.push(`파일을 열지 못했다: ${e.message}`);
    return out;
  }

  const r = ifc.read(buf, { name: path.basename(file) });

  if (!r.ok) {
    out.problems.push(r.reason || 'IFC 로 읽히지 않는다');
    return out;
  }
  out.schema = r.schema;
  out.elementCount = r.elements.length;

  if (!r.hasQuantities) {
    // ★ 이것이 가장 흔한 반려 사유다. 그래서 문구를 파서와 **한 곳에서** 가져온다
    out.problems.push(r.reason);
    return out;
  }

  out.totals = r.totals;

  // ── 여기부터는 「막지는 않지만 봐야 하는 것」 ──────────────
  const unit = suspiciousUnits(r.totals);
  if (unit) out.notes.push(unit);

  if (r.unmapped.length) {
    // ★ 이름을 몰라 못 센 수량. 이게 없으면 물량이 왜 적은지 알 수 없고,
    //   **적은 물량이 그대로 견적이 된다**
    out.notes.push(`이름을 알아보지 못한 수량 ${r.unmapped.length}종 — `
      + r.unmapped.slice(0, 5).map(u => `${u.name}(${u.count})`).join(', ')
      + '. 표준 이름(GrossArea·NetVolume 등)으로 나가면 합계에 들어간다');
  }

  // 부재가 전부 Proxy 면 무엇의 물량인지 사라진다
  const proxy = r.elements.filter(e => /Proxy/i.test(e.type)).length;
  if (r.elements.length && proxy === r.elements.length) {
    out.notes.push('모든 부재가 IfcBuildingElementProxy 로 나왔다 — '
      + '벽·슬래브·기둥이 제 타입으로 나가야 무엇의 물량인지 남는다');
  }

  out.ok = true;
  return out;
}

function main() {
  const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!files.length) {
    console.log('설계 협력사 산출물 검사');
    console.log('─'.repeat(58));
    console.log('  npm run im:check-model -- <파일.ifc> [파일2.ifc ...]');
    console.log(`\n무엇을 보는지는 ${SPEC} 에 적혀 있다.`);
    console.log('※ 값은 찍지 않는다 — 이 출력을 그대로 붙여 넣어도 딜 정보가 새지 않는다.');
    process.exit(1);
  }

  console.log('설계 협력사 산출물 검사');
  console.log('─'.repeat(58));

  let bad = 0;
  for (const f of files) {
    const r = check(f);
    console.log(`\n${r.ok ? '●' : '✕'} ${r.file}`);
    if (r.schema) console.log(`  스키마 ${r.schema} · 부재 ${r.elementCount}개`);

    if (r.ok) {
      const t = r.totals || {};
      const parts = [];
      if (t.grossArea || t.netArea) parts.push(`면적 ${Math.round(t.grossArea || t.netArea).toLocaleString()}㎡`);
      if (t.netVolume || t.grossVolume) parts.push(`부피 ${Math.round(t.netVolume || t.grossVolume).toLocaleString()}㎥`);
      console.log(`  수량 있음 — ${parts.join(' · ') || '합계를 만들 항목이 없다'}`);
    } else {
      bad++;
      r.problems.forEach(p => console.log(`  → ${p}`));
      // ★ 수량이 없을 때만 메뉴 위치를 붙인다. 다른 오류에 붙이면 엉뚱한 곳을 뒤진다
      if (r.problems.some(p => /Base Quantities|기본 수량/.test(p))) {
        console.log('\n  내보내기 옵션 위치:');
        EXPORT_HINT.forEach(h => console.log(h));
      }
    }
    r.notes.forEach(n => console.log(`  ⚠ ${n}`));
  }

  console.log(`\n${'─'.repeat(58)}`);
  if (bad) {
    console.log(`${files.length}건 중 ${bad}건이 이대로는 물량이 안 잡힌다.`);
    console.log('※ 우리 쪽에서 형상으로 물량을 새로 계산하지 않는다 (등록부 D-37) —');
    console.log('  수량이 파일 안에 들어 있어야 한다.');
    process.exit(1);
  }
  console.log(`${files.length}건 전부 규격대로다. 그대로 보내면 된다.`);
}

if (require.main === module) main();

module.exports = { check, suspiciousUnits, SPEC, EXPORT_HINT };
