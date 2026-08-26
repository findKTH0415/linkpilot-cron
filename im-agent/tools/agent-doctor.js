'use strict';
/**
 * agent-doctor.js — **Agent 하나가 다섯 곳에 다 배선됐는지 센다.**
 *
 *   npm run agent:check
 *
 * ★★★ 왜 만들었나 〈2026-08-25 · D-48 · D-101〉.
 *
 *   Agent 를 붙이려면 **다섯 곳**을 함께 고쳐야 한다. 그런데 하나를 빠뜨려도
 *   **아무 오류가 안 난다** — 그냥 조용히 안 돌거나, 진행률만 슬쩍 틀어지거나,
 *   화면이 그 단계를 영영 안 그린다. 실제로 두 번 났다:
 *
 *     · D-48  커넥터 여섯이 등록만 되고 **한 번도 안 불렸다**
 *     · D-101 두 작업선이 같은 이름의 Agent 를 각자 만들었다
 *
 *   앞 판은 이 검사가 `12_sketchup_plan` **한 개에만** 있었다. 그러면
 *   **다음에 붙는 Agent 는 또 아무도 안 센다.** 그래서 전부를 센다.
 *
 * ★ 여기서 재는 것은 **배선**이지 그 Agent 가 옳은 일을 하는지가 아니다.
 *   무엇을 하는지는 그 Agent 의 자기 검사가 잰다.
 *
 * 되돌아오는 값: 0 다 맞다 · 1 빠진 곳이 있다
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** 진행률 비중 합계는 100 이어야 한다 — 뜻을 읽으려면 기준이 있어야 한다 */
const WEIGHT_TOTAL = 100;

/** Agent 모듈이 지켜야 하는 계약 (`core/runtime.js` 머리 주석) */
const CONTRACT = ['id', 'inputSchema', 'outputSchema', 'run'];

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_) { return ''; }
}

/**
 * @returns {{rows: object[], problems: string[], weightTotal: number}}
 */
function check() {
  const registry = require(path.join(ROOT, 'core', 'registry.js'));
  const monitor = require(path.join(ROOT, 'core', 'monitor.js'));

  const pipeline = read('pipeline.js');
  const live = read('ui/platform/live-core.js');
  const testDir = path.join(ROOT, 'test');
  const tests = fs.existsSync(testDir) ? fs.readdirSync(testDir) : [];
  const testBlob = tests.map((f) => read(path.join('test', f))).join('\n');

  const problems = [];
  const rows = registry.list().map((a) => {
    const id = a.id;
    const bad = (what) => problems.push(`${id}: ${what}`);

    /* ① 모듈이 실재하고 계약을 지키는가 */
    let mod = null;
    let contract = 'ok';
    try {
      mod = require(path.join(ROOT, 'core', a.module.replace(/^\.\.\//, '../')));
    } catch (_) {
      try { mod = require(path.join(ROOT, a.module.replace(/^\.\.\//, ''))); } catch (_) { mod = null; }
    }
    if (!mod) { contract = '못 불렀다'; bad('모듈을 못 불렀다 — registry 의 module 경로를 본다'); }
    else {
      const miss = CONTRACT.filter((k) => mod[k] === undefined);
      if (miss.length) { contract = `빠짐: ${miss.join(',')}`; bad(`모듈 계약이 빠졌다: ${miss.join(', ')}`); }
      else if (mod.id !== id) { contract = `id 다름: ${mod.id}`; bad(`모듈의 id 가 registry 와 다르다 (${mod.id})`); }
    }

    /* ② 진행률 비중 — 없으면 기본값으로 잡혀 진행률이 슬쩍 틀어진다 */
    const weight = monitor.WEIGHTS[id];
    if (weight === undefined) bad('진행률 비중(WEIGHTS)이 없다 — 기본값으로 잡혀 진행률이 틀어진다');

    /* ③ 선행 Agent — 없으면 병목 판정이 엉뚱한 곳을 가리킨다 */
    const depends = monitor.DEPENDS[id];
    if (depends === undefined) bad('선행(DEPENDS)이 없다 — 병목 판정이 엉뚱한 곳을 가리킨다');
    else {
      const unknown = depends.filter((d) => !registry.get(d));
      if (unknown.length) bad(`모르는 Agent 를 선행으로 적었다: ${unknown.join(', ')}`);
    }

    /* ④ 실제로 부르는가 — 등록만 하고 안 부르면 없는 것과 같다 (D-48) */
    const called = pipeline.includes(`runAgent('${id}'`);
    if (!called) bad('pipeline 이 안 부른다 — 등록만 하고 안 부르면 없는 것과 같다 (D-48)');

    /* ⑤ 화면 단계에 있는가 — 없으면 진행 화면이 이 단계를 영영 안 그린다 */
    const shown = live.includes(`'${id}'`);
    if (!shown) bad('화면 단계(live-core)에 없다 — 진행 화면이 이 단계를 영영 안 그린다');

    /* ⑥ 자기 검사가 있는가 — 없으면 다음 사람이 마음대로 고친다 */
    const tested = testBlob.includes(id);
    if (!tested) bad('이 Agent 를 이름으로 재는 검사가 하나도 없다');

    return {
      id,
      order: a.order,
      계약: contract,
      비중: weight === undefined ? '✗' : weight,
      선행: depends === undefined ? '✗' : (depends.length ? depends.join('·') : '(없음)'),
      부름: called ? 'ok' : '✗',
      화면: shown ? 'ok' : '✗',
      검사: tested ? 'ok' : '✗',
    };
  });

  const weightTotal = Object.values(monitor.WEIGHTS).reduce((a, b) => a + b, 0);
  if (weightTotal !== WEIGHT_TOTAL) {
    problems.push(`진행률 비중 합계가 ${weightTotal} 이다 — ${WEIGHT_TOTAL} 이어야 한다.`
      + ' 새 Agent 를 더할 때는 **어디서 덜어 올지 함께 정한다**');
  }

  /* 차례가 겹치면 어느 쪽이 먼저인지 코드가 정하게 된다 */
  const orders = rows.map((r) => r.order);
  const dupOrder = orders.filter((o, i) => orders.indexOf(o) !== i);
  if (dupOrder.length) problems.push(`실행 차례(order)가 겹친다: ${[...new Set(dupOrder)].join(', ')}`);

  return { rows, problems, weightTotal };
}

function main() {
  const { rows, problems, weightTotal } = check();
  process.stdout.write('\nAgent 배선 점검 — 다섯 곳이 다 맞는가\n\n');
  // eslint-disable-next-line no-console
  console.table(rows);
  process.stdout.write(`  Agent ${rows.length}개 · 진행률 비중 합계 ${weightTotal}\n\n`);

  if (!problems.length) {
    process.stdout.write('✅ 빠진 곳이 없다.\n');
    return 0;
  }
  problems.forEach((p) => process.stdout.write(`  ❌ ${p}\n`));
  process.stdout.write('\n❌ 빠진 곳이 있다. **오류는 안 나지만 조용히 안 돈다.**\n');
  return 1;
}

module.exports = { check, CONTRACT, WEIGHT_TOTAL };

if (require.main === module) process.exit(main());
