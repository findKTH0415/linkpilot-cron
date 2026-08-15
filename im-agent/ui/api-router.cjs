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

const PROJECT_ID = /^LP-[A-Z]+-\d{4}-\d{3}$/;
const DICT_KEY = /^[a-z_]+\.[a-z_]+$/;

/**
 * 업로드 한도. 화면과 서버가 같은 값을 봐야 하므로 여기서 한 번만 정한다.
 * base64 는 원본보다 약 33% 크므로 본문 크기는 이보다 더 잡아야 한다.
 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BYTES = 60 * 1024 * 1024;

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
      const rows = store.listProjects().map(p => ({
        id: p.id,
        name: (p.project && p.project.name) || null,
        assetType: (p.project && p.project.assetType) || null,
        status: (p.project && p.project.status) || null,
      }));
      return { status: 200, body: { projects: rows } };
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
      return {
        status: 200,
        body: {
          fields: dict.FIELDS,
          computedKeys: dict.COMPUTED_KEYS,
          categories: dict.CATEGORY,
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
      const ext = load('agents/02-extraction');
      const list = (s) => [...s].sort();
      return {
        status: 200,
        body: {
          assetTypes: Object.keys(TEMPLATES).map(id => ({ id, label: TEMPLATES[id].label })),
          supported: {
            text: list(ext.TEXT_EXT),
            office: Object.keys(ext.ZIP_EXT).sort(),
          },
          unsupported: list(ext.UNSUPPORTED_EXT),
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
function createRouter(deps = {}) {
  let express;
  try {
    express = require('express');
  } catch (_) {
    throw new Error('express 를 찾을 수 없다 — createHandlers() 를 직접 사용하라');
  }

  const h = createHandlers(deps);
  const router = express.Router();
  const send = (res, r) => res.status(r.status).json(r.body);

  router.get('/intake', async (req, res, next) => {
    try { send(res, await h.intake()); } catch (e) { next(e); }
  });
  router.get('/fields', async (req, res, next) => {
    try { send(res, await h.fields()); } catch (e) { next(e); }
  });
  router.get('/projects', async (req, res, next) => {
    try { send(res, await h.projects()); } catch (e) { next(e); }
  });
  router.get('/projects/:id/control-tower', async (req, res, next) => {
    try { send(res, await h.controlTower(req.params.id)); } catch (e) { next(e); }
  });
  router.get('/projects/:id/lineage/:key', async (req, res, next) => {
    try { send(res, await h.lineage(req.params.id, req.params.key)); } catch (e) { next(e); }
  });
  router.get('/projects/:id/impact/:key', async (req, res, next) => {
    try { send(res, await h.impact(req.params.id, req.params.key)); } catch (e) { next(e); }
  });

  return router;
}

module.exports = {
  createHandlers, createRouter, PROJECT_ID, DICT_KEY,
  MAX_FILE_BYTES, MAX_REQUEST_BYTES,
};
