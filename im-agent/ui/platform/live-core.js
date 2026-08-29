/**
 * live-core.js — 생성이 도는 동안 **무엇이 일어나고 있는지**를 사람의 말로 바꾼다.
 *
 * 화면(reports.html)은 이 파일이 만든 것을 그리기만 한다. 판정을 화면에 두면
 * 미리보기와 제품이 갈리고, 테스트로 고정할 수도 없다.
 *
 * ★ **진행률을 여기서 다시 계산하지 않는다.** `core/monitor.js` 가 준 값을 쓴다.
 *   화면이 자기 식으로 세기 시작하면 대시보드와 제작현황이 서로 다른 숫자를
 *   보여주고, 어느 쪽이 맞는지 아무도 모르게 된다.
 *
 * ★ **없는 것을 있는 것처럼 만들지 않는다.** 큐에 들어갔지만 아직 시작 전이면
 *   실행 기록이 없다(404). 그때 0% 막대를 그리면 "돌고 있는데 멈춰 있다"로
 *   읽힌다 — 「차례를 기다리는 중」이라고 말하고 막대를 그리지 않는다.
 *
 * ★ **폴링이 실패하면 조용히 멈추지 않는다.** 화면이 마지막 상태로 굳으면
 *   사용자는 생성이 멈춘 줄 안다. 사유를 남기고, 몇 번 더 시도하고, 그래도 안
 *   되면 "확인할 수 없다"고 적는다 — 「진행 중」으로 두지 않는다.
 *
 * 의존성 없음. 브라우저·Node 양쪽에서 돈다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPilotLive = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * ★ **이 스크립트가 어느 판인가** 〈2026-08-23 · D-93 사고〉.
   *   `build-stamp.js` 가 채운다 — 손으로 고치지 않는다. 화면이 자기
   *   지문과 대 보고 다르면 「함수가 없다」로 죽기 전에 사람 말로 알린다.
   */
  var LP_BUILD = '8b8a0d67';

  /**
   * 제작 과정을 사람이 아는 말로 묶은 카테고리.
   *
   * ★ Agent 이름(`07_geo`)을 그대로 보여주지 않는다. 사용자는 그것이 무엇인지
   *   모르고, 몰라도 되는 것이 맞다. 대신 **무엇을 하고 있는지**를 적는다.
   * ★ 순서는 registry 의 실행 순서와 같아야 한다 — 뒤 단계가 먼저 끝난 것처럼
   *   보이면 화면이 거짓말한다 (`live.test.js` 가 순서를 검사한다).
   */
  var PHASES = [
    { id: 'prep', label: '준비', why: '출력 사양을 잠그고 프로젝트 폴더를 만듭니다',
      agents: ['10_output_spec', '01_project'] },
    { id: 'read', label: '자료 읽기', why: '올린 파일에서 값을 뽑습니다 (스캔본은 글자로 옮겨서)',
      agents: ['02_extraction'] },
    { id: 'public', label: '공부·시장 조회', why: '지적·건축물대장·인허가·금리·시세를 독립된 출처에서 받아옵니다',
      agents: ['07_geo', '03_research'] },
    { id: 'calc', label: '계산·검토', why: '재무모델·감정평가·매스 검토를 돌립니다 (숫자는 함수가 만듭니다)',
      agents: ['04_financial', '08_appraisal', '09_massing', '12_sketchup_plan', '13_sketchup_intake'] },
    { id: 'check', label: '값 검증', why: '법령 한도·값 충돌·범위·정합성을 봅니다 — RED 가 있으면 배포가 막힙니다',
      agents: ['18_legal', '05_validation'] },
    { id: 'write', label: '문서 만들기', why: 'IM 본문·Teaser·출처표를 씁니다 (숫자는 자리표시자로만)',
      agents: ['06_im_writer'] },
    { id: 'final', label: '최종 검증', why: '디자인 규칙을 대고, 배포 직전에 한 번 더 독립 검증합니다',
      agents: ['15_design', '11_final_validation'] },
  ];

  /** Agent 상태 → 사람이 읽는 말. monitor.STATUS 와 같은 값을 쓴다 */
  var AGENT_STATE = {
    WAITING: { label: '대기', tone: 'idle' },
    QUEUED: { label: '대기', tone: 'idle' },
    RUNNING: { label: '진행 중', tone: 'run' },
    COMPLETED: { label: '완료', tone: 'ok' },
    WARNING: { label: '경고 있음', tone: 'warn' },
    ERROR: { label: '실패', tone: 'bad' },
    BLOCKED: { label: '막힘', tone: 'bad' },
    SKIPPED: { label: '건너뜀', tone: 'idle' },
    APPROVED: { label: '승인됨', tone: 'ok' },
  };

  /** 한 카테고리의 상태는 **가장 나쁜 것**을 따른다 — 좋은 쪽으로 뭉개지 않는다 */
  var TONE_RANK = { bad: 4, warn: 3, run: 2, ok: 1, idle: 0 };

  function phaseOf(agentId) {
    for (var i = 0; i < PHASES.length; i++) {
      if (PHASES[i].agents.indexOf(agentId) !== -1) return PHASES[i].id;
    }
    return null;
  }

  function toneOf(status) {
    var s = AGENT_STATE[status];
    return s ? s.tone : 'idle';
  }

  function labelOf(status) {
    var s = AGENT_STATE[status];
    return s ? s.label : String(status || '알 수 없음');
  }

  function ms(n) {
    if (n == null || !isFinite(n) || n < 0) return null;
    var sec = Math.round(n / 1000);
    if (sec < 60) return sec + '초';
    var m = Math.floor(sec / 60);
    return m + '분 ' + (sec % 60) + '초';
  }

  /**
   * 폴링 간격. 도는 동안은 자주, 큐에서 기다리는 동안은 느리게.
   *
   * ★ 실패가 이어지면 **간격을 늘린다.** 서버가 죽었는데 1초마다 두드리면
   *   회복을 더 늦춘다. 대신 화면에는 "확인 중"이 아니라 사유를 적는다.
   */
  function nextPollMs(view, failures) {
    if (isFinal(view.state)) return 0;
    var base = view.state === 'queued' ? 4000 : 2000;
    if (!failures) return base;
    return Math.min(base * Math.pow(2, failures), 30000);
  }

  function isFinal(state) {
    return state === 'done' || state === 'failed' || state === 'unknown';
  }

  /**
   * 지금 화면에 무엇을 그릴지 정한다.
   *
   * @param {object} inp
   *   snapshot  GET /projects/:id/control-tower 응답 (없으면 null)
   *   run       POST /reports 가 준 {runId, status, position} (없으면 null)
   *   error     마지막 폴링 오류 메시지 (없으면 null)
   *   failures  연속 실패 횟수
   * @returns {{state, headline, note, pct, current, phases, activity, elapsed, remaining, problems}}
   */
  function viewFrom(inp) {
    var o = inp || {};
    var snap = o.snapshot || null;
    var run = o.run || null;
    var failures = o.failures || 0;

    // ── 아직 실행 기록이 없다 ────────────────────────────
    if (!snap) {
      if (failures >= 3) {
        return blank('unknown',
          '진행 상황을 확인할 수 없습니다',
          (o.error ? o.error + ' — ' : '')
          + '생성이 멈췄다는 뜻은 아닙니다. 화면을 새로 고치거나 [IM 제작현황]에서 확인하세요.');
      }
      if (run && run.status === 'queued') {
        return blank('queued', '차례를 기다리는 중입니다',
          run.position > 1 ? ('앞에 ' + (run.position - 1) + '건이 있습니다.') : '곧 시작합니다.');
      }
      return blank('queued', '생성을 시작하는 중입니다',
        '아직 실행 기록이 없습니다 — 진행률은 시작한 뒤에 나옵니다.');
    }

    // ── 카테고리별로 묶는다 ──────────────────────────────
    var byId = {};
    (snap.agents || []).forEach(function (a) { byId[a.id] = a; });

    var phases = PHASES.map(function (p) {
      var items = p.agents.map(function (id) {
        var a = byId[id];
        return {
          id: id,
          status: a ? a.status : 'WAITING',
          label: labelOf(a ? a.status : 'WAITING'),
          tone: toneOf(a ? a.status : 'WAITING'),
          elapsed: a ? ms(a.elapsedMs) : null,
          running: !!a && a.status === 'RUNNING',
          error: a && a.error ? String(a.error) : null,
        };
      });
      var worst = items.reduce(function (t, it) {
        return TONE_RANK[it.tone] > TONE_RANK[t] ? it.tone : t;
      }, 'idle');
      var doneCount = items.filter(function (i) {
        return i.tone === 'ok' || i.tone === 'warn';
      }).length;
      return {
        id: p.id, label: p.label, why: p.why,
        tone: worst,
        running: items.some(function (i) { return i.running; }),
        done: doneCount === items.length,
        doneCount: doneCount, total: items.length,
        items: items,
      };
    });

    var finished = !!(snap.timing && snap.timing.finishedAt);
    var hasError = phases.some(function (p) { return p.tone === 'bad'; });

    /**
     * ★★★ **어디서 멈췄는지 말한다** 〈2026-08-24 사장님 화면: 47% 에서
     *   「생성 중 문제가 생겼습니다」 · 까닭이 한 줄도 없었다〉.
     *
     *   그때 화면이 준 것은 머리말 한 줄과 경고 몇 줄뿐이었다. 실패한 Agent 와
     *   그 까닭은 **서버가 이미 들고 있었는데**(monitor 의 각 Agent 기록)
     *   화면이 안 꺼내 썼다. 그래서 사진을 보고도 원인을 못 찾았다.
     *
     * ★ Agent 이름(`06_im_writer`)이 아니라 **단계 이름**으로 말한다 — 사용자가
     *   아는 말이 그것이다. 까닭이 비어 있으면 **비었다고** 적는다.
     */
    var stopped = [];
    phases.forEach(function (p) {
      p.items.forEach(function (it) {
        if (it.tone === 'bad') stopped.push({ phase: p.label, id: it.id, error: it.error });
      });
    });

    var state = 'running';
    if (hasError) state = 'failed';
    else if (finished) state = 'done';

    // ★ 「무엇을 하고 있는가」를 한 줄로. 이게 이 화면의 존재 이유다
    var runningPhase = phases.filter(function (p) { return p.running; })[0];
    var headline = state === 'done' ? '생성이 끝났습니다'
      : state === 'failed' ? '생성 중 문제가 생겼습니다'
        : runningPhase ? (runningPhase.label + ' 중입니다')
          : '진행 중입니다';

    /* ★ 머리말 바로 밑(note)에 첫 까닭을 놓는다 — 아래로 스크롤해야 보이면 안 본다.
     *   나머지는 problems 로 내린다. 같은 줄을 두 곳에 적지 않는다. */
    var stopLines = stopped.map(function (x) {
      return x.phase + ' 에서 멈췄습니다 — '
        + (x.error || '까닭이 기록되지 않았습니다. [IM 제작현황]의 활동 기록을 보세요.');
    });

    var problems = stopLines.slice(1);
    if (snap.bottleneck) problems.push('가장 오래 걸리는 곳: ' + String(snap.bottleneck.label || snap.bottleneck.id || snap.bottleneck));
    (snap.tracks && snap.tracks.validation && snap.tracks.validation.critical
      ? ['검증 RED ' + snap.tracks.validation.critical + '건 — 이대로는 배포가 막힙니다'] : [])
      .forEach(function (x) { problems.push(x); });
    if (o.error) problems.push('마지막 확인 실패: ' + o.error);

    return {
      state: state,
      headline: headline,
      note: stopLines.length ? stopLines[0]
        : (runningPhase ? runningPhase.why : (snap.timing && snap.timing.note) || ''),
      stopped: stopped,
      pct: typeof snap.overall === 'number' ? snap.overall : null,
      current: snap.currentAgent || null,
      phases: phases,
      activity: (snap.activity || []).slice(0, 8),
      elapsed: ms(snap.timing && snap.timing.elapsedMs),
      remaining: ms(snap.timing && snap.timing.estimatedRemainingMs),
      problems: problems,
    };
  }

  function blank(state, headline, note) {
    return {
      state: state, headline: headline, note: note,
      pct: null,            // ★ 0 이 아니라 null 이다 — 0% 막대는 '멈춰 있다'로 읽힌다
      current: null,
      phases: PHASES.map(function (p) {
        return {
          id: p.id, label: p.label, why: p.why, tone: 'idle',
          running: false, done: false, doneCount: 0, total: p.agents.length,
          items: p.agents.map(function (id) {
            return { id: id, status: 'WAITING', label: '대기', tone: 'idle', elapsed: null, running: false, error: null };
          }),
        };
      }),
      activity: [], elapsed: null, remaining: null, problems: [], stopped: [],
    };
  }

  /* ─────────────────────────────────────────────────────────
   * 흐름 전체의 세부 진행률
   *
   * ★ 4단계는 **성격이 다르다.** 1·2단계는 사람이 채우는 것이고, 3단계는
   *   눌렀느냐 아니냐이고, 4단계만 기계가 도는 것이다. 넷을 하나의 %로 뭉개면
   *   "80%" 가 무엇의 80% 인지 아무도 모른다 — 그래서 **단계마다 따로** 보이고,
   *   합계는 만들지 않는다.
   *
   * ★ 모르는 것은 `null` 이다. 서버에 안 물어봤거나 못 받은 것을 0% 로 그리면
   *   "아무것도 안 됐다"로 읽힌다 (M-07 옆의 같은 실패).
   * ───────────────────────────────────────────────────────── */

  /**
   * ★★ 이름은 `flow-core.js` 의 `STEPS` 와 **글자 그대로 같아야 한다.**
   *   여기 따로 적혀 있는 이유는 이 모듈이 flow-core 없이도 돌아야 하기
   *   때문인데(테스트가 단독으로 부른다), **사본은 갈린다** — 그래서
   *   `flow.test.js` 가 두 표를 나란히 세워 대조한다. 한쪽만 고치면 빨개진다.
   */
  /**
   * ★★★ **진행률은 레일보다 성기게 센다** 〈2026-08-22 사용자 지시 — 단계 다섯〉.
   *
   *   레일(`flow-core.js`)은 다섯 칸이다. 그런데 앞의 셋(제작 기본정보 · 무엇을
   *   만들까요 · 관련자료)은 **한 번의 「만들기」로 함께 서버에 간다** — 서버가
   *   가진 것으로는 셋을 갈라 셀 수가 없다. 없는 눈금을 지어내면 「1단계 60%」
   *   같은 숫자가 나오는데 그 60 이 무엇의 60인지 아무도 모른다.
   *
   *   ★ 그래서 `covers` 에 **어느 레일 칸을 묶었는지** 적는다. 검사가 이 표와
   *     `flow-core.js` 를 대조한다 — 레일에 칸이 늘었는데 여기가 모르면 그 칸은
   *     **진행률에서 통째로 빠진 채** 아무 오류도 안 난다.
   */
  var STEPS = [
    { id: 'intake', n: 1, label: '입력 채우기 (1~3단계)', covers: ['basics', 'ask', 'sources'] },
    { id: 'fields', n: 2, label: '가이드 필드 (자동입력 + 직접입력)', covers: ['fields'] },
    { id: 'spec', n: 3, label: '출력조건', covers: ['spec'] },
    /* ★★ **레일은 셋인데 여기는 넷이다** 〈2026-08-22 사용자 지시〉.
     *   레일에서 「생성」 칸을 뺀 것은 **옮겨 갈 곳이 없어서**다 — 출력조건과
     *   같은 화면이고 확정하면 그 자리에서 바뀐다.
     *   ★ 그런데 **진행률은 넷을 센다.** 생성은 실제로 도는 일이고, 그 동안
     *     사람은 기다린다. 「출력조건 100%」로 뭉뚱그리면 **만들어지는 중인지
     *     끝났는지**가 사라진다 — 기다리는 사람에게 그것이 전부다.
     *   ★ 묶음(`covers`)이 레일 칸 전부를 덮는지 검사가 잰다. */
    /* ★★ 「완성 보고서」가 레일의 마지막 칸이 되었다 〈2026-08-28 · D-157〉.
     *   앞 판의 이름은 「생성」이었다 — 레일에 없는 칸이라 진행률만 쓰던 이름이다.
     *   이제 레일에 **같은 자리**가 생겼으므로 **이름을 하나로 맞춘다.**
     *   한 칸만 덮는 것은 이름이 같아야 한다(`flow.test.js`) — 다르면 같은 곳을
     *   두 이름으로 부르게 되고, 어느 쪽이 진짜인지 화면만 봐서는 모른다. */
    { id: 'make', n: 4, label: '완성 보고서', covers: ['done'] },
  ];

  /**
   * @param {object} d
   *   project   프로젝트가 만들어졌는가 (id 또는 null)
   *   sources   올린 자료 이름 배열 (없으면 null = 모름)
   *   fields    GET /fields 의 fields (없으면 null)
   *   values    GET /facts 의 values (없으면 null)
   *   docType   'im' 등 — 필수 항목 판정에 쓴다
   *   spec      GET /spec 의 spec (없으면 null)
   *   snapshot  control-tower 스냅샷 (없으면 null)
   *   computed  계산 전용 key 목록 (dictionary.COMPUTED_KEYS)
   *   complete  fields-core.completeness 함수 (주입 — 두 벌로 만들지 않는다)
   */
  /**
   * 네 단계를 성격으로 묶은 **두 눈금**. 목록을 화면에 적지 않는다 —
   * 여기가 단일 출처다 (`groupProgress` 가 이 순서·구성을 그대로 쓴다).
   */
  var GROUPS = [
    // ★ why 에 단계 번호를 적지 않는다. 화면이 steps 에서 뽑아 칩으로 보여주므로
    //   여기 또 적으면 단계를 늘리는 날 한쪽만 고쳐져 서로 다른 말을 한다
    { id: 'fill', label: '정보값 채우기', why: '사람이 값과 출처를 넣습니다',
      steps: ['intake', 'fields', 'spec'] },
    { id: 'make', label: '보고서 생성', why: '기계가 돕니다 — 채우기가 끝나야 시작합니다',
      steps: ['make'] },
  ];

  function stepProgress(d) {
    var o = d || {};
    var steps = [];

    // ① 입력 — 프로젝트가 있어야 나머지가 열린다. 자료는 있으면 좋고 없어도 된다
    var hasProject = !!o.project;
    var srcCount = o.sources ? o.sources.length : null;
    steps.push({
      id: 'intake', n: 1, label: STEPS[0].label,
      pct: hasProject ? 100 : 0,
      state: hasProject ? 'done' : 'todo',
      detail: hasProject
        ? (srcCount === null ? '프로젝트가 만들어졌습니다'
          : (srcCount > 0 ? '자료 ' + srcCount + '건을 올렸습니다'
            : '자료 없이 진행 중 — 값을 전부 직접 넣어야 합니다'))
        : '아직 프로젝트가 없습니다',
      parts: null,
      units: { done: hasProject ? 1 : 0, total: 1 },
    });

    // ② 가이드 필드 — 필수 항목 중 값과 출처가 **둘 다** 있는 것만 센다.
    //
    // ★ 자산군 전용 필수(`classKeys`)가 함께 세어진다. 이걸 빼면 호텔 딜에서
    //   객실 수를 안 받고도 「필수 다 채웠다」가 되고, 매출 가정을 검증할
    //   근거가 없는 채로 생성이 열린다
    var c = (o.fields && o.values && typeof o.complete === 'function')
      ? o.complete(o.fields, o.values, o.docType || 'im', o.classKeys || null) : null;
    steps.push({
      id: 'fields', n: 2, label: STEPS[1].label,
      pct: c ? c.percent : null,
      state: !c ? 'unknown' : (c.filled >= c.total ? 'done' : (c.filled ? 'doing' : 'todo')),
      detail: c
        ? ('필수 ' + c.total + '개 중 ' + c.filled + '개 (값과 출처가 모두 있어야 셉니다)'
          + ((o.classKeys && o.classKeys.length)
            ? ' · ' + (o.classLabel || '자산군') + ' 전용 ' + o.classKeys.length + '개 포함' : ''))
        : '아직 확인하지 못했습니다',
      parts: c ? [
        { label: '채움', n: c.filled },
        { label: '남음', n: c.total - c.filled },
      ] : null,
      units: c ? { done: c.filled, total: c.total } : null,
    });

    // ③ 출력 사양 — 눌렀느냐 아니냐다. 중간이 없다
    //
    // ★ **「안 물어봤다」와 「물어봤는데 없다」를 가른다.** `undefined` 는 아직
    //   서버에 못 물어본 것이고(모름 → null), `null` 은 물어봤더니 사양이 없는
    //   것이다(0%). 둘을 같게 두면 화면이 못 받은 것을 「아직 안 정했다」로 단정한다.
    var specAsked = o.spec !== undefined;
    var spec = o.spec || null;
    steps.push({
      id: 'spec', n: 3, label: STEPS[2].label,
      pct: spec ? (spec.locked ? 100 : 50) : (specAsked ? 0 : null),
      state: spec ? (spec.locked ? 'done' : 'doing') : (specAsked ? 'todo' : 'unknown'),
      detail: spec
        ? (spec.locked ? '확정됨 — 이제 생성할 수 있습니다'
          : '정했지만 확정 전입니다. 확정해야 생성이 시작됩니다')
        : (specAsked ? '아직 정하지 않았습니다' : '아직 확인하지 못했습니다'),
      parts: null,
      units: specAsked ? { done: (spec && spec.locked) ? 1 : 0, total: 1 } : null,
    });

    // ④ 생성 — 기계가 도는 구간. monitor 가 준 값을 그대로 쓴다
    var snapAsked = o.snapshot !== undefined;
    var snap = o.snapshot || null;
    var snapDone = !!(snap && snap.timing && snap.timing.finishedAt);
    steps.push({
      id: 'make', n: 4, label: STEPS[3].label,
      pct: snap && typeof snap.overall === 'number' ? snap.overall : null,
      state: snap ? (snapDone ? 'done' : 'doing') : (snapAsked ? 'todo' : 'unknown'),
      detail: snap
        ? (snapDone ? '끝났습니다' : '도는 중입니다 — 아래 [제작 진행] 에서 자세히 보입니다')
        : (snapAsked ? '아직 시작하지 않았습니다' : '아직 확인하지 못했습니다'),
      parts: snap && snap.tracks ? Object.keys(snap.tracks).map(function (k) {
        return { label: snap.tracks[k].label || k, n: snap.tracks[k].pct };
      }) : null,
      // ★ 셀 단위가 없다. 기계가 도는 구간이라 「몇 개 중 몇 개」로 나뉘지 않는다 —
      //   monitor 가 준 % 를 그대로 쓴다
      units: null,
    });

    return steps;
  }

  /**
   * 계산 항목 — **사람이 넣지 않는 19개**가 지금 몇 개 만들어졌는가.
   *
   * ★ 여기에 "입력 진행률"을 섞지 않는다. 계산 항목은 4단계에서 만들어지고,
   *   그 전에는 0개인 것이 정상이다. 0/19 를 빨갛게 칠하면 사람은 자기가
   *   무언가 안 한 줄 안다 — 그래서 시작 전에는 '아직'이라고만 적는다.
   */
  /**
   * 네 단계를 **성격으로** 둘로 나눈 큰 눈금.
   *
   * ★ 왜 넷을 하나로 뭉치지 않고 둘로 나누는가: 1·2·3 은 **사람이 값을 채우는
   *   일**이고 4 는 **기계가 도는 일**이다. 성격이 다른 둘을 한 막대로 뭉치면
   *   "80%" 가 내가 더 할 일이 남았다는 뜻인지 기다리면 되는 상태인지 알 수 없다.
   *   나누면 그 질문에 바로 답한다 — 「내가 채울 것」과 「기다리면 되는 것」.
   *
   * ★ 채우기 % 는 **평균이 아니라 개수**다. 세 단계의 %를 평균 내면 필수 항목
   *   17개를 0개 채운 사람과 1개 남긴 사람이 같은 자리에 선다. 그래서 실제로
   *   채워야 할 것을 하나씩 세고(프로젝트 1 + 필수 N + 사양 확정 1), 그 비를 쓴다.
   *
   * ★ 하나라도 못 물어봤으면 **아는 것만 세지 않는다.** 분모가 줄어 진행률이
   *   부풀기 때문이다 — 모른다고 적는다.
   *
   * @param {Array} steps stepProgress() 결과
   */
  function groupProgress(steps) {
    var by = {};
    (steps || []).forEach(function (s) { by[s.id] = s; });

    var done = 0, total = 0, unknown = [];
    GROUPS[0].steps.forEach(function (id) {
      var s = by[id];
      if (!s || !s.units) { unknown.push(s ? s.label : id); return; }
      done += s.units.done;
      total += s.units.total;
    });

    var fillKnown = unknown.length === 0 && total > 0;
    var fillPct = fillKnown ? Math.round(done / total * 100) : null;
    var fill = {
      id: GROUPS[0].id, label: GROUPS[0].label, why: GROUPS[0].why,
      pct: fillPct,
      state: !fillKnown ? 'unknown'
        : (done >= total ? 'done' : (done ? 'doing' : 'todo')),
      detail: fillKnown
        ? ('채워야 할 ' + total + '개 중 ' + done + '개 (' + (total - done) + '개 남음)')
        : ('아직 확인하지 못했습니다 — ' + unknown.join(' · ')),
      units: fillKnown ? { done: done, total: total } : null,
      steps: GROUPS[0].steps.map(function (id) { return by[id]; }).filter(Boolean),
    };

    // ★ 생성은 채우기가 끝나야 시작한다. 「아직 시작하지 않았습니다」만 적으면
    //   사용자는 버튼을 찾는데, 버튼은 사양을 확정해야 열린다 — 무엇이 막고
    //   있는지 함께 적는다
    var m = by.make || null;
    var make = {
      id: GROUPS[1].id, label: GROUPS[1].label, why: GROUPS[1].why,
      pct: m ? m.pct : null,
      state: m ? m.state : 'unknown',
      detail: (m && m.state === 'todo' && fill.state !== 'done')
        ? '정보값을 다 채우고 사양을 확정하면 시작됩니다'
        : (m ? m.detail : '아직 확인하지 못했습니다'),
      units: null,
      steps: m ? [m] : [],
    };

    return [fill, make];
  }

  function computedProgress(computedKeys, values, started) {
    var keys = computedKeys || [];
    var v = values || {};
    var made = keys.filter(function (k) {
      var x = v[k];
      return x && x.value !== null && x.value !== undefined && x.value !== '';
    });
    return {
      total: keys.length,
      made: made.length,
      pct: keys.length ? Math.round(made.length / keys.length * 100) : 0,
      started: !!started,
      detail: !started
        ? '생성할 때 만들어집니다 — 지금 비어 있는 것이 정상입니다'
        : (made.length >= keys.length ? '전부 만들어졌습니다'
          : made.length + '개까지 만들어졌습니다'),
      keys: made,
    };
  }

  return {
    BUILD: LP_BUILD,
    PHASES: PHASES, AGENT_STATE: AGENT_STATE, STEPS: STEPS,
    GROUPS: GROUPS,
    stepProgress: stepProgress, groupProgress: groupProgress,
    computedProgress: computedProgress,
    phaseOf: phaseOf, toneOf: toneOf, labelOf: labelOf,
    viewFrom: viewFrom, nextPollMs: nextPollMs, isFinal: isFinal, ms: ms,
  };
}));
