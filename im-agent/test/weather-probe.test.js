'use strict';
/**
 * weather-probe.test.js — **`WEATHER_GO` 가 어느 기관 것인가** 진단 〈2026-09-20 · D-247〉
 *
 * ★★★ **무엇을 재는가.** 실호출은 여기서 못 잰다 — 이 컨테이너는 그 호스트가 문지기에
 *   막혀 있고(실측: 403 「Host not in allowlist」) 운영 열쇠도 여기 없다 (§4.3 과 같은 결).
 *   그래서 재는 것은 **「무엇이 오든 어느 기관인지 갈라 말하는 구조인가」**다.
 *   **못 잰 것을 통과로 적지 않는다** (§8).
 *
 * ★★ **길찾기와 «되돌아오는 값의 뜻»이 반대다.** 길찾기는 자동차·대중교통이 **둘 다**
 *   있어야 하므로 나쁜 쪽(max)을 내고, 여기는 **한 열쇠가 어디에 속하는지**를 묻는 것이라
 *   **한 자리에서 받아들여지면 답이 나온 것**이다(min). 나머지 자리가 거부하는 것은
 *   **당연한 일**이지 고장이 아니다 — 뭉뚱그리면 답이 나왔는데 빨갛게 끝난다.
 *
 * ★ **베끼지 않고 오려 내 돌린다** — 「그 낱말이 있는가」는 이름만 바꿔 끼워도 통과하는,
 *   아무것도 안 재는 검사다 (§12-24 에서 사보타주 둘이 빠져나간 자리).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { yamlNoComment } = require('./yaml-lite.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'scripts', 'weather-probe.mjs');
const LIB = path.join(ROOT, 'scripts', 'probe-lib.mjs');
const WF = path.join(ROOT, '.github', 'workflows', 'api-smoke.yml');
const read = (p) => fs.readFileSync(p, 'utf8');
const nocom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

test('★★★ 열쇠 이름을 읽고, 값은 한 글자도 안 남긴다 (§2 · 이 저장소는 공개다)', () => {
  const src = nocom(read(SRC));

  /* ★ 읽는 이름을 **소스에서 뽑아** 센다 — 안내 문구에만 글자가 남아도 통과하면
     아무것도 안 재는 검사다 (§12-24 에서 실제로 빠져나간 자리). */
  const lists = [...src.matchAll(/pick\(\[([^\]]*)\]\)/g)]
    .map((m) => m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
  assert.strictEqual(lists.length, 1, `pick() 호출이 하나가 아닙니다 (${lists.length}) — 이 진단은 열쇠 하나를 잽니다`);
  assert.ok(lists[0].includes('WEATHER_GO'),
    'WEATHER_GO 를 «읽는 목록»에 안 넣습니다 — 넣으셔도 조용히 죽습니다.');

  /* ★★ 요약에 **길이만** 적고 값은 안 적는다. 세는 자리는 「요약에 나가는 줄」이다 (§6-2-5) */
  const calls = [];
  const re = /\bP\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length - 1, depth = 0;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    calls.push(src.slice(m.index + m[0].length, i));
  }
  assert.ok(calls.length >= 8, `요약에 찍는 자리를 못 읽었습니다 (${calls.length}곳) — 이 칸이 아무것도 안 잽니다`);
  const printed = calls.join('\n');
  const keyVars = [...src.matchAll(/const\s+(\w+)\s*=\s*pick\(/g)].map((x) => x[1]);
  assert.strictEqual(keyVars.length, 1, `열쇠 변수를 못 읽었습니다 (${keyVars.length}) — 이 칸이 아무것도 안 잽니다`);
  for (const v of keyVars) {
    assert.ok(!new RegExp(`\\b${v}\\.value(?!\\.length\\b)`).test(printed),
      `열쇠 값(${v}.value)을 요약에 찍습니다 (§2).`);
  }

  /* ★★ 결과 JSON 이 redact 를 지나간다 — 응답에 섞여 온 값이 그대로 남지 않게 */
  assert.match(src, /writeFile\([^)]*weather-probe\.json[^)]*redact\(/,
    'JSON 결과가 redact 를 안 지나갑니다 (§2).');
});

test('★★★ 기관 «둘»을 갈라 걸고, 인증 방식이 서로 다르다', () => {
  const src = nocom(read(SRC));
  assert.match(src, /apihub\.kma\.go\.kr/, '기상청 API허브를 안 걸어 봅니다 — 그 자리를 영영 못 가립니다.');
  assert.match(src, /apis\.data\.go\.kr\/1360000/, '공공데이터포털 기상청을 안 걸어 봅니다.');
  /* ★ 인증 방식이 다르다 — 한 벌로 걸면 한쪽이 늘 거부되고 그 까닭을 못 가린다 (§4.1) */
  assert.match(src, /authKey=/, 'API허브의 `authKey` 를 안 씁니다.');
  assert.match(src, /serviceKey=/, '포털의 `serviceKey` 를 안 씁니다.');
  /* ★★ 포털 열쇠는 Decoding 키여야 한다 — 원본·디코딩을 **둘 다** 걸어 본다 (§4.1) */
  assert.match(src, /decodeURIComponent/,
    '한 번 디코딩한 열쇠를 안 걸어 봅니다 — Encoding 키면 인증만 실패하고 「키가 틀렸다」와 구분이 안 됩니다.');
  /* ★ 갈래마다 제 판정을 낸다 — 하나로 뭉치면 어느 기관이 받아들였는지 사라진다 */
  assert.ok((src.match(/verdictOf\(/g) || []).length >= 2,
    '기관별 판정을 안 냅니다 — 어느 기관 열쇠인지가 요약에서 사라집니다.');
});

test('★★★ 되돌아오는 값이 «좋은 쪽»이고, 어느 기관인지 이름으로 적는다', () => {
  const src = nocom(read(SRC));
  /* ★★★ 길찾기(Math.max)와 **반대**다. 한 자리가 받아들이면 답이 나온 것이고,
     나머지가 거부하는 것은 당연하다 — max 로 세면 **답이 나왔는데 빨갛게 끝난다.** */
  assert.match(src, /Math\.min\(/,
    '판정을 나쁜 쪽으로 셉니다 — 한 기관이 받아들여도 빨갛게 끝나, 답이 나온 것이 안 보입니다.');
  assert.ok(!/Math\.max\(/.test(src), '길찾기의 잣대(둘 다 있어야 한다)를 그대로 베꼈습니다.');

  /* ★ 판정 0 일 때 **어느 기관인지 이름으로** 적는다 — 「0」만 보이면 배선할 자리가 안 보인다 */
  const where = src.match(/const\s+where\s*=[\s\S]{0,300}?;/);
  assert.ok(where, 'where 를 못 읽었습니다 — 이 칸이 아무것도 안 잽니다');
  assert.match(where[0], /API허브/, '어느 기관인지 이름으로 안 적습니다.');
  assert.match(where[0], /포털/, '어느 기관인지 이름으로 안 적습니다.');

  /* ★★ 못 정했으면 **「아직 못 정했다」**로 적는다 — 통과로도 실패로도 뭉뚱그리지 않는다 (§8) */
  assert.match(src, /못 정했다/,
    '어느 기관인지 못 가렸을 때 그 사실을 안 적습니다 — 못 잰 것이 통과로 읽힙니다 (§8).');
});

test('★★ 못 재는 것을 «재는 척» 하지 않는다 — 숫자 칸 찾기를 안 건다', () => {
  const src = read(SRC);
  /* 포털은 `obsrValue` 를 **문자열**로 준다. `findFields` 는 숫자 칸만 담으므로 여기서는
     빈손이 되고, 그 빈손이 「이름이 다른 것이다」로 읽혀 **틀린 곳을 가리킨다** (§4.6). */
  assert.match(src, /NO_FIELDS/, '칸 찾기를 안 건다는 사실을 코드에 안 적습니다.');
  assert.match(nocom(src), /const NO_FIELDS = null;/, 'NO_FIELDS 가 null 이 아닙니다.');
  assert.ok(/숫자 칸 찾기.*안 건다|안 건다.*경로는 본문/.test(src),
    '요약에 「칸 찾기를 안 건다」를 안 적습니다 — 읽는 사람이 빈손을 「없다」로 읽습니다 (§8).');
});

test('★★★ 기준 시각을 «자료가 올라온 뒤»로 잡는다 — 「자료 없음」이 규격 문제로 읽힌다', () => {
  const src = nocom(read(SRC));
  /* 초단기실황은 정시 자료가 40여 분 뒤에 올라온다. 지금 시각으로 부르면 빈 답이 오고,
     그것이 **갈래 5(규격을 고쳐라)** 로 세져 **고칠 것이 없는 자리**를 가리킨다. */
  assert.match(src, /9 \* 3600 \* 1000/, 'KST 로 안 맞춥니다 — 서버 로컬타임에 기댑니다 (§5).');
  assert.match(src, /90 \* 60 \* 1000/, '기준 시각을 뒤로 안 미룹니다 — 「자료 없음」이 규격 문제로 읽힙니다.');
  /* ★ `base_time` 은 **정시**여야 한다 */
  assert.match(src, /base_time=\$\{[A-Za-z_$][\w$]*\}00/, 'base_time 을 정시로 안 만듭니다.');
});

test('★ 판정이 «실행 요약 첫 화면»까지 간다 — 파일 안에만 두면 아무도 안 본다 (§12-19)', () => {
  const y = yamlNoComment(read(WF));
  assert.ok(/node\s+scripts\/weather-probe\.mjs/.test(y),
    '진단 워크플로가 weather-probe 를 안 부릅니다 — 열쇠가 있는 자리에서만 뜻이 있습니다 (§4.3).');
  assert.ok(/GITHUB_STEP_SUMMARY/.test(y) && /weather-probe\.md/.test(y),
    '판정 줄을 실행 요약으로 안 나릅니다 — 파일 안에만 두면 아무도 안 봅니다 (§12-19).');
  assert.ok(new RegExp('WEATHER_GO:\\s*\\$\\{\\{\\s*secrets\\.WEATHER_GO').test(y),
    '워크플로가 WEATHER_GO 를 안 넘깁니다 — 아무 오류 없이 「미설정」이 됩니다.');

  /* ★ 진단이 **결과 커밋보다 앞**이어야 결과가 남는다 (§12-36 의 차례) */
  const names = [...y.matchAll(/^\s*- name:\s*(.+)$/gm)].map((m) => m[1].trim());
  const iProbe = names.findIndex((n) => /WEATHER_GO/.test(n));
  const iCommit = names.findIndex((n) => /결과 커밋/.test(n));
  assert.ok(iProbe >= 0 && iCommit >= 0, `단계 이름을 못 읽었습니다 (${names.length}개)`);
  assert.ok(iProbe < iCommit, '진단이 결과 커밋 뒤에 있습니다 — 그 실행의 결과가 안 남습니다.');
});

test('★★ 나르는 줄 수가 «판정 줄 전부»를 덮는다 — 잘리면 무엇이 막았는지가 사라진다', () => {
  const y = yamlNoComment(read(WF));
  const src = read(SRC);
  /* 판정 줄은 전체 하나 + 기관 둘 = 셋이다. grep 이 그 셋을 다 집는지 본다. */
  const marks = (src.match(/^P\(`> \*\*판정/gm) || []).length;
  assert.ok(marks >= 2, `기관별 판정 줄을 못 읽었습니다 (${marks}) — 이 칸이 아무것도 안 잽니다`);
  const step = y.slice(y.indexOf('weather-probe.mjs'));
  assert.ok(/grep[^\n]*weather-probe\.md/.test(step),
    '판정 줄을 뽑는 자리가 없습니다.');
  /* ★ 「못 읽었다」를 조용히 안 넘긴다 — 빈 요약이 「판정이 없다」로 읽힌다 (§8) */
  assert.ok(/판정 줄을 못 읽었다/.test(step),
    'grep 이 빈손일 때 그 사실을 안 적습니다 — 빈 요약이 「문제 없음」으로 읽힙니다 (§8).');
});

test('★★★ 진단 창구가 «한 벌»이다 — 두 벌이면 같은 응답에 다른 사람 말이 붙는다 (§8-1)', () => {
  const src = nocom(read(SRC));
  const lib = nocom(read(LIB));
  for (const fn of ['probe', 'verdictOf', 'sayRow', 'pick', 'findFields']) {
    assert.ok(new RegExp(`export\\s+(?:async\\s+)?function\\s+${fn}\\s*\\(`).test(lib),
      `공용 창구에 ${fn} 이 없습니다 — 진단마다 두 벌로 적게 됩니다 (§8-1).`);
    assert.ok(!new RegExp(`^(?:async\\s+)?function\\s+${fn}\\s*\\(`, 'm').test(src),
      `${fn} 을 이 진단이 제 것으로 다시 적었습니다 — 한쪽이 옛말을 합니다 (§8-1).`);
  }
  assert.match(src, /from '\.\/probe-lib\.mjs'/, '공용 창구를 안 부릅니다.');
});
