'use strict';
/**
 * board-api.cjs — 업무지시 보드 저장 API. 〈B-7〉
 *
 * 지금까지 보드는 화면에만 있었다. 카드를 옮겨도 새로고침하면 되돌아갔다 —
 * **일을 옮겼다고 믿은 채로 옮겨지지 않은 것**이 이 화면의 가장 나쁜 실패다.
 *
 * report-api.cjs 와 같은 규칙을 따른다:
 *   - `authenticate` 가 없으면 **마운트 시점에** 던진다 (fail closed)
 *   - 상태·우선순위는 화면(board-core.js)이 아는 값만 받는다
 *
 * ★ 마지막에 저장한 사람이 이기게 두지 않는다. 읽을 때 준 `rev` 를 다시 받아
 *   그 사이 바뀌었으면 409 로 막는다. 보드는 여럿이 같이 보는 화면이라,
 *   조용히 덮어쓰면 **남이 옮긴 카드가 이유 없이 되돌아간다.**
 *
 * ★ 완료일은 서버가 KST 로 찍는다. 브라우저 시계를 믿지 않는다 —
 *   시간대가 다른 곳에서 열면 완료일이 하루 어긋난다.
 */

const fs = require('fs');
const path = require('path');

const { PLAN_RANK } = require('./report-api.cjs');
const { kstDate } = require('../core/kst');

const FILE = 'board.json';
const STATUSES = ['todo', 'doing', 'review', 'done'];
const PRIORITIES = ['urgent', 'normal'];
const REQUIRED_PLAN = 'pro';   // 화면(board.html)의 requiredPlan 과 같아야 한다

const LIMITS = { title: 200, detail: 2000, name: 60, tasks: 500 };

function ok(body) { return { status: 200, body }; }
function bad(message, status, extra) {
  return { status: status || 400, body: Object.assign({ error: message }, extra || {}) };
}

function emptyBoard() {
  return { rev: 0, tasks: [], people: [], projects: [] };
}

/**
 * @param {object} deps
 *   agentRoot        보드 파일을 둘 경로
 *   authenticate(ctx) → { name, planId, status } | null   **필수**
 */
function createHandlers(deps) {
  const d = deps || {};
  if (typeof d.authenticate !== 'function') {
    throw new Error('board-api: authenticate 가 없으면 마운트할 수 없다 — 인증 없이 보드를 열 수 없다');
  }

  const file = () => path.join(d.agentRoot || process.env.IM_AGENT_ROOT || '', FILE);

  function gate(ctx) {
    const user = d.authenticate(ctx);
    if (!user) return { error: bad('로그인이 필요합니다', 401) };
    if (user.status === 'expired') return { error: bad('멤버십이 만료되었습니다', 403) };
    const have = PLAN_RANK[user.planId];
    if (have === undefined) return { error: bad('멤버십 정보를 확인할 수 없습니다', 403) };
    if (have < PLAN_RANK[REQUIRED_PLAN]) {
      return { error: bad(`${REQUIRED_PLAN} 플랜부터 사용할 수 있습니다`, 403) };
    }
    return { user };
  }

  /** 읽기. 파일이 깨졌으면 **빈 보드로 덮지 않는다** — 일이 통째로 사라진다 */
  function read() {
    try {
      const raw = fs.readFileSync(file(), 'utf8');
      const j = JSON.parse(raw);
      return {
        ok: true,
        board: {
          rev: Number(j.rev) || 0,
          tasks: Array.isArray(j.tasks) ? j.tasks : [],
          people: Array.isArray(j.people) ? j.people : [],
          projects: Array.isArray(j.projects) ? j.projects : [],
        },
      };
    } catch (e) {
      if (e.code === 'ENOENT') return { ok: true, board: emptyBoard() };
      return { ok: false, error: `보드 파일을 읽을 수 없습니다 (${e.message}) — 덮어쓰지 않았습니다` };
    }
  }

  function write(board) {
    board.rev = (Number(board.rev) || 0) + 1;
    board.updatedAt = kstDate();
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    // 임시 파일에 쓰고 바꿔치운다 — 쓰는 도중에 죽으면 반쯤 쓰인 보드가 남는다
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(board, null, 2), 'utf8');
    fs.renameSync(tmp, file());
    return board;
  }

  function text(v, max, label) {
    const s = String(v === null || v === undefined ? '' : v).trim();
    if (s.length > max) return { error: `${label}이(가) 너무 깁니다 (${max}자 이내)` };
    return { value: s };
  }

  /** 기한 — 없으면 없는 대로 둔다. 지어내지 않는다 */
  function due(v) {
    if (v === null || v === undefined || v === '') return { value: null };
    const s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: '기한은 YYYY-MM-DD 형식입니다' };
    return { value: s };
  }

  return {
    /** GET /board */
    async get(ctx) {
      const g = gate(ctx); if (g.error) return g.error;
      const r = read();
      if (!r.ok) return bad(r.error, 500);
      return ok(r.board);
    },

    /** POST /board/tasks — 지시 등록 */
    async create(ctx, body) {
      const g = gate(ctx); if (g.error) return g.error;
      const b = body || {};

      const title = text(b.title, LIMITS.title, '지시 내용');
      if (title.error) return bad(title.error);
      if (!title.value) return bad('지시 내용을 입력하세요');

      const assignee = text(b.assignee, LIMITS.name, '담당자');
      if (assignee.error) return bad(assignee.error);
      if (!assignee.value) return bad('담당자를 지정하세요');

      const detail = text(b.detail, LIMITS.detail, '설명');
      if (detail.error) return bad(detail.error);
      const project = text(b.project, LIMITS.name, '분류');
      if (project.error) return bad(project.error);
      const dueAt = due(b.due);
      if (dueAt.error) return bad(dueAt.error);

      const r = read();
      if (!r.ok) return bad(r.error, 500);
      const board = r.board;
      if (board.tasks.length >= LIMITS.tasks) {
        return bad(`지시는 ${LIMITS.tasks}건까지 담을 수 있습니다 — 완료된 지시를 정리하세요`, 409);
      }

      const task = {
        // 화면이 만든 id 를 믿지 않는다 (중복되면 카드 하나가 남의 상태를 따라간다)
        id: nextId(board.tasks),
        title: title.value,
        detail: detail.value,
        status: 'todo',
        priority: PRIORITIES.indexOf(b.priority) === -1 ? 'normal' : b.priority,
        due: dueAt.value,
        assignee: assignee.value,
        project: project.value || null,
        createdAt: kstDate(),
        createdBy: g.user.name || null,
      };
      board.tasks.push(task);
      if (task.assignee && board.people.indexOf(task.assignee) === -1) board.people.push(task.assignee);
      if (task.project && board.projects.indexOf(task.project) === -1) board.projects.push(task.project);

      write(board);
      return { status: 201, body: { task, rev: board.rev } };
    },

    /**
     * PATCH /board/tasks/:id — 카드 이동·수정.
     *
     * ★ `rev` 를 함께 받는다. 그 사이 남이 바꿨으면 409 와 **현재 보드**를 돌려준다.
     *   화면이 되돌릴 수 있어야 "옮겼다고 믿었는데 안 옮겨진" 상태가 안 생긴다.
     */
    async update(ctx, taskId, body) {
      const g = gate(ctx); if (g.error) return g.error;
      const b = body || {};

      const r = read();
      if (!r.ok) return bad(r.error, 500);
      const board = r.board;

      if (b.rev !== undefined && Number(b.rev) !== board.rev) {
        return bad('다른 사람이 먼저 보드를 바꿨습니다 — 최신 상태를 확인하세요', 409, { board });
      }

      const task = board.tasks.filter(t => String(t.id) === String(taskId))[0];
      if (!task) return bad('지시를 찾을 수 없습니다', 404);

      if (b.status !== undefined) {
        if (STATUSES.indexOf(b.status) === -1) return bad(`모르는 상태입니다: ${b.status}`);
        task.status = b.status;
        // ★ 완료일은 서버가 KST 로 찍는다. 브라우저 시계를 믿지 않는다
        if (b.status === 'done') task.doneAt = kstDate();
        else delete task.doneAt;
      }
      if (b.priority !== undefined) {
        if (PRIORITIES.indexOf(b.priority) === -1) return bad(`모르는 우선순위입니다: ${b.priority}`);
        task.priority = b.priority;
      }
      if (b.title !== undefined) {
        const t = text(b.title, LIMITS.title, '지시 내용');
        if (t.error) return bad(t.error);
        if (!t.value) return bad('지시 내용을 비울 수 없습니다');
        task.title = t.value;
      }
      if (b.detail !== undefined) {
        const t = text(b.detail, LIMITS.detail, '설명');
        if (t.error) return bad(t.error);
        task.detail = t.value;
      }
      if (b.assignee !== undefined) {
        const t = text(b.assignee, LIMITS.name, '담당자');
        if (t.error) return bad(t.error);
        if (!t.value) return bad('담당자를 비울 수 없습니다');
        task.assignee = t.value;
        if (board.people.indexOf(t.value) === -1) board.people.push(t.value);
      }
      if (b.due !== undefined) {
        const dd = due(b.due);
        if (dd.error) return bad(dd.error);
        task.due = dd.value;
      }

      task.updatedAt = kstDate();
      task.updatedBy = g.user.name || null;
      write(board);
      return ok({ task, rev: board.rev });
    },

    /**
     * DELETE /board/tasks/:id — 지시 삭제.
     * ★ 실제로 지운다. 되돌릴 수 없으므로 화면이 먼저 물어야 한다.
     */
    async remove(ctx, taskId, body) {
      const g = gate(ctx); if (g.error) return g.error;
      const r = read();
      if (!r.ok) return bad(r.error, 500);
      const board = r.board;

      const b = body || {};
      if (b.rev !== undefined && Number(b.rev) !== board.rev) {
        return bad('다른 사람이 먼저 보드를 바꿨습니다 — 최신 상태를 확인하세요', 409, { board });
      }

      const before = board.tasks.length;
      board.tasks = board.tasks.filter(t => String(t.id) !== String(taskId));
      if (board.tasks.length === before) return bad('지시를 찾을 수 없습니다', 404);

      write(board);
      return ok({ removed: String(taskId), rev: board.rev });
    },
  };
}

/** 새 id — 기존과 겹치지 않게 만든다 */
function nextId(tasks) {
  let max = 0;
  (tasks || []).forEach((t) => {
    const m = String(t.id || '').match(/^T(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return `T${max + 1}`;
}

function createRouter(deps = {}) {
  let express;
  try { express = require('express'); } catch (_) {
    throw new Error('express 를 찾을 수 없다 — createHandlers() 를 직접 사용하라');
  }
  const h = createHandlers(deps);
  const router = express.Router();
  const send = (res, r) => res.status(r.status).json(r.body);
  const wrap = fn => async (req, res, next) => {
    try { send(res, await fn(req)); } catch (e) { next(e); }
  };

  router.get('/board', wrap(req => h.get(req)));
  router.post('/board/tasks', wrap(req => h.create(req, req.body)));
  router.patch('/board/tasks/:id', wrap(req => h.update(req, req.params.id, req.body)));
  router.delete('/board/tasks/:id', wrap(req => h.remove(req, req.params.id, req.body)));
  return router;
}

module.exports = { createHandlers, createRouter, FILE, STATUSES, PRIORITIES, REQUIRED_PLAN, LIMITS, nextId };
