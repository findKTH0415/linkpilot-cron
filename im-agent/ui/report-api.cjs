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

/** 화면에서 사람이 넣은 값의 표시. 다시 저장할 때 이전 입력을 찾아 지우는 데 쓴다 */
const USER_NOTE = 'user_input';

// 업로드 한도는 읽기 라우터와 한 값을 쓴다 (화면이 GET /intake 로 같은 값을 받는다)
const { MAX_FILE_BYTES, MAX_REQUEST_BYTES } = require('./api-router.cjs');
const issuerMod = require('../core/issuer');
const mb = (n) => Math.round(n / (1024 * 1024) * 10) / 10;

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
    /**
     * POST /projects — 요청문으로 프로젝트를 만든다 (보고서 생성 1단계).
     *
     * ★ 여기서 **파이프라인 전체를 돌리지 않는다.** 01_project 하나만 부른다.
     *   자료가 아직 없는데 추출·시장조사·재무모델을 돌리면 빈 값으로 산출물이
     *   만들어지고 LLM 비용도 그냥 나간다.
     *
     * ★ 요청문에서 뽑은 값은 `source: 'user_request'` · `verified: false` 다.
     *   사용자가 말했다는 것은 문서로 확인됐다는 뜻이 아니다 — 화면도 그렇게 표시한다.
     */
    async createProject(ctx, body) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;

      const b = body || {};
      const request = String(b.request || '').trim();
      if (request.length < 5) {
        return bad('무엇을 만들지 한 줄로 적어 주세요 (예: 인천 남동공단 6.5MW 데이터센터 IM 작성)');
      }
      if (request.length > 2000) return bad('요청문이 너무 깁니다 (2,000자 이내)');

      const { runAgent, STATUS } = load('core/runtime');
      const { Dataset } = load('core/facts');
      const { FIELDS } = load('core/dictionary');
      const store = load('core/store');

      const r = await runAgent('01_project', {
        request,
        projectName: b.projectName ? String(b.projectName).slice(0, 200) : undefined,
        assetType: b.assetType ? String(b.assetType) : undefined,
      }, { log: () => {} });

      if (r.status === STATUS.ERROR) return bad(`프로젝트 생성 실패: ${r.error}`, 500);

      const out = r.output;

      // ★ 발행 주체 — 접수 화면에서 받은 값을 프로젝트에 저장한다.
      //   없으면 저장하지 않는다. 저장소 기본값이 있으면 그것이 쓰이고,
      //   그것도 없으면 문서에 '미설정'이 찍히고 승인 게이트가 배포를 막는다.
      let issuerSaved = null;
      if (b.issuer) {
        const norm = issuerMod.normalize(b.issuer);
        if (!norm.ok) return bad(norm.error);
        store.writeJson(out.projectId, '01_Project/issuer.json', norm.value);
        issuerSaved = norm.value;
        // 앞으로 만드는 프로젝트에도 쓰겠다고 하면 저장소 기본값으로 남긴다
        if (b.issuerAsDefault) {
          const rootDir = d.agentRoot || process.env.IM_AGENT_ROOT;
          if (rootDir) fs.writeFileSync(path.join(rootDir, issuerMod.FILE), JSON.stringify(norm.value, null, 2));
        }
      }

      const ds = new Dataset(out.projectId, FIELDS);
      ds.addMany(out.facts || []);
      ds.resolve();
      store.writeJson(out.projectId, '01_Project/dataset.json', ds.toJSON());

      return {
        status: 201,
        body: {
          projectId: out.projectId,
          templateId: out.templateId,
          name: out.name,
          // 뽑힌 값을 그대로 돌려준다. 무엇을 넘겨짚었는지 사람이 봐야 한다
          seeded: (out.facts || []).map(f => ({
            key: f.key, value: f.value, unit: f.unit || null,
            quote: f.quote || null, source: f.source, verified: false,
          })),
          // 무엇이 발행 주체로 쓰이는지 돌려준다. 화면이 '미설정'을 띄울 수 있어야 한다
          issuer: issuerMod.resolve(out.projectId),
          issuerSaved: !!issuerSaved,
          at: kstStamp(new Date()),
        },
      };
    },

    /**
     * POST /projects/:id/sources — 원본 자료를 올린다.
     *
     * ★ 파일명을 그대로 쓰지 않는다. `../` 하나로 프로젝트 폴더 밖에 쓸 수 있다.
     *   basename 으로 자르고, 최종 경로가 02_Source_Data 안인지 다시 확인한다.
     *
     * ★ 읽지 못하는 형식도 **거부하지 않고 저장하되 그렇다고 말한다.**
     *   PDF 원본을 보관해야 할 이유는 많다. 다만 본문이 추출되지 않는다는 사실을
     *   올린 직후에 알려야 한다 — 추출 단계에서야 알면 이미 늦다.
     */
    async uploadSources(ctx, projectId, body) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;

      const files = (body && Array.isArray(body.files)) ? body.files : null;
      if (!files || !files.length) return bad('올릴 파일이 없습니다');
      if (files.length > 50) return bad('한 번에 50개까지 올릴 수 있습니다');

      const store = load('core/store');
      const ext02 = load('agents/02-extraction');
      const dir = path.join(store.projectDir(projectId), '02_Source_Data');
      if (!fs.existsSync(dir)) return bad('프로젝트를 찾을 수 없습니다', 404);

      const saved = [];
      const rejected = [];
      let total = 0;

      for (const f of files) {
        const raw = String((f && f.name) || '');
        // ★ 경로 조작 차단 — basename 으로 자른 뒤 결과 경로를 다시 확인한다
        const name = path.basename(raw).replace(/[\u0000-\u001f\u007f]/g, '').trim();
        if (!name || name.startsWith('.')) {
          rejected.push({ name: raw, reason: '파일명이 올바르지 않습니다' });
          continue;
        }
        const full = path.join(dir, name);
        if (path.relative(dir, full).includes('..') || path.dirname(full) !== dir) {
          rejected.push({ name: raw, reason: '경로가 올바르지 않습니다' });
          continue;
        }

        let buf;
        try {
          buf = Buffer.from(String(f.contentBase64 || ''), 'base64');
        } catch (_) {
          rejected.push({ name, reason: '내용을 읽을 수 없습니다' });
          continue;
        }
        if (!buf.length) { rejected.push({ name, reason: '빈 파일입니다' }); continue; }
        if (buf.length > MAX_FILE_BYTES) {
          rejected.push({ name, reason: `파일이 너무 큽니다 (${mb(buf.length)}MB · 한도 ${mb(MAX_FILE_BYTES)}MB)` });
          continue;
        }
        total += buf.length;
        if (total > MAX_REQUEST_BYTES) {
          rejected.push({ name, reason: `한 번에 올릴 수 있는 총 용량을 넘었습니다 (한도 ${mb(MAX_REQUEST_BYTES)}MB)` });
          continue;
        }

        try {
          fs.writeFileSync(full, buf);
        } catch (err) {
          rejected.push({ name, reason: `저장 실패: ${err.message}` });
          continue;
        }

        const lower = path.extname(name).toLowerCase();
        const readable = ext02.TEXT_EXT.has(lower) || !!ext02.ZIP_EXT[lower];
        saved.push({
          name, bytes: buf.length, readable,
          note: readable ? null
            : (ext02.UNSUPPORTED_EXT.has(lower)
              ? '본문을 읽지 못합니다 — 보관은 되지만 수치 추출에는 쓰이지 않습니다'
              : '처음 보는 형식입니다 — 본문을 읽지 못할 수 있습니다'),
        });
      }

      return ok({ saved, rejected, at: kstStamp(new Date()) });
    },

    /**
     * PUT /projects/:id/issuer — 발행 주체를 나중에 고친다.
     *
     * 접수 때 안 넣었거나 잘못 넣었을 때 쓴다. 문서를 다시 만들어야 반영되므로
     * 그 사실을 응답에 적어 돌려준다 — 고쳤는데 옛 문서가 그대로면 고친 줄 안다.
     */
    async saveIssuer(ctx, projectId, body) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;

      const norm = issuerMod.normalize(body && body.issuer);
      if (!norm.ok) return bad(norm.error);

      const store = load('core/store');
      if (!fs.existsSync(store.projectDir(projectId))) return bad('프로젝트를 찾을 수 없습니다', 404);
      store.writeJson(projectId, '01_Project/issuer.json', norm.value);

      if (body && body.issuerAsDefault) {
        const rootDir = d.agentRoot || process.env.IM_AGENT_ROOT;
        if (rootDir) fs.writeFileSync(path.join(rootDir, issuerMod.FILE), JSON.stringify(norm.value, null, 2));
      }

      return ok({
        issuer: norm.value,
        // 이미 만들어진 문서에는 옛 이름이 남아 있다
        needsRegenerate: fs.existsSync(path.join(store.projectDir(projectId), '12_Final', 'im-a4.html')),
        at: kstStamp(new Date()),
      });
    },

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
            // ★ 값이 갈리고 있으면 그대로 알려준다. 이긴 값만 보여주면
            //   화면에서는 멀쩡해 보이고, 충돌은 검증 단계에 가서야 드러난다
            alternatives: (f.alternatives && f.alternatives.length) ? f.alternatives : null,
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
          note: USER_NOTE,           // 이전 입력을 찾아 지우려면 표시가 있어야 한다
        });
      });

      if (!clean.length) return { status: 400, body: { error: '저장할 수 있는 값이 없습니다', rejected } };

      const json = store.readJson(projectId, '01_Project/dataset.json', null);
      const ds = json ? Dataset.fromJSON(json, dict.FIELDS) : new Dataset(projectId, dict.FIELDS);

      // ★ 같은 항목의 **이전 화면 입력만** 지우고 새로 넣는다.
      //   지우지 않으면 5000 을 5500 으로 고쳐도 둘 다 후보로 남아 옛 값이 이긴다.
      //   저장은 성공했다고 나오는데 화면 값은 그대로다 — 가장 나쁜 실패다.
      //   추출·공공데이터가 넣은 값은 건드리지 않는다. 그것과 값이 갈리는 것은
      //   버그가 아니라 이 시스템이 잡아내야 할 신호다.
      const touched = new Set(clean.map(f => f.key));
      ds.dropWhere((f, key) => touched.has(key) && f.note === USER_NOTE);

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

  router.post('/projects', wrap(req => h.createProject(req, req.body)));
  router.post('/projects/:id/sources', wrap(req => h.uploadSources(req, req.params.id, req.body)));
  router.put('/projects/:id/issuer', wrap(req => h.saveIssuer(req, req.params.id, req.body)));
  router.get('/projects/:id/spec', wrap(req => h.getSpec(req, req.params.id)));
  router.post('/projects/:id/spec', wrap(req => h.saveSpec(req, req.params.id, req.body)));
  router.post('/projects/:id/spec/confirm', wrap(req => h.confirmSpec(req, req.params.id, req.body)));
  router.get('/projects/:id/facts', wrap(req => h.getFacts(req, req.params.id)));
  router.put('/projects/:id/facts', wrap(req => h.saveFacts(req, req.params.id, req.body)));
  router.get('/projects/:id/reports', wrap(req => h.listReports(req, req.params.id)));
  router.post('/projects/:id/reports', wrap(req => h.generate(req, req.params.id, req.body)));

  return router;
}

module.exports = {
  createHandlers, createRouter, DOC_PLANS, OUTPUTS, PLAN_RANK, PROJECT_ID,
  MAX_FILE_BYTES, MAX_REQUEST_BYTES,
};
