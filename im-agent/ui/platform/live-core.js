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
      agents: ['04_financial', '08_appraisal', '09_massing'] },
    { id: 'check', label: '값 검증', why: '값 충돌·범위·정합성을 봅니다 — RED 가 있으면 배포가 막힙니다',
      agents: ['05_validation'] },
    { id: 'write', label: '문서 만들기', why: 'IM 본문·Teaser·출처표를 씁니다 (숫자는 자리표시자로만)',
      agents: ['06_im_writer'] },
    { id: 'final', label: '최종 검증', why: '배포 직전에 한 번 더 독립 검증합니다',
      agents: ['11_final_validation'] },
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

    var state = 'running';
    if (hasError) state = 'failed';
    else if (finished) state = 'done';

    // ★ 「무엇을 하고 있는가」를 한 줄로. 이게 이 화면의 존재 이유다
    var runningPhase = phases.filter(function (p) { return p.running; })[0];
    var headline = state === 'done' ? '생성이 끝났습니다'
      : state === 'failed' ? '생성 중 문제가 생겼습니다'
        : runningPhase ? (runningPhase.label + ' 중입니다')
          : '진행 중입니다';

    var problems = [];
    if (snap.bottleneck) problems.push('가장 오래 걸리는 곳: ' + String(snap.bottleneck.label || snap.bottleneck.id || snap.bottleneck));
    (snap.tracks && snap.tracks.validation && snap.tracks.validation.critical
      ? ['검증 RED ' + snap.tracks.validation.critical + '건 — 이대로는 배포가 막힙니다'] : [])
      .forEach(function (x) { problems.push(x); });
    if (o.error) problems.push('마지막 확인 실패: ' + o.error);

    return {
      state: state,
      headline: headline,
      note: runningPhase ? runningPhase.why : (snap.timing && snap.timing.note) || '',
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
            return { id: id, status: 'WAITING', label: '대기', tone: 'idle', elapsed: null, running: false };
          }),
        };
      }),
      activity: [], elapsed: null, remaining: null, problems: [],
    };
  }

  return {
    PHASES: PHASES, AGENT_STATE: AGENT_STATE,
    phaseOf: phaseOf, toneOf: toneOf, labelOf: labelOf,
    viewFrom: viewFrom, nextPollMs: nextPollMs, isFinal: isFinal, ms: ms,
  };
}));
