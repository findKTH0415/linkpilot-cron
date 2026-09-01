'use strict';
/**
 * agent-doctor.js — **Agent 하나가 다섯 곳에 다 배선됐는지, 그리고 그 결과가 쓰이는지 센다.**
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

    /* ⑦ **결과가 쓰이는가** 〈2026-08-26 사장님 지시 · 권고안〉
     *
     * ★★★ **부르는 것과 쓰이는 것은 다른 사실이다.** ④ 는 「부르는가」만 센다.
     *   실제로 오늘 `15_design` 이 그 자리에 걸렸다 — 배선 다섯 곳이 **전부
     *   초록**인데 그 판정이 최종 게이트까지 안 갔다. Design Manager 가
     *   「통과 못 했다」고 해도 문서는 그대로 나갔을 것이다.
     *   그리고 이 칸을 만들면서 **`18_legal` 도 같은 상태인 것**을 찾았다.
     *
     * ★ 무엇을 「쓰인다」로 보나 — `pipeline.js` 에서 그 결과를 담은 변수의
     *   **`.output` 이 한 번이라도 다시 나오는가.** 파일로 쓰든, 다음 Agent 의
     *   입력으로 넘기든, 화면에 찍든 그 자리를 지난다.
     *   `results[id] = x` 만 있는 것은 **쓰인 것이 아니다** — 그 표는 실행
     *   기록이지 산출물이 아니다.
     *
     * ★ 변수에 안 담고 바로 부르는 판(`await runAgent('x', …)`)도 **쓰이지 않는
     *   것으로 본다.** 담지 않았으면 다시 쓸 방법이 없다.
     */
    const bind = pipeline.match(
      new RegExp(`(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*await\\s+runAgent\\('${id}'`));
    const usedCount = bind
      ? (pipeline.match(new RegExp(`\\b${bind[1]}\\.output\\b`, 'g')) || []).length
      : 0;
    const used = usedCount > 0;
    if (called && !used) {
      bad('결과가 아무 데도 안 간다 — 부르기만 하고 `.output` 을 쓰지 않는다.'
        + ' 파일로 쓰거나 다음 Agent 에 넘기지 않으면 **돌기만 하고 아무것도 안 바꾼다**');
    }

    return {
      id,
      order: a.order,
      계약: contract,
      비중: weight === undefined ? '✗' : weight,
      선행: depends === undefined ? '✗' : (depends.length ? depends.join('·') : '(없음)'),
      부름: called ? 'ok' : '✗',
      화면: shown ? 'ok' : '✗',
      검사: tested ? 'ok' : '✗',
      쓰임: used ? `${usedCount}곳` : '✗',
    };
  });

  /* ────────────────────────────────────────────────────────────────
   * ★★★ **Task 그래프 전용 Agent — 다른 잣대로 잰다** 〈2026-08-26 · D-132〉
   *
   *   위 다섯은 **IM 파이프라인** 잣대다(파이프라인이 부르는가 · 진행률 비중 ·
   *   화면 단계). 화면 작업지시서(T22)에 그것을 들이대면 늘 빨갛다 —
   *   그리고 **늘 빨가면 아무도 안 본다.**
   *
   * ★★ 그렇다고 면제가 아니다. 여기가 「검사를 피하는 문」이 되면 다음 사람이
   *   막히는 Agent 를 전부 이쪽으로 옮긴다. 그래서 **더 좁게 잠근다**:
   *
   *     · 능력(capability)이 router 에 실재하고 그 Agent 를 가리켜야 한다
   *     · 그 능력을 쓰는 Task 가 taskplan 에 있어야 한다
   *     · 모듈 계약과 자기 검사는 **IM Agent 와 똑같이** 요구한다
   *     · **pipeline 이 부르면 오류다** — 그러면 Task 전용이 아니라
   *       IM Agent 이므로 AGENTS 로 옮겨 다섯 곳을 다 채워야 한다
   * ──────────────────────────────────────────────────────────────── */
  const routerSrc = read('core/router.js');
  const taskplanSrc = read('core/taskplan.js');

  const taskRows = (registry.listTaskAgents ? registry.listTaskAgents() : []).map((a) => {
    const id = a.id;
    const bad = (what) => problems.push(`${id}: ${what}`);

    let mod = null;
    let contract = 'ok';
    try { mod = require(path.join(ROOT, a.module.replace(/^\.\.\//, ''))); } catch (_) { mod = null; }
    if (!mod) { contract = '못 불렀다'; bad('모듈을 못 불렀다 — registry 의 module 경로를 본다'); }
    else {
      const miss = CONTRACT.filter((k) => mod[k] === undefined);
      if (miss.length) { contract = `빠짐: ${miss.join(',')}`; bad(`모듈 계약이 빠졌다: ${miss.join(', ')}`); }
      else if (mod.id !== id) { contract = `id 다름: ${mod.id}`; bad(`모듈의 id 가 registry 와 다르다 (${mod.id})`); }
    }

    /* ★ 능력이 실재하고 이 Agent 를 가리키는가 — 아니면 아무도 안 부른다 */
    const cap = a.capability;
    const capOk = Boolean(cap) && routerSrc.includes(`${cap}: {`) && routerSrc.includes(`'${id}'`);
    if (!capOk) bad(`router 에 이 Agent 를 가리키는 능력(${cap || '미기재'})이 없다 — 등록만 하고 아무도 안 부른다`);

    /* ★ 그 능력을 쓰는 Task 가 계획에 있는가 */
    const taskOk = Boolean(cap) && taskplanSrc.includes(`capability: '${cap}'`);
    if (!taskOk) bad(`taskplan 에 ${cap || '이 능력'} 을(를) 쓰는 Task 가 없다 — 계획에 안 나오면 영영 안 돈다`);

    /* ★★ pipeline 이 부르면 Task 전용이 아니다 — 갈래를 잘못 골랐다 */
    if (pipeline.includes(`runAgent('${id}'`)) {
      bad('pipeline 이 부른다 — Task 전용이 아니라 IM Agent 다. AGENTS 로 옮기고 다섯 곳을 다 채운다');
    }

    const tested = testBlob.includes(id);
    if (!tested) bad('이 Agent 를 이름으로 재는 검사가 하나도 없다');

    /* ★★★ **결과가 쓰이는가 — Task 잣대로** 〈2026-08-26〉.
     *
     *   위 ⑦ 은 `pipeline.js` 만 본다. Task 전용 Agent 는 pipeline 에 없으므로
     *   **그 칸을 그냥 비켜 간다** — 그러면 이 갈래가 「검사를 피하는 문」이 된다.
     *   D-132 가 걱정한 바로 그 자리이고, ⑦ 이 생긴 날 실제로 그렇게 됐다.
     *
     * ★ Task 에서 「쓰인다」는 **그 Task 가 내겠다고 적은 산출물을 실제로 쓰는가**다.
     *   `taskplan` 의 `outputs` 에 적힌 경로가 Agent 모듈 안에 있어야 한다.
     *   적어만 두고 안 쓰면 그 Task 는 **돌기만 하고 아무것도 안 남긴다** —
     *   그리고 다음 Task 는 없는 파일을 기다린다. */
    const taskBlock = a.task
      ? (taskplanSrc.match(new RegExp(`id: '${a.task}'[\\s\\S]*?\\}`)) || [''])[0]
      : '';
    const declared = [...taskBlock.matchAll(/'([\w/]+\.(?:json|md|html|svg|pptx|pdf))'/g)].map(m => m[1]);
    const modSrc = mod ? read(a.module.replace(/^\.\.\//, '') + '.js') : '';
    const unwritten = declared.filter(o => !modSrc.includes(o));
    if (declared.length && unwritten.length) {
      bad(`Task 가 내겠다고 적은 산출물을 모듈이 안 쓴다: ${unwritten.join(', ')}`
        + ' — 돌기만 하고 아무것도 안 남긴다. 다음 Task 는 없는 파일을 기다린다');
    }
    const used = declared.length > 0 && unwritten.length === 0;

    return { id, order: '(Task)', 계약: contract, 비중: '(IM 아님)', 선행: a.task || '✗', 부름: capOk ? cap : '✗', 화면: '(IM 아님)', 검사: tested ? 'ok' : '✗', 쓰임: used ? `${declared.length}건` : '✗' };
  });
  rows.push(...taskRows);

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
  process.stdout.write('\nAgent 배선 점검 — 여섯 곳이 다 맞는가 (부르는가 · 그리고 **쓰이는가**)\n\n');
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
