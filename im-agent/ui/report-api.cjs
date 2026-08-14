'use strict';
/**
 * report-api.cjs — 보고서 생성 화면이 쓰는 API. **쓰기가 있다.**
 *
 * api-router.cjs 와 왜 분리했는가:
 *   그쪽은 대시보드용 읽기 전용이고, 테스트가 "쓰기 엔드포인트 없음"을 강제한다.
 *   생성은 파일을 쓰고, LLM 을 호출하고, 공공데이터 쿼터를 소모한다.
 *   같은 라우터에 얹으면 읽기와 같은 권한으로 돈 드는 동작이 열린다.
 *
 * ★★ 인증 없이는 아예 뜨지 않는다 (fail closed).
 *   authenticate 를 주지 않으면 생성 시점이 아니라 **마운트 시점에 예외**를 던진다.
 *   "나중에 붙이지" 하고 열어두면 그대로 배포된다.
 *
 * 엔드포인트
 *   GET  /projects/:id/spec            현재 출력 사양
 *   POST /projects/:id/spec            사양 저장 (제안 상태)
 *   POST /projects/:id/spec/confirm    사양 확정 — 사람만
 *   GET  /projects/:id/reports         산출물 목록 (파일 존재 여부로 판정)
 *   POST /projects/:id/reports         생성 시작
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ID = /^LP-[A-Z]+-\d{4}-\d{3}$/;
const PLAN_RANK = { free: 0, basic: 1, pro: 2, business: 3 };

/**
 * 보고서 종류별 요구 플랜. 화면(reports.html)의 minPlan 과 같아야 한다.
 *
 * ★ 전부 'pro' 인 이유 — 「외부 업무지침」 §2 가 '보고서 생성 (Pro)' 라고
 *   협력사에 배포되어 있다. 검증 보고서만 'business' 로 두면 Pro 회원이
 *   문서대로 눌렀는데 403 을 받는다. 문서를 먼저 고치지 않는 한 여기서
 *   등급을 올리지 않는다. (지침을 바꾸려면 catalog.js 의 '보고서 생성' 도 같이)
 */
const DOC_PLANS = { im: 'pro', teaser: 'pro', summary: 'pro', validation: 'pro' };

/** 산출물 경로 — 파일이 실제로 있는지로 판정한다 ('생성됨' 플래그를 믿지 않는다) */
const OUTPUTS = [
  { id: 'im', name: 'IM 원문', rel: '09_IM/im.md' },
  { id: 'a4', name: 'A4 인쇄본', rel: '12_Final/im-a4.html' },
  { id: 'content', name: '뷰어 데이터', rel: '12_Final/content.json' },
  { id: 'teaser', name: 'Teaser', rel: '10_Teaser/teaser.md' },
  { id: 'validation', name: '검증 보고서', rel: '11_QC/validation-report.md' },
  { id: 'redflag', name: 'RED FLAG 보고서', rel: '11_QC/red-flag-report.md' },
];

function ok(body) { return { status: 200, body }; }
function bad(message, status) { return { status: status || 400, body: { error: message } }; }

/**
 * @param {object} deps
 *   agentRoot        im-projects 경로
 *   agentModulePath  im-agent 경로
 *   authenticate(ctx) → { name, planId, status } | null    **필수**
 *   startRun(projectId, spec, user) → { runId } | Promise   생성 실행기. 없으면 501
 */
function createHandlers(deps) {
  var d = deps || {};
  if (typeof d.authenticate !== 'function') {
    // ★ 여기서 던진다. 생성 시점이 아니라 마운트 시점이다.
    throw new Error('report-api: authenticate 가 없으면 마운트할 수 없다 — 인증 없이 생성 API 를 열 수 없다');
  }

  const base = d.agentModulePath || path.join(__dirname, '..');
  const load = (rel) => {
    if (d.agentRoot) process.env.IM_AGENT_ROOT = d.agentRoot;
    return require(path.join(base, rel));
  };
  const projectDir = (id) => path.join(d.agentRoot || process.env.IM_AGENT_ROOT || '', id);

  /** 인증 + 플랜. 실패 사유를 화면과 같은 어휘로 돌려준다 */
  function gate(ctx, requiredPlan) {
    const user = d.authenticate(ctx);
    if (!user) return { error: bad('로그인이 필요합니다', 401) };
    if (user.status === 'expired') return { error: bad('멤버십이 만료되었습니다', 403) };

    const have = PLAN_RANK[user.planId];
    // 모르는 플랜 코드·정보 없음을 통과시키지 않는다 (오타 하나로 열리면 안 된다)
    if (have === undefined) return { error: bad('멤버십 정보를 확인할 수 없습니다', 403) };

    const need = PLAN_RANK[requiredPlan];
    if (need !== undefined && have < need) {
      return { error: bad(`${requiredPlan} 플랜부터 사용할 수 있습니다`, 403) };
    }
    return { user };
  }

  function checkId(projectId) {
    return PROJECT_ID.test(String(projectId)) ? null : bad('잘못된 프로젝트 ID 형식');
  }

  return {
    /** GET /projects/:id/spec */
    async getSpec(ctx, projectId) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const outputspec = load('core/outputspec');
      return ok({ spec: outputspec.read(projectId), supportedFormats: outputspec.SUPPORTED_FORMATS });
    },

    /** POST /projects/:id/spec — 제안 상태로 저장한다. 확정은 별도다 */
    async saveSpec(ctx, projectId, body) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;

      const b = body || {};
      const docType = String(b.docType || 'im');
      // 종류별 플랜을 여기서도 본다. 화면만 믿지 않는다
      const dg = gate(ctx, DOC_PLANS[docType] || 'pro'); if (dg.error) return dg.error;

      const outputspec = load('core/outputspec');
      const overrides = {};
      if (b.targetPages !== undefined) overrides.targetPages = Number(b.targetPages);
      if (b.pageSize) overrides.pageSize = String(b.pageSize);
      if (b.language) overrides.language = String(b.language);
      if (Array.isArray(b.formats)) overrides.formats = b.formats.map(f => String(f).toLowerCase());

      // 만들 수 없는 형식은 저장 단계에서 거른다. 사양에 넣어도 안 만들어진다
      const unsupported = (overrides.formats || []).filter(
        f => outputspec.SUPPORTED_FORMATS[f] && !outputspec.SUPPORTED_FORMATS[f].supported);
      if (unsupported.length) {
        return bad(unsupported.map(f =>
          `${f.toUpperCase()} 생성 불가 — ${outputspec.SUPPORTED_FORMATS[f].via}`).join(' / '));
      }
      const unknown = (overrides.formats || []).filter(f => !outputspec.SUPPORTED_FORMATS[f]);
      if (unknown.length) return bad(`알 수 없는 형식: ${unknown.join(', ')}`);

      try {
        // propose() 는 만들기만 하고 저장하지 않는다. save() 를 빼면 확정·생성이
        // "사양이 없습니다"로 떨어진다 — 화면에서는 저장된 것처럼 보이고.
        const spec = outputspec.save(projectId,
          outputspec.propose(projectId, { docType, themeId: b.themeId || null, overrides }));
        return ok({ spec, check: outputspec.validateSpec(spec) });
      } catch (err) {
        return bad(err.message);
      }
    },

    /**
     * POST /projects/:id/spec/confirm — 확정은 사람만.
     * ★ 서비스 계정 이름으로 확정할 수 없다. outputspec.confirm 이 AI 이름을 거부하므로
     *   인증된 사람의 이름을 그대로 넘긴다.
     */
    async confirmSpec(ctx, projectId, body) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;

      const by = (g.user && g.user.name) || '';
      if (!by) return bad('확정자 이름을 확인할 수 없습니다', 403);

      const outputspec = load('core/outputspec');
      try {
        return ok({ spec: outputspec.confirm(projectId, { by, notes: (body && body.notes) || '' }) });
      } catch (err) {
        return bad(err.message, 409);
      }
    },

    /**
     * GET /projects/:id/facts — 가이드 필드에 지금 들어 있는 값.
     *
     * 출처를 고를 수 있게 **업로드된 자료 목록도 함께** 준다.
     * 출처를 자유 입력으로만 두면 "사업계획서"처럼 어느 파일인지 알 수 없는
     * 문자열이 쌓이고, 나중에 그 값을 추적할 수 없다.
     */
    async getFacts(ctx, projectId) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;

      const store = load('core/store');
      const { Dataset } = load('core/facts');
      const { FIELDS } = load('core/dictionary');

      const json = store.readJson(projectId, '01_Project/dataset.json', null);
      const ds = json ? Dataset.fromJSON(json, FIELDS) : null;

      const values = {};
      if (ds) {
        ds.keys().forEach((key) => {
          const f = ds.get(key);
          if (!f) return;
          values[key] = {
            value: f.value, source: f.source, sourceDate: f.sourceDate,
            page: f.page, confidence: f.confidence, verified: f.verified,
          };
        });
      }

      let sources = [];
      try {
        sources = store.listSourceFiles(projectId).map(s => (typeof s === 'string' ? s : s.name)).filter(Boolean);
      } catch (_) {
        sources = [];   // 자료 폴더가 없을 수 있다. 빈 목록과 오류를 구분할 필요는 없다
      }

      return ok({ values, sources, hasDataset: !!ds });
    },

    /**
     * PUT /projects/:id/facts — 사람이 입력한 값을 저장한다.
     *
     * ★ 여기서 지키는 것 세 가지:
     *   ① 출처 없는 값은 저장하지 않는다 (facts.js 도 던지지만, 여기서 사유를 만들어 준다)
     *   ② 계산 항목(returns.* 등)은 받지 않는다 — 사람이 IRR 을 적어 넣으면 그 순간
     *      "숫자는 LLM 도 사람도 만들지 않는다"는 전제가 깨진다
     *   ③ 생성이 도는 중에는 받지 않는다 — 파이프라인이 읽는 도중에 바뀌면
     *      산출물과 데이터가 어긋난다
     *
     * 범위를 벗어난 값은 **막지 않고 경고만 돌려준다.** 여기서 막으면
     * 05 Validation 이 RED FLAG 로 잡아야 할 이상값이 화면에서 사라진다.
     */
    async saveFacts(ctx, projectId, body) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;

      const entries = (body && Array.isArray(body.facts)) ? body.facts : null;
      if (!entries) return bad('facts 배열이 필요합니다');
      if (!entries.length) return bad('저장할 값이 없습니다');

      // ③ 생성 중이면 건드리지 않는다
      if (typeof d.runningFor === 'function') {
        const running = d.runningFor(projectId);
        if (running) return bad(`생성이 진행 중입니다 (실행 ${running.runId || '?'}) — 끝난 뒤 수정하세요`, 409);
      }

      const store = load('core/store');
      const { Dataset } = load('core/facts');
      const dict = load('core/dictionary');

      const rejected = [];
      const warnings = [];
      const clean = [];

      entries.forEach((raw) => {
        const key = String((raw && raw.key) || '');
        // 계산 항목을 먼저 본다. 계산 항목은 FIELDS 에 없으므로 순서를 바꾸면
        // "사전에 없는 항목"이라는 엉뚱한 사유가 나가고, 왜 거부됐는지 알 수 없다
        if (dict.COMPUTED_KEYS.indexOf(key) !== -1) {
          rejected.push({ key, reason: '계산으로 만들어지는 항목이라 입력할 수 없습니다' });
          return;
        }
        const def = dict.FIELDS[key];
        if (!def) {
          rejected.push({ key, reason: '사전에 없는 항목' });
          return;
        }
        if (raw.value === '' || raw.value === null || raw.value === undefined) {
          rejected.push({ key, reason: '값이 비어 있습니다' });
          return;
        }
        const source = String(raw.source || '').trim();
        if (!source) {
          rejected.push({ key, reason: '출처가 없습니다 — 출처 없는 값은 저장할 수 없습니다' });
          return;
        }

        let value = raw.value;
        if (def.type === 'number') {
          const n = Number(String(value).replace(/,/g, '').trim());
          if (!Number.isFinite(n)) {
            rejected.push({ key, reason: `숫자가 아닙니다 (${raw.value})` });
            return;
          }
          value = n;
          const v = dict.rangeViolation(key, n);
          if (v) warnings.push(v);   // 저장은 한다
        }

        clean.push({
          key, value, source,
          // 단위는 사전에서 가져온다. 사용자가 고를 수 있게 두면 억원/원이 섞인다
          unit: def.unit || null,
          sourceDate: raw.sourceDate || null,
          page: (raw.page === '' || raw.page === undefined) ? null : raw.page,
          confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.9,
          verified: false,           // 사람이 적었다고 검증된 것이 아니다
        });
      });

      if (!clean.length) return { status: 400, body: { error: '저장할 수 있는 값이 없습니다', rejected } };

      const json = store.readJson(projectId, '01_Project/dataset.json', null);
      const ds = json ? Dataset.fromJSON(json, dict.FIELDS) : new Dataset(projectId, dict.FIELDS);

      const failed = [];
      clean.forEach((f) => {
        try { ds.add(f); } catch (err) { failed.push({ key: f.key, reason: err.message }); }
      });
      ds.resolve();
      store.writeJson(projectId, '01_Project/dataset.json', ds.toJSON());

      return ok({
        saved: clean.length - failed.length,
        rejected: rejected.concat(failed),
        warnings,
        at: kstStamp(new Date()),
      });
    },

    /** GET /projects/:id/reports — 파일 존재 여부로 판정한다 */
    async listReports(ctx, projectId) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;

      const dir = projectDir(projectId);
      const gateMod = load('core/gate');
      let blocked = null;
      try {
        const decision = gateMod.check ? gateMod.check(projectId) : null;
        blocked = decision && decision.blocked ? decision : null;
      } catch (_) { blocked = null; }

      const files = OUTPUTS.map(o => {
        const full = path.join(dir, o.rel);
        let stat = null;
        try { stat = fs.statSync(full); } catch (_) { stat = null; }
        return {
          id: o.id, name: o.name, path: o.rel,
          exists: !!stat,
          at: stat ? kstStamp(stat.mtime) : null,
          bytes: stat ? stat.size : 0,
        };
      }).filter(f => f.exists);

      return ok({
        files,
        // ★ 차단 상태를 목록과 함께 준다. 화면이 '완료'로만 보이면 안 된다
        distribution: blocked
          ? { blocked: true, reasons: blocked.reasons || [] }
          : { blocked: false, reasons: [] },
      });
    },

    /** POST /projects/:id/reports — 생성 시작 */
    async generate(ctx, projectId, body) {
      const b = body || {};
      const docType = String(b.docType || 'im');
      const g = gate(ctx, DOC_PLANS[docType] || 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;

      const outputspec = load('core/outputspec');
      const spec = outputspec.read(projectId);

      // ★ 사양이 확정되기 전에는 생성하지 않는다.
      //   화면에서 버튼을 막는 것과 별개로 여기서 한 번 더 막는다 —
      //   화면은 사용자가 고칠 수 있다.
      if (!spec) return bad('출력 사양이 없습니다 — 먼저 사양을 저장하고 확정하세요', 409);
      if (!spec.locked) return bad('출력 사양이 확정되지 않았습니다 — 확정 후 생성할 수 있습니다', 409);

      if (typeof d.startRun !== 'function') {
        // 없는 기능을 있는 척하지 않는다
        return { status: 501, body: { error: '생성 실행기가 연결되지 않았습니다 (startRun 미주입)' } };
      }
      try {
        const run = await d.startRun(projectId, spec, g.user);
        return { status: 202, body: { accepted: true, projectId, spec: { version: spec.version, docType: spec.docType }, run: run || null } };
      } catch (err) {
        // 이미 돌고 있는 것은 서버 오류가 아니다. 사용자가 기다리면 되는 상황이다
        if (err && err.conflict) return bad(err.message, 409);
        return bad(`생성 시작 실패: ${err.message}`, 500);
      }
    },
  };
}

/** 파일 시각도 KST 로 표기한다 (서버가 UTC 로 돌 수 있다) */
function kstStamp(date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

/**
 * Express 라우터.
 *   const { createRouter } = require('./im-agent/ui/report-api.cjs');
 *   app.use('/api/linkpilot', createRouter({
 *     agentRoot: '/volume1/linkpilot/im-projects',
 *     authenticate: (req) => req.session && req.session.user,   // 필수
 *     startRun: (id, spec, user) => queue.push({ id, spec, by: user.name }),
 *   }));
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
  const wrap = (fn) => async (req, res, next) => {
    try { send(res, await fn(req)); } catch (e) { next(e); }
  };

  router.get('/projects/:id/spec', wrap(req => h.getSpec(req, req.params.id)));
  router.post('/projects/:id/spec', wrap(req => h.saveSpec(req, req.params.id, req.body)));
  router.post('/projects/:id/spec/confirm', wrap(req => h.confirmSpec(req, req.params.id, req.body)));
  router.get('/projects/:id/facts', wrap(req => h.getFacts(req, req.params.id)));
  router.put('/projects/:id/facts', wrap(req => h.saveFacts(req, req.params.id, req.body)));
  router.get('/projects/:id/reports', wrap(req => h.listReports(req, req.params.id)));
  router.post('/projects/:id/reports', wrap(req => h.generate(req, req.params.id, req.body)));

  return router;
}

module.exports = { createHandlers, createRouter, DOC_PLANS, OUTPUTS, PLAN_RANK, PROJECT_ID };
