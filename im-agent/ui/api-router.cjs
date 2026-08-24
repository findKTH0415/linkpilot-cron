'use strict';
/**
 * api-router.js — LinkPilot 본체 Node API(8181)에 붙이는 라우터.
 *
 * 대시보드가 읽는 4개 엔드포인트만 노출한다. 전부 **읽기 전용**이다.
 *   GET /projects
 *   GET /projects/:id/control-tower
 *   GET /projects/:id/lineage/:key
 *   GET /projects/:id/impact/:key
 *
 * ★ 보안 규칙
 *   - projectId·key 를 경로에 그대로 쓰지 않는다. 형식 검증 후 화이트리스트만 통과시킨다
 *     (경로 조작으로 프로젝트 폴더 밖 파일을 읽히면 안 된다).
 *   - 쓰기 동작은 노출하지 않는다. 승인·사양 확정은 CLI 또는 별도 인증 경로로만.
 *
 * 의존성 0건 — express 가 있으면 express.Router, 없으면 순수 핸들러로 쓸 수 있다.
 *
 * ※ 확장자가 .cjs 인 이유: ui/ 폴더는 React 컴포넌트를 위해 ESM 으로 선언되어 있는데
 *   이 파일은 본체 Node API(CommonJS)가 require 로 불러야 한다.
 */

const path = require('path');
const routes = require('./routes.cjs');

const PROJECT_ID = /^LP-[A-Z]+-\d{4}-\d{3}$/;
const DICT_KEY = /^[a-z_]+\.[a-z_]+$/;

/**
 * 업로드 한도. 화면과 서버가 같은 값을 봐야 하므로 **여기서 한 번만 정한다.**
 *
 * 〈2026-08-22 ① 상향 — 20MB/60MB → 30MB/100MB (사용자 지시)〉
 *   신고: 「파일이 너무 큽니다 — 23.3 MB (한도 20.0 MB)」. 실무 자료(도면 붙은
 *   사업계획서·감사보고서 스캔본)가 20MB 를 예사로 넘긴다.
 *
 * 〈2026-08-22 ② **한 번에** 를 100MB → 45MB 로 내린다 (D-81 · 사용자 결정)〉
 *
 * ★★ **약속을 실제로 받는 값에 맞춘다.** 운영 NAS 의 엔진 서버가 본문을
 *   **64MB** 에서 끊는다 — 실측이다(1·8·24·48MB 는 통과, 64MB 에서 벽).
 *
 *     const MAX_BODY = 64 * 1024 * 1024;
 *     req.on('data', … if (size > MAX_BODY) { req.destroy(); } …)
 *
 *   그래서 100MB 를 약속하면 **48~100MB 묶음은 화면이 「됩니다」라고 해 놓고
 *   조용히 끊긴다.** `req.destroy()` 라 응답이 아예 없어서 화면은 이유를 말할
 *   재료조차 없다. 약속과 실제가 갈리는 이 상태가 가장 비싸다.
 *
 * ★★ **45MB 이지 48MB 가 아니다.** 64MB ÷ 1.333 ≈ 48MB 는 **벽 그 자체**라
 *   딱 맞추면 파일 이름·JSON 껍데기 몇 바이트에 넘어간다. 45MB → 본문 60MB 로
 *   **4MB 를 남긴다.** 「이론상 맞는 값」과 「실제로 지나가는 값」은 다르다.
 *
 *     파일 하나 30MB  → 본문 약 40MB   (64MB 안 · 통과)
 *     한 번에  45MB   → 본문 약 60MB   (64MB 안 · 여유 4MB)
 *
 * ★ 메모리도 같은 방향을 가리킨다. 운영 NAS 는 RAM 1.8GB 이고, 133MB 본문을
 *   파싱하면 문자열 + 디코드 버퍼로 순간 300MB 안팎을 쓴다. 한 번에 100MB 는
 *   **여러 사람이 동시에 올리는 상황을 견디는 값이 아니었다.**
 *
 * ★ NAS 를 올리는 길(㉮)도 있었다. 사용자가 **내리는 쪽**을 골랐다 (D-81).
 *   나중에 NAS `MAX_BODY` 를 올리면 여기 숫자만 다시 올리면 된다 —
 *   `MIN_BODY_BYTES` 가 따라 계산된다. `deploy/앱-업로드-한도.md` 참고.
 */
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_REQUEST_BYTES = 45 * 1024 * 1024;

/** base64 로 부풀어 오르는 비율 — 본체가 본문 한도를 정할 때 쓰는 값 */
const BASE64_OVERHEAD = 4 / 3;

/**
 * 서버가 받아 줘야 하는 본문 한도(바이트). 여유 8MB 를 얹는다.
 *
 * ★ 지금은 **NAS 의 64MB 안**에 들어온다 (45MB → 60MB + 8MB = 68MB… 가 아니라,
 *   실제로 흐르는 본문은 60MB 다. 이 값은 「서버가 최소 이만큼은 받아야 한다」는
 *   요구치이지 흐르는 크기가 아니다). 서버를 새로 세울 때 이 값을 쓴다.
 */
const MIN_BODY_BYTES = Math.ceil(MAX_REQUEST_BYTES * BASE64_OVERHEAD) + 8 * 1024 * 1024;

/**
 * @param {object} deps { agentRoot } — im-agent 저장소 경로 (IM_AGENT_ROOT 와 같은 값)
 */
function createHandlers({ agentRoot, agentModulePath }) {
  // im-agent 모듈을 지연 로드한다 — 본체 부팅을 이 모듈이 막지 않도록
  const base = agentModulePath || path.join(__dirname, '..');
  const load = (rel) => {
    if (agentRoot) process.env.IM_AGENT_ROOT = agentRoot;
    return require(path.join(base, rel));
  };

  return {
    /**
     * GET /projects — 프로젝트 선택용 목록.
     *
     * ★ 딜 내용은 내보내지 않는다. 화면에서 고르는 데 필요한 최소 항목만 담는다.
     *   금액·IRR·검증 결과는 control-tower 로 따로 받는다.
     */
    async projects() {
      const store = load('core/store');
      /* ★★ **접어 둔 것을 빼지 않고 표시만 한다** 〈2026-08-24〉.
       *   여기서 빼 버리면 화면이 「몇 개를 접었는지」도, 「되돌리기」도 못 한다.
       *   무엇을 보여 줄지는 화면이 정한다 — 서버는 사실만 준다. */
      const hidden = load('core/hidden');
      const folded = hidden.map();
      const rows = store.listProjects().map(p => ({
        id: p.id,
        name: (p.project && p.project.name) || null,
        assetType: (p.project && p.project.assetType) || null,
        status: (p.project && p.project.status) || null,
        // ★ 앱의 딜 키를 함께 낸다 — 앱이 자기 목록과 맞춰 볼 수 있어야 한다.
        //   이름으로 맞추면 이름을 바꾸는 날 끊긴다 (프로젝트-연결-규칙 §3)
        externalId: (p.project && p.project.externalId) || null,
        // ★ 접혀 있는가. **지운 것이 아니다** — 폴더도 자료도 그대로 있다
        hidden: Object.prototype.hasOwnProperty.call(folded, p.id),
        hiddenAt: folded[p.id] || null,
      }));
      return {
        status: 200,
        body: { projects: rows, hiddenCount: rows.filter(r => r.hidden).length },
      };
    },

    /**
     * GET /fields — 데이터 사전(가이드 필드 정의).
     *
     * ★ 화면이 필드 목록을 **복사해 두지 않게** 하려고 있는 엔드포인트다.
     *   사전(core/dictionary.js)이 단일 출처이고, 항목이 추가·삭제되면
     *   화면이 즉시 따라온다. 복사본을 두면 사전이 바뀐 날부터 조용히 갈린다.
     *
     * 계산 항목(returns.* 등)은 입력 대상이 아니므로 key 만 내보낸다 —
     * 화면이 입력란을 만들지 않도록.
     */
    async fields() {
      const dict = load('core/dictionary');
      const tpl = load('finance/templates');

      // 산업분야별로 어떤 항목을 쓰는지 — 목록을 새로 적지 않고
      // finance/templates.js 의 정의에서 조합해 내린다 (industryKeys)
      const industries = Object.keys(tpl.TEMPLATES).map((id) => {
        const k = tpl.industryKeys(id);
        return { id, label: tpl.TEMPLATES[id].label, own: k.own, foreign: k.foreign };
      });

      // 채움 계획 — 어떤 항목을 사람이 안 쳐도 되는가.
      // ★ 산업 밖에 둔다. 네 템플릿이 같은 COMMON_MAP·defaults 집합을 쓰므로
      //   경로가 산업마다 다르지 않고, 산업을 고르기 전에도 입력란을 줄일 수 있다.
      //   (fieldplan.test.js 가 '템플릿마다 다르지 않다'를 검사한다 —
      //    달라지는 날 이 구조를 바꿔야 한다)
      const fieldplan = load('core/fieldplan');

      // 자산군 12종 — **재무 템플릿(4종)과 다른 축이다.** 호텔과 오피스빌딩은
      // 같은 재무 템플릿을 쓰지만 IM 에 실려야 할 값이 전혀 다르다.
      // 목록을 화면에 복사해 두지 않는다 (core/assetclass.js 가 단일 출처)
      const ac = load('core/assetclass');
      const commonKeys = Object.values(tpl.COMMON_MAP);
      const assetClasses = ac.CLASSES.map((c) => {
        const k = ac.classKeys(c.id, dict.FIELDS, commonKeys);
        return {
          id: c.id, label: c.label, en: c.en, template: c.template,
          // 왜 묻는지까지 함께 내린다. 이유 없이 늘어난 입력란은 대충 채워지고,
          // 대충 채운 값이 그대로 IM 에 실린다
          requires: c.requires.map(r => ({
            key: r.key, label: (dict.FIELDS[r.key] || {}).label || r.key, why: r.why,
          })),
          own: k.own, foreign: k.foreign,
        };
      });

      return {
        status: 200,
        body: {
          fields: dict.FIELDS,
          computedKeys: dict.COMPUTED_KEYS,
          assetClasses,
          // 계산 항목의 표시 이름(한글·영문). 화면이 raw key 를 그대로 보여 주면
          // `returns.min_dscr` 같은 글자가 사용자에게 나간다. 화면에 이름을
          // 적어 두지 않고 여기서 받아 간다 — 적어 두면 사전이 바뀐 날 갈린다
          computedFields: dict.COMPUTED_FIELDS,
          categories: dict.CATEGORY,
          industries,
          plan: fieldplan.plan('generic'),
          planSummary: fieldplan.summary('generic'),
          // 키가 없으면 공공데이터 경로가 통째로 죽고 그 항목들이 직접 입력으로
          // 내려온다. 화면이 '왜 물어보는 게 늘었는지'를 말할 수 있게 함께 내린다
          publicData: fieldplan.publicDataAvailable(),
        },
      };
    },

    /**
     * GET /intake — 접수 화면이 필요한 것 (자산유형·지원 형식·용량 한도).
     *
     * ★ 지원 형식을 화면에 복사해 두지 않으려고 있는 엔드포인트다.
     *   추출기(02-extraction)가 아는 목록이 그대로 내려간다. 복사해 두면
     *   되는 줄 알고 올렸다가 추출 단계에서야 안 된다는 걸 알게 된다.
     */
    async intake() {
      const { TEMPLATES } = load('finance/templates');
      const ac = load('core/assetclass');
      const ext = load('agents/02-extraction');
      const issuer = load('core/issuer');
      const list = (s) => [...s].sort();

      // 발행 주체 — 지금 설정된 값을 그대로 준다. 화면은 이걸 채워 놓고
      // 고칠 수 있게 한다. 미설정이면 unset:true 가 붙어 경고를 띄운다
      let current;
      let issuerError = null;
      try {
        current = issuer.resolve();
      } catch (e) {
        // 설정 파일이 깨졌다. 조용히 미설정으로 넘기지 않는다
        current = Object.assign({}, issuer.UNSET);
        issuerError = e.message;
      }
      /**
       * ★★ **전에 쓴 발행 주체 목록** 〈2026-08-23 사장님 지시: 「저장된 회사를
       *   선택할수 있도록 · 자동 저장된 기업은 선택시 자동 노출」〉.
       *
       *   `listForClient()` 는 로고를 **총량 한도 안에서만** 싣는다 —
       *   `/intake` 는 화면이 열릴 때마다 부르는 길이라, 로고 8건을 그대로
       *   실으면 화면이 늦게 뜬다. 뺀 항목에는 `logoOmitted:true` 가 붙고
       *   화면이 그 사실을 적는다 (조용히 빼면 지워진 줄 안다).
       */
      let issuers = [];
      try { issuers = issuer.listForClient(); } catch (_) { issuers = []; }

      return {
        status: 200,
        body: {
          // ★ 접수 화면이 고르는 것은 **자산군 12종**이다 (재무 템플릿 4종이 아니다).
          //   재무 템플릿은 자산군이 정한다 — 사람이 둘을 따로 고르면 어긋난다
          assetTypes: ac.CLASSES.map(c => ({
            id: c.id, label: c.label, en: c.en, template: c.template,
            requires: c.requires.map(r => r.key),
          })),
          financeTemplates: Object.keys(TEMPLATES).map(id => ({ id, label: TEMPLATES[id].label })),
          issuer: current,
          issuers,
          issuerError,
          issuerLimits: issuer.LIMITS,
          supported: {
            text: list(ext.TEXT_EXT),
            office: Object.keys(ext.ZIP_EXT).sort(),
          },
          unsupported: list(ext.UNSUPPORTED_EXT),
          // 읽는 방법별 묶음 — 화면이 확장자를 나열하지 않게 서버가 만들어 내린다
          formats: ext.readGroups(),
          // 스캔·사진을 글자로 옮기려면 키가 있어야 한다. 없으면 화면이
          // "지금은 꺼져 있습니다"라고 적어야 한다 — 올리고 나서 알면 늦다
          ocrReady: !load('core/llm').isOffline(),
          maxBytesPerFile: MAX_FILE_BYTES,
          maxBytesPerRequest: MAX_REQUEST_BYTES,
        },
      };
    },

    /** GET /projects/:id/control-tower */
    async controlTower(projectId) {
      if (!PROJECT_ID.test(String(projectId))) {
        return { status: 400, body: { error: '잘못된 프로젝트 ID 형식' } };
      }
      const monitor = load('core/monitor');
      const snap = monitor.snapshot(projectId);
      if (!snap.agents.length) {
        return { status: 404, body: { error: '실행 기록이 없는 프로젝트' } };
      }
      return { status: 200, body: snap };
    },

    /** GET /projects/:id/lineage/:key */
    async lineage(projectId, key) {
      if (!PROJECT_ID.test(String(projectId))) return { status: 400, body: { error: '잘못된 프로젝트 ID 형식' } };
      if (!DICT_KEY.test(String(key))) return { status: 400, body: { error: '잘못된 데이터 key 형식' } };
      const lineage = load('core/lineage');
      return { status: 200, body: lineage.trace(projectId, key) };
    },

    /** GET /projects/:id/impact/:key */
    async impact(projectId, key) {
      if (!PROJECT_ID.test(String(projectId))) return { status: 400, body: { error: '잘못된 프로젝트 ID 형식' } };
      if (!DICT_KEY.test(String(key))) return { status: 400, body: { error: '잘못된 데이터 key 형식' } };
      const lineage = load('core/lineage');
      return { status: 200, body: lineage.impact(projectId, key) };
    },
  };
}

/**
 * Express 라우터. express 가 없으면 createHandlers 를 직접 쓴다.
 *
 *   const { createRouter } = require('./im-agent/ui/api-router');
 *   app.use('/api/linkpilot', createRouter({ agentRoot: '/volume1/linkpilot/im-projects' }));
 */
/**
 * 읽기 라우트 — **표가 단일 출처다** (`ui/routes.cjs` 참조).
 * NAS 서버가 이 배열을 그대로 걸 수 있어야 한다. 손으로 옮기면 갈린다.
 */
const ROUTES = [
  { method: 'GET', path: '/intake', handler: 'intake', call: h => h.intake() },
  { method: 'GET', path: '/fields', handler: 'fields', call: h => h.fields() },
  { method: 'GET', path: '/projects', handler: 'projects', call: h => h.projects() },
  { method: 'GET', path: '/projects/:id/control-tower', handler: 'controlTower', call: (h, req, p) => h.controlTower(p.id) },
  { method: 'GET', path: '/projects/:id/lineage/:key', handler: 'lineage', call: (h, req, p) => h.lineage(p.id, p.key) },
  { method: 'GET', path: '/projects/:id/impact/:key', handler: 'impact', call: (h, req, p) => h.impact(p.id, p.key) },
];

function createRouter(deps = {}) {
  let express;
  try {
    express = require('express');
  } catch (_) {
    throw new Error('express 를 찾을 수 없다 — createHandlers() 를 직접 사용하라');
  }
  // ★ 등록을 여기서 다시 적지 않는다 — 표를 건다 (routes.cjs)
  return routes.mount(express.Router(), ROUTES, createHandlers(deps));
}

module.exports = {
  createHandlers, createRouter, ROUTES, PROJECT_ID, DICT_KEY,
  MAX_FILE_BYTES, MAX_REQUEST_BYTES, BASE64_OVERHEAD, MIN_BODY_BYTES,
};
