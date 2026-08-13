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

module.exports = { createHandlers, createRouter, PROJECT_ID, DICT_KEY };
