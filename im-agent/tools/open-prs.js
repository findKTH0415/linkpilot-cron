'use strict';
/**
 * open-prs.js — **열린 PR 의 갈래 이름을 적어 둔다** 〈2026-08-27 · D-142〉.
 *
 * 왜 필요한가: 교차검증 여덟째 칸(다른 갈래와 겹침)은 「지금 살아 있는 갈래」와
 * 견줘야 뜻이 있다. 그런데 **이 자리에서는 GitHub API 를 못 부른다**(401 —
 * 이 환경의 열쇠는 GitHub API 열쇠가 아니다). 그래서 늘 「나이로 어림했다」로
 * 끝나고 있었다.
 *
 * ★ 부를 수 있는 것은 따로 있다 — 대화 쪽의 GitHub 도구다. 그쪽이 물어본 답을
 *   이 파일에 적어 두면 검사가 **어림하지 않고 물어본 판**이 된다.
 *
 * ★★ **시각을 함께 적는 것이 이 도구의 핵심이다.** 이름만 적으면 어제 답이
 *   남아 「지금 물어봤다」고 말한다 — 못 물어본 것보다 나쁘다. 검사는 12시간이
 *   지난 기록을 **안 쓰고 까닭을 남긴다**.
 *
 * 쓰는 법
 *   node im-agent/tools/open-prs.js claude/aaa claude/bbb
 *   node im-agent/tools/open-prs.js --none      (열린 PR 이 하나도 없을 때)
 *   node im-agent/tools/open-prs.js --show      (지금 적힌 것과 나이)
 */
const fs = require('fs');
const { AUTO_PRS, MAX_AGE_H } = require('./branch-doctor.js');

function read() {
  if (!fs.existsSync(AUTO_PRS)) return null;
  try { return JSON.parse(fs.readFileSync(AUTO_PRS, 'utf8')); } catch (_) { return null; }
}

function ageH(j) {
  const at = j && j.at ? Date.parse(j.at) : NaN;
  return isFinite(at) ? (Date.now() - at) / 3600000 : null;
}

function write(refs) {
  const body = { at: new Date().toISOString(), refs };
  fs.writeFileSync(AUTO_PRS, `${JSON.stringify(body, null, 2)}\n`);
  return body;
}

function main(argv) {
  const args = argv.filter((a) => a !== '--');
  if (args.includes('--show')) {
    const j = read();
    if (!j) { console.log('아직 적힌 것이 없다 — 열린 PR 을 물어본 뒤 이 도구로 적는다'); return 2; }
    const h = ageH(j);
    const refs = Array.isArray(j) ? j : (j.refs || []);
    console.log(`열린 PR ${refs.length}개${refs.length ? `: ${refs.join(' · ')}` : ' (없다)'}`);
    console.log(h === null ? '  받은 시각이 안 적혀 있다 — 검사가 안 쓴다'
      : `  ${Math.round(h)}시간 전에 받았다 (한도 ${MAX_AGE_H}시간 — ${h > MAX_AGE_H ? '**낡았다. 다시 받는다**' : '쓸 수 있다'})`);
    return h === null || h > MAX_AGE_H ? 2 : 0;
  }

  const none = args.includes('--none');
  const refs = args.filter((a) => !a.startsWith('--'));
  if (!none && !refs.length) {
    console.error('열린 PR 의 갈래 이름을 대거나 --none 을 준다 (하나도 없을 때)');
    console.error('  ★ 이름을 안 주고 부르면 **「열린 PR 이 하나도 없다」**가 되어');
    console.error('    겹침을 하나도 안 세면서 「물어봤다」고 적는다 — 가장 비싼 거짓말이다');
    return 1;
  }
  const body = write(none ? [] : refs);
  console.log(`적었다: 열린 PR ${body.refs.length}개${body.refs.length ? ` — ${body.refs.join(' · ')}` : ' (없다)'}`);
  console.log(`  ${AUTO_PRS}`);
  console.log(`  ★ 이 기록은 ${MAX_AGE_H}시간까지만 쓰인다. 지나면 검사가 다시 「어림」으로 돌아간다`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { read, write, ageH, main };
