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
 *
 *   POST   /projects/:id/sources          자료 보관 (core/vault.js 경유)
 *   GET    /projects/:id/sources          보관 목록 · 휴지통 · 용량
 *   DELETE /projects/:id/sources/:name    지우기 — **휴지통으로만**
 *   POST   /projects/:id/sources/restore  되돌리기
 *   POST   /projects/:id/sources/purge    휴지통 비우기 — 되돌릴 수 없다
 *   POST   /projects/:id/sources/verify   보관한 파일이 그대로인지 대조
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

/**
 * 자료 쪽 요구 플랜 — **연결과 1회성 올리기는 무료다** 〈2026-08-17 결정〉.
 *
 * ★ 잠그지 않는 이유: **자료를 못 넣으면 보고서를 만들 수도 없다.**
 *   잠그면 유료 전환을 막는 쪽으로 작용한다.
 * ★ 용량으로 가르지 않는 이유: **보관을 하지 않으므로 잴 것이 없다.**
 * ★ 이 값은 아직 **화면에 노출되지 않는다** — 「자료」 탭은 지침 재발행 뒤에
 *   만든다(D-63). 지침 §2 에 「자료(무료)」가 실려야 화면이 열린다.
 */
const FILES_PLAN = 'free';

/** 화면에서 사람이 넣은 값의 표시. 다시 저장할 때 이전 입력을 찾아 지우는 데 쓴다 */
const USER_NOTE = 'user_input';

// 업로드 한도는 읽기 라우터와 한 값을 쓴다 (화면이 GET /intake 로 같은 값을 받는다)
const { MAX_FILE_BYTES, MAX_REQUEST_BYTES } = require('./api-router.cjs');
const issuerMod = require('../core/issuer');
const mb = (n) => Math.round(n / (1024 * 1024) * 10) / 10;

/**
 * 산출물 경로 — 파일이 실제로 있는지로 판정한다 ('생성됨' 플래그를 믿지 않는다).
 *
 * ★★ `when` 이 「완성 보고서」 화면의 **분모**를 만든다 〈2026-08-17〉.
 *   `always`      사양과 무관하게 생성되면 나온다 → 분모에 넣는다
 *   `format:pdf`  사양의 formats 에 그 형식이 있을 때만 나온다 → 있으면 분모
 *   `conditional` **딜에 그 자료가 있어야** 나온다 → **분모에 넣지 않는다**
 *
 *   ★ conditional 을 분모에 넣으면 어떤 딜도 100% 가 되지 않아
 *     **다 끝났는데도 덜 된 것처럼** 보인다. 반대로 목록에서 아예 빼면
 *     「나올 수 있는 문서가 있었다」는 사실이 사라진다 — **분모 밖에 따로 낸다.**
 *   ★ `why` 는 안 나온 이유를 화면이 **그대로** 띄운다. 이유 없이 회색이면
 *     고장으로 읽힌다 (단계 레일에서 배운 것과 같은 자리다).
 */
const OUTPUTS = [
  { id: 'im', name: 'IM 원문', rel: '09_IM/im.md', when: 'always' },
  { id: 'a4', name: 'A4 인쇄본', rel: '12_Final/im-a4.html', when: 'always' },
  // ★ **PDF 가 목록에 없었다** (2026-08-17 발견). D-53 으로 실제로 만들어지는데
  //   여기 없어서 「완성 보고서」에 안 떴다 — 파일은 있고 화면에는 없는 상태다
  { id: 'pdf', name: 'PDF', rel: '12_Final/im-a4.pdf', when: 'format:pdf',
    why: '출력 사양의 형식에 PDF 를 넣어야 나옵니다' },
  { id: 'content', name: '뷰어 데이터', rel: '12_Final/content.json', when: 'always' },
  { id: 'teaser', name: 'Teaser', rel: '10_Teaser/teaser.md', when: 'always' },
  { id: 'validation', name: '검증 보고서', rel: '11_QC/validation-report.md', when: 'always' },
  { id: 'redflag', name: 'RED FLAG 보고서', rel: '11_QC/red-flag-report.md', when: 'always' },
  // ★ 2026-08-17 추가 — 만들어지는데 목록에 없던 둘 (D-57 · D-59).
  //   **이름에 「감정평가서」·「평가의견서」를 쓰지 않는다** — 목록에서 그렇게
  //   보이면 받는 사람이 정식 평가로 읽는다. 문서 안에도 같은 이유로 안 쓴다
  { id: 'desk_md', name: '토지가치 탁상검토', rel: '08_Appraisal/desk-review.md', when: 'conditional',
    why: '토지 평가에 쓸 값(공시지가·거래사례·수익)이 있어야 나옵니다' },
  { id: 'desk_pdf', name: '토지가치 탁상검토 (PDF)', rel: '08_Appraisal/desk-review-a4.pdf', when: 'conditional',
    why: '토지가치 탁상검토가 나온 딜에서만 함께 나옵니다' },
  { id: 'corp_md', name: '법인가치 검토', rel: '10_Corporate/corp-review.md', when: 'conditional',
    why: '법인 재무자료(순손익 3개 연도·순자산)가 있어야 나옵니다' },
  { id: 'corp_pdf', name: '법인가치 검토 (PDF)', rel: '10_Corporate/corp-review-a4.pdf', when: 'conditional',
    why: '법인가치 검토가 나온 딜에서만 함께 나옵니다' },
];

/**
 * 이 프로젝트에서 **나와야 하는** 산출물인가 (분모 판정).
 *
 * 사양을 못 읽으면 `format:*` 를 **기대에 넣지 않는다** — 넣으면 사양에 없는
 * 형식을 「안 나왔다」로 세어 진행률이 영영 100% 가 안 된다.
 */
function isExpected(out, spec) {
  if (out.when === 'always') return true;
  if (String(out.when || '').startsWith('format:')) {
    const want = out.when.slice('format:'.length);
    return !!(spec && Array.isArray(spec.formats) && spec.formats.indexOf(want) > -1);
  }
  return false;   // conditional — 분모에 넣지 않는다
}

/** 산출물 확장자별 MIME. 목록에 없으면 브라우저가 알아서 해석하지 못하게 둔다 */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // ★ **없어서 PDF 를 못 받고 있었다.** 목록에 없으면 브라우저가 해석하지
  //   못하는데, 증상이 「다운로드가 안 된다」로만 보여 원인이 안 드러난다
  '.pdf': 'application/pdf',
};

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

      // ★ 프로젝트를 만들기 **전에** 발행 주체를 검증한다.
      //   나중에 검증하면 400 을 돌려주면서도 프로젝트 폴더는 이미 만들어져
      //   남는다. 사용자는 실패한 줄 아는데 번호는 하나 소모되어 있다.
      let issuerValue = null;
      if (b.issuer) {
        const norm = issuerMod.normalize(b.issuer);
        if (!norm.ok) return bad(norm.error);
        issuerValue = norm.value;
      }

      const { runAgent, STATUS } = load('core/runtime');
      const { Dataset } = load('core/facts');
      const { FIELDS } = load('core/dictionary');
      const store = load('core/store');

      const r = await runAgent('01_project', {
        request,
        projectName: b.projectName ? String(b.projectName).slice(0, 200) : undefined,
        assetType: b.assetType ? String(b.assetType) : undefined,
        assetClass: b.assetClass ? String(b.assetClass) : undefined,
      }, { log: () => {} });

      if (r.status === STATUS.ERROR) return bad(`프로젝트 생성 실패: ${r.error}`, 500);

      const out = r.output;

      // 발행 주체 저장 — 위에서 이미 검증한 값이다.
      //   없으면 저장하지 않는다. 저장소 기본값이 있으면 그것이 쓰이고,
      //   그것도 없으면 문서에 '미설정'이 찍히고 승인 게이트가 배포를 막는다.
      if (issuerValue) {
        store.writeJson(out.projectId, '01_Project/issuer.json', issuerValue);
        // 앞으로 만드는 프로젝트에도 쓰겠다고 하면 저장소 기본값으로 남긴다
        if (b.issuerAsDefault) {
          const rootDir = d.agentRoot || process.env.IM_AGENT_ROOT;
          if (rootDir) fs.writeFileSync(path.join(rootDir, issuerMod.FILE), JSON.stringify(issuerValue, null, 2));
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
          // 못 정했으면 null 이다. 화면이 「자산군을 고르세요」를 띄울 수 있어야 한다
          assetClass: out.assetClass || null,
          assetClassCandidates: out.assetClassCandidates || [],
          name: out.name,
          // 뽑힌 값을 그대로 돌려준다. 무엇을 넘겨짚었는지 사람이 봐야 한다
          seeded: (out.facts || []).map(f => ({
            key: f.key, value: f.value, unit: f.unit || null,
            quote: f.quote || null, source: f.source, verified: false,
          })),
          // 무엇이 발행 주체로 쓰이는지 돌려준다. 화면이 '미설정'을 띄울 수 있어야 한다
          issuer: issuerMod.resolve(out.projectId),
          issuerSaved: !!issuerValue,
          at: kstStamp(new Date()),
        },
      };
    },

    /**
     * POST /projects/:id/sources — 원본 자료를 올린다.
     *
     * ★ 저장은 **core/vault.js 를 거친다.** 직접 writeFileSync 하지 않는다 —
     *   그러면 덮어쓰기·잘린 파일·해시 없음·지울 방법 없음이 그대로 돌아온다.
     *   경로 조작 차단(basename + 안쪽 확인)도 vault 안에 있다.
     *
     * ★ 읽지 못하는 형식도 **거부하지 않고 저장하되 그렇다고 말한다.**
     *   PDF 원본을 보관해야 할 이유는 많다. 다만 본문이 추출되지 않는다는 사실을
     *   올린 직후에 알려야 한다 — 추출 단계에서야 알면 이미 늦다.
     *
     * ★ 같은 이름을 다시 올리면 **이전 파일이 휴지통으로 간다.** 응답의
     *   `replaced` 로 그 사실을 돌려준다 — 조용히 바뀌면 사용자는 옛 파일이
     *   아직 있다고 믿는다.
     */
    async uploadSources(ctx, projectId, body) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;

      const files = (body && Array.isArray(body.files)) ? body.files : null;
      if (!files || !files.length) return bad('올릴 파일이 없습니다');
      if (files.length > 50) return bad('한 번에 50개까지 올릴 수 있습니다');

      const store = load('core/store');
      const ext02 = load('agents/02-extraction');
      const vault = load('core/vault');
      const projectDir = store.projectDir(projectId);
      if (!fs.existsSync(path.join(projectDir, '02_Source_Data'))) return bad('프로젝트를 찾을 수 없습니다', 404);

      const saved = [];
      const rejected = [];
      let total = 0;

      for (const f of files) {
        const raw = String((f && f.name) || '');

        let buf;
        try {
          buf = Buffer.from(String(f.contentBase64 || ''), 'base64');
        } catch (_) {
          rejected.push({ name: raw, reason: '내용을 읽을 수 없습니다' });
          continue;
        }
        if (!buf.length) { rejected.push({ name: raw, reason: '빈 파일입니다' }); continue; }
        if (buf.length > MAX_FILE_BYTES) {
          rejected.push({ name: raw, reason: `파일이 너무 큽니다 (${mb(buf.length)}MB · 한도 ${mb(MAX_FILE_BYTES)}MB)` });
          continue;
        }
        total += buf.length;
        if (total > MAX_REQUEST_BYTES) {
          rejected.push({ name: raw, reason: `한 번에 올릴 수 있는 총 용량을 넘었습니다 (한도 ${mb(MAX_REQUEST_BYTES)}MB)` });
          continue;
        }

        // ★ 저장·해시·세대 보존·원자적 쓰기·경로 조작 차단은 전부 vault 안에 있다
        let put;
        try {
          put = vault.put(projectDir, raw, buf, { by: (g.user && g.user.name) || null });
        } catch (err) {
          rejected.push({ name: raw, reason: `저장 실패: ${err.message}` });
          continue;
        }
        if (!put.ok) { rejected.push({ name: raw, reason: put.reason }); continue; }

        // ★ 올린 **직후에** 어떻게 읽을지 말한다. 추출 단계에서야 알면 늦다
        const lower = path.extname(put.name).toLowerCase();
        const how = ext02.FORMATS[lower];
        const NOTE = {
          text: null,
          zip: null,
          pdf: '본문을 읽습니다 — 글자 없는 스캔본이면 글자로 옮겨서 읽습니다',
          ole: '옛 한글·오피스 형식입니다 — 본문을 읽고, 규격 밖이면 글자로 옮겨서 읽습니다',
          ocr: '이미지입니다 — 글자로 옮겨서 읽습니다 (옮긴 값은 신뢰도를 낮춰 표시합니다)',
          convert: `이 형식은 읽지 못합니다 — ${ext02.CONVERT_HINT[lower] || 'PDF 나 PNG 로 바꿔서 올립니다'}`,
        };
        saved.push({
          name: put.name, bytes: put.bytes,
          // 저장한 그대로인지 나중에 대조할 수 있는 값. 화면에 안 보여도 응답에는 남긴다
          sha256: put.sha256,
          duplicate: put.duplicate,
          // 같은 이름을 덮었으면 **말한다.** 이전 파일은 지워진 것이 아니라 휴지통에 있다
          replaced: put.replaced ? { as: put.replaced.as, bytes: put.replaced.bytes } : null,
          readable: !!how && how !== 'convert',
          how: how || null,
          note: how ? NOTE[how] : '처음 보는 형식입니다 — 본문을 읽지 못할 수 있습니다',
        });
      }

      return ok({ saved, rejected, usage: vault.usage(projectDir), at: kstStamp(new Date()) });
    },

    /**
     * GET /projects/:id/sources — 보관 중인 자료 목록 · 용량.
     *
     * ★ 무엇을 보관하고 있는지 볼 방법이 없으면 **지울 방법도 없다.**
     *   보관 리스크를 줄이는 첫 걸음은 목록이다.
     */
    async listSources(ctx, projectId) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const vault = load('core/vault');
      const projectDir = store.projectDir(projectId);
      if (!fs.existsSync(projectDir)) return bad('프로젝트를 찾을 수 없습니다', 404);
      const listed = vault.list(projectDir);
      return ok({ files: listed.files, trash: listed.trash, usage: vault.usage(projectDir), at: kstStamp(new Date()) });
    },

    /**
     * DELETE /projects/:id/sources/:name — 자료를 지운다.
     *
     * ★ **휴지통으로 옮길 뿐 없애지 않는다.** 딜 자료는 잘못 지우면 다시 만들 수 없다.
     *   정말 없애는 것은 purgeSources 로 따로, 며칠 지난 것인지를 지정해서만 한다.
     */
    async deleteSource(ctx, projectId, name) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const vault = load('core/vault');
      const projectDir = store.projectDir(projectId);
      if (!fs.existsSync(projectDir)) return bad('프로젝트를 찾을 수 없습니다', 404);

      const r = vault.trash(projectDir, name, { by: (g.user && g.user.name) || null });
      if (!r.ok) return bad(r.reason, r.reason === '그런 자료가 없습니다' ? 404 : 400);
      return ok({
        trashed: r.trashed,
        // ★ 지웠다고 이미 만든 보고서가 저절로 바뀌지 않는다. 다시 만들어야 반영된다
        needsRegenerate: fs.existsSync(path.join(projectDir, '12_Final', 'im-a4.html')),
        usage: vault.usage(projectDir), at: kstStamp(new Date()),
      });
    },

    /** POST /projects/:id/sources/restore — 휴지통에서 되돌린다 */
    async restoreSource(ctx, projectId, body) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const vault = load('core/vault');
      const projectDir = store.projectDir(projectId);
      if (!fs.existsSync(projectDir)) return bad('프로젝트를 찾을 수 없습니다', 404);

      const r = vault.restore(projectDir, (body && body.as) || '', { by: (g.user && g.user.name) || null });
      if (!r.ok) return bad(r.reason, 404);
      return ok({ restored: r.restored, displaced: r.displaced, usage: vault.usage(projectDir), at: kstStamp(new Date()) });
    },

    /**
     * POST /projects/:id/sources/purge — 휴지통을 실제로 비운다. **되돌릴 수 없다.**
     *
     * ★ olderThanDays 를 반드시 받고, confirm:true 가 없으면 **무엇이 지워질지만**
     *   돌려준다. 되돌릴 수 없는 동작에 기본값을 두지 않는다.
     */
    async purgeSources(ctx, projectId, body) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const vault = load('core/vault');
      const projectDir = store.projectDir(projectId);
      if (!fs.existsSync(projectDir)) return bad('프로젝트를 찾을 수 없습니다', 404);

      const days = Number(body && body.olderThanDays);
      const r = vault.purge(projectDir, {
        olderThanDays: days,
        dryRun: !(body && body.confirm === true),
        by: (g.user && g.user.name) || null,
      });
      if (!r.ok) return bad(r.reason);
      return ok(Object.assign({}, r, { usage: vault.usage(projectDir), at: kstStamp(new Date()) }));
    },

    /**
     * POST /projects/:id/sources/verify — 보관한 파일이 그대로인지 대조한다.
     *
     * ★ 디스크가 조용히 상하거나 NAS 에서 누가 파일을 바꿔치기해도 **증상이 없다.**
     *   보고서는 그대로 나오고 출처 표시도 멀쩡하다. 대조하지 않으면 알 수 없다.
     */
    async verifySources(ctx, projectId) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const vault = load('core/vault');
      const projectDir = store.projectDir(projectId);
      if (!fs.existsSync(projectDir)) return bad('프로젝트를 찾을 수 없습니다', 404);
      return ok(vault.verify(projectDir));
    },

    /* ─────────── 연결 자료 — 보관하지 않는 쪽 (D-65) ─────────── */

    /**
     * GET /projects/:id/linked — 연결된 자료 목록.
     *
     * ★ 파일이 없다. 어디 있는지·어느 판인지·언제 읽었는지만 있다.
     *   `unread` 는 **한 번도 안 읽어 지문이 없는 것**이다 — 값의 근거가 될 수 없다.
     */
    async listLinked(ctx, projectId) {
      const g = gate(ctx, FILES_PLAN); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const linked = load('core/linked');
      const storage = load('connectors/storage');
      const projectDir = store.projectDir(projectId);
      if (!fs.existsSync(projectDir)) return bad('프로젝트를 찾을 수 없습니다', 404);

      const l = linked.list(projectDir);
      return ok({
        ...l,
        // 화면이 「어디에 붙일 수 있나」를 여기서 받는다. 복사해 두면 갈린다
        providers: storage.PROVIDER_IDS.map(id => ({
          id, name: storage.PROVIDERS[id].name, scopeNote: storage.SCOPE_NOTE[id],
        })),
        modes: storage.MODES,
        // ★ 우리가 사본을 갖지 않는다는 사실을 응답이 말한다
        storesCopies: false,
      });
    },

    /**
     * POST /projects/:id/linked — 자료를 연결한다. **가져오지 않는다.**
     *
     * ★ 판(rev)이 없으면 거절한다 — 파일만 가리키면 나중에 바뀌어도 알 수 없다.
     * ★ 토큰이 본문에 섞여 오면 거절한다 (장부에 그대로 저장될 자리다).
     */
    async linkSource(ctx, projectId, body) {
      const g = gate(ctx, FILES_PLAN); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const linked = load('core/linked');
      const projectDir = store.projectDir(projectId);
      if (!fs.existsSync(projectDir)) return bad('프로젝트를 찾을 수 없습니다', 404);

      // ★★ 내려받기가 안 붙어 있으면 **연결을 받지 않는다.**
      //   연결만 되고 읽히지 않으면 사용자는 자료를 넣었다고 믿는데 보고서에는
      //   안 실린다 — 조용한 실패다. 「받아 두고 안 쓰는」 상태를 만들지 않는다.
      if (typeof d.fetchLinked !== 'function') {
        return bad('저장소 내려받기가 붙어 있지 않습니다 — 연결해도 자료를 읽지 못해 '
          + '보고서에 실리지 않습니다', 501);
      }

      const r = linked.link(projectDir, body && body.ref, { by: (g.user && g.user.name) || null });
      if (!r.ok) return bad(r.reason);
      return ok({ ...r, at: kstStamp(new Date()) });
    },

    /**
     * DELETE /projects/:id/linked/:key — 연결을 끊는다.
     * ★ **원본을 지우지 않는다.** 남의 드라이브다 — 응답이 그 구분을 말한다.
     */
    async unlinkSource(ctx, projectId, key) {
      const g = gate(ctx, FILES_PLAN); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const linked = load('core/linked');
      const projectDir = store.projectDir(projectId);
      if (!fs.existsSync(projectDir)) return bad('프로젝트를 찾을 수 없습니다', 404);

      const r = linked.unlink(projectDir, key, { by: (g.user && g.user.name) || null });
      if (!r.ok) return bad(r.reason, 404);
      return ok({ ...r, at: kstStamp(new Date()) });
    },

    /**
     * POST /projects/:id/linked/verify — 원본이 그때 그대로인가.
     *
     * ★ 여기가 「보관하지 않는다」의 대가를 갚는 자리다. 사본이 없으므로
     *   **원본이 바뀌었는지는 물어봐야만 안다.** 안 물으면 문서는 멀쩡하고
     *   근거만 사라진다.
     *
     * ★ 실제 조회기(`headLinked`)를 안 붙이면 **501 을 돌려준다.**
     *   조용히 「이상 없음」을 내면 그것이 가장 나쁜 답이다.
     */
    async verifyLinked(ctx, projectId) {
      const g = gate(ctx, FILES_PLAN); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const linked = load('core/linked');
      const projectDir = store.projectDir(projectId);
      if (!fs.existsSync(projectDir)) return bad('프로젝트를 찾을 수 없습니다', 404);

      if (typeof d.headLinked !== 'function') {
        return bad('저장소 조회기가 붙어 있지 않습니다 — 원본이 그대로인지 확인할 수 없습니다', 501);
      }
      return ok(await linked.verify(projectDir, d.headLinked));
    },

    /**
     * POST /projects/:id/oneshot — **한 번 읽고 버리는** 직접 업로드 (D-66).
     *
     * ★ 저장소를 안 쓰는 사람을 위한 길이다. **보관하지 않는다** — 받아서 읽고
     *   지문만 남기고 파일은 버린다.
     *
     * ★★ 연결과 **위험이 다르다.** 연결 자료는 원본이 사용자 저장소에 남아
     *   나중에 대조할 수 있지만, 1회성은 **우리도 원본을 안 갖고 어디 있는지도
     *   모른다.** 그래서 응답이 `reusable:false` · `verifiable:false` 를 말한다 —
     *   화면이 올리기 **전에** 그것을 알려야 한다.
     */
    async oneshotUpload(ctx, projectId, body) {
      const g = gate(ctx, FILES_PLAN); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const oneshot = load('core/oneshot');
      const dirOf = store.projectDir(projectId);
      if (!fs.existsSync(dirOf)) return bad('프로젝트를 찾을 수 없습니다', 404);

      // ★★ 읽는 경로가 안 붙어 있으면 **받지 않는다.**
      //   지금 구조에서는 받아서 지문만 남기고 버리므로, 사용자는 올렸는데
      //   보고서에는 아무것도 안 실린다. 그리고 **다시 올릴 수도 없다**(1회성) —
      //   자료를 잃는 것과 같다. 조용히 성공을 돌려주지 않는다.
      if (typeof d.extractOneshot !== 'function') {
        return bad('1회성 자료를 읽는 경로가 붙어 있지 않습니다 — 올려도 보고서에 실리지 않고, '
          + '보관하지 않으므로 다시 쓸 수도 없습니다', 501);
      }

      const files = (body && Array.isArray(body.files)) ? body.files : null;
      if (!files || !files.length) return bad('올릴 파일이 없습니다');
      if (files.length > 50) return bad('한 번에 50개까지 올릴 수 있습니다');

      const rejected = [];
      const bufs = [];
      let total = 0;
      for (const f of files) {
        const raw = String((f && f.name) || '');
        let buf;
        try { buf = Buffer.from(String(f.contentBase64 || ''), 'base64'); }
        catch (_) { rejected.push({ name: raw, reason: '내용을 읽을 수 없습니다' }); continue; }
        if (!buf.length) { rejected.push({ name: raw, reason: '빈 파일입니다' }); continue; }
        if (buf.length > MAX_FILE_BYTES) {
          rejected.push({ name: raw, reason: `파일이 너무 큽니다 (${mb(buf.length)}MB · 한도 ${mb(MAX_FILE_BYTES)}MB)` });
          continue;
        }
        total += buf.length;
        if (total > MAX_REQUEST_BYTES) {
          rejected.push({ name: raw, reason: `한 번에 올릴 수 있는 총 용량을 넘었습니다 (한도 ${mb(MAX_REQUEST_BYTES)}MB)` });
          continue;
        }
        bufs.push({ name: raw, buf });
      }
      if (!bufs.length) return ok({ accepted: [], rejected, reusable: false, at: kstStamp(new Date()) });

      const r = oneshot.accept(dirOf, bufs, { by: (g.user && g.user.name) || null });
      if (!r.ok) return bad(r.reason);

      // ★ **읽고 나서 지운다.** 순서가 중요하다 — 지우고 읽을 수는 없고,
      //   읽지 않고 지우면 사용자는 올렸는데 아무 일도 안 일어난다.
      //   `extractOneshot` 이 던져도 **파일은 반드시 지운다** (finally).
      let read = null;
      try {
        read = await d.extractOneshot(projectId, r.files);
      } catch (err) {
        r.dispose();
        return bad(`자료를 읽지 못했습니다: ${err.message}`, 500);
      } finally {
        // dispose 는 두 번 불러도 안전하다
      }
      const removed = r.dispose().removed;

      return ok({
        accepted: r.accepted,
        rejected: rejected.concat(r.rejected),
        removed,
        // 읽은 결과를 그대로 돌려준다 — 무엇이 값으로 잡혔는지 사용자가 봐야 한다
        read: read || null,
        // 화면이 올리기 전에 말해야 하는 것들
        reusable: false,
        verifiable: false,
        note: '보관하지 않습니다 — 보고서를 다시 만들려면 다시 올려야 하고, '
          + '나중에 원본과 대조할 수 없습니다.',
        at: kstStamp(new Date()),
      });
    },

    /** GET /projects/:id/oneshot — 1회성으로 들어온 자료의 **기록**. 파일은 없다 */
    async listOneshot(ctx, projectId) {
      const g = gate(ctx, FILES_PLAN); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const oneshot = load('core/oneshot');
      const dirOf = store.projectDir(projectId);
      if (!fs.existsSync(dirOf)) return bad('프로젝트를 찾을 수 없습니다', 404);
      return ok(oneshot.list(dirOf));
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

      // 시각자료 — **참거짓만 받는다.** 아무 값이나 통과시키면 문자열 'false' 가
      // 참이 되어 끈 줄 알았던 조감도가 계속 만들어진다
      if (b.visuals && typeof b.visuals === 'object') {
        const v = {};
        ['birdseye', 'massing'].forEach((k) => {
          if (typeof b.visuals[k] === 'boolean') v[k] = b.visuals[k];
        });
        if (Object.keys(v).length) overrides.visuals = v;
      }

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

      // ★ 이 프로젝트의 자산군을 함께 준다. 화면이 자산군을 모르면 전용 필수
      //   항목을 셀 수 없고, 「필수 17개 중 17개」라고 다 됐다 말해 버린다
      const meta = store.readJson(projectId, '01_Project/project.json', null) || {};
      return ok({
        values, sources, hasDataset: !!ds,
        assetClass: meta.assetClass || null,
        assetType: meta.assetType || null,
        templateId: meta.templateId || null,
      });
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

      // 사양을 읽어 **분모**를 만든다. 못 읽으면 format 조건은 기대에 넣지 않는다
      let spec = null;
      try { spec = load('core/outputspec').read(projectId); } catch (_) { spec = null; }

      const all = OUTPUTS.map((o) => {
        const full = path.join(dir, o.rel);
        let stat = null;
        try { stat = fs.statSync(full); } catch (_) { stat = null; }
        return {
          id: o.id, name: o.name, path: o.rel,
          when: o.when, why: o.why || null,
          expected: isExpected(o, spec),
          exists: !!stat,
          at: stat ? kstStamp(stat.mtime) : null,
          bytes: stat ? stat.size : 0,
        };
      });

      const files = all.filter(f => f.exists);
      const expected = all.filter(f => f.expected);
      const done = expected.filter(f => f.exists);

      return ok({
        // ★ 나온 것만 (기존 호출부가 이 모양을 쓴다 — 바꾸지 않는다)
        files,
        // ★★ 2026-08-17 — 「완성 보고서」 화면이 **분모**를 여기서 받는다.
        //   화면이 스스로 계산하면 규칙이 두 벌이 되고, 산출물이 하나 늘 때
        //   한쪽만 고치는 날 진행률이 조용히 틀린다
        all,
        progress: {
          done: done.length,
          total: expected.length,
          // 분모가 0 이면 % 를 만들지 않는다 — 0/0 을 100% 로 적으면
          // 아무것도 안 만든 프로젝트가 「다 됐다」로 보인다
          percent: expected.length ? Math.round(done.length / expected.length * 100) : null,
          // 분모 밖 — 나올 수도 있는 것. **있었다는 사실을 지우지 않는다**
          conditional: all.filter(f => f.when === 'conditional' && !f.exists).length,
          countsWhat: '이 프로젝트에서 나와야 하는 산출물 중 실제로 파일이 나온 것',
        },
        specKnown: !!spec,
        // ★ 차단 상태를 목록과 함께 준다. 화면이 '완료'로만 보이면 안 된다
        distribution: blocked
          ? { blocked: true, reasons: blocked.reasons || [] }
          : { blocked: false, reasons: [] },
      });
    },

    /** POST /projects/:id/reports — 생성 시작 */
    /**
     * GET /projects/:id/file?rel=... — 산출물 파일을 내려준다. 〈B-8〉
     *
     * 지침 §7-3 이 [인쇄 · PDF 저장]을 안내하므로 **협력사 눈에는 이미 있는 기능**이다.
     * 파일을 여는 경로가 없어서 안내만 뜨던 것을 여기서 연다.
     *
     * ★ 경로를 조립하지 않는다. `rel` 은 OUTPUTS 에 적힌 것과 **글자 그대로 같을 때만**
     *   통과시킨다. 정규화·`..` 제거 같은 방어는 우회 방법이 계속 나온다 —
     *   목록에 없으면 거부하는 쪽이 짧고 확실하다.
     *
     * ★ HTML 을 같은 출처에서 그냥 서빙하지 않는다. IM 본문은 **업로드된 문서에서
     *   온 글자**를 담는다. 거기 스크립트가 섞여 있으면 이용자 세션 권한으로 돈다.
     *   그래서 `sandbox` CSP 로 스크립트를 죽인 채 보여 준다 — A4 인쇄본은
     *   정적 문서라 이걸로 잃는 것이 없다.
     */
    async getFile(ctx, projectId, rel) {
      const g = gate(ctx, 'pro'); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;

      const out = OUTPUTS.find(o => o.rel === String(rel || ''));
      if (!out) return bad('내려줄 수 있는 산출물이 아닙니다');

      const file = path.join(projectDir(projectId), out.rel);
      let stat = null;
      try { stat = fs.statSync(file); } catch (_) { stat = null; }
      if (!stat || !stat.isFile()) return bad('아직 생성되지 않았습니다', 404);

      // ★ 배포가 막힌 산출물을 조용히 내려주지 않는다. 목록에서는 '배포 차단'인데
      //   파일은 열린다면 검증 GATE 가 아무 의미도 없다
      const gateMod = load('core/gate');
      try {
        const decision = gateMod.check ? gateMod.check(projectId) : null;
        if (decision && decision.blocked) {
          return bad('검증을 통과하지 못한 산출물입니다 — 검증 화면에서 해소해야 열 수 있습니다', 403);
        }
      } catch (_) { /* GATE 를 못 읽는 것만으로 파일을 막지는 않는다 */ }

      return {
        status: 200,
        file,
        contentType: CONTENT_TYPES[path.extname(out.rel).toLowerCase()] || 'application/octet-stream',
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
          'Cache-Control': 'private, no-store',
        },
      };
    },

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
  router.get('/projects/:id/sources', wrap(req => h.listSources(req, req.params.id)));
  // ★ 지우기·되돌리기·비우기·대조는 **길을 따로 낸다.** 올리기와 같은 자리에 두면
  //   실수로 지우는 요청이 올리기로 읽히거나 그 반대가 된다.
  //   `/purge`·`/restore`·`/verify` 를 :name 보다 **먼저** 등록한다 —
  //   나중에 두면 `sources/purge` 가 「purge 라는 이름의 파일을 지워라」로 잡힌다.
  router.post('/projects/:id/sources/restore', wrap(req => h.restoreSource(req, req.params.id, req.body)));
  router.post('/projects/:id/sources/purge', wrap(req => h.purgeSources(req, req.params.id, req.body)));
  router.post('/projects/:id/sources/verify', wrap(req => h.verifySources(req, req.params.id)));
  router.delete('/projects/:id/sources/:name', wrap(req => h.deleteSource(req, req.params.id, req.params.name)));

  // 연결 자료 — 보관하지 않는 쪽 (D-65). /verify 를 :key 보다 먼저 등록한다
  router.get('/projects/:id/linked', wrap(req => h.listLinked(req, req.params.id)));
  router.post('/projects/:id/linked', wrap(req => h.linkSource(req, req.params.id, req.body)));
  router.post('/projects/:id/linked/verify', wrap(req => h.verifyLinked(req, req.params.id)));
  router.delete('/projects/:id/linked/:key', wrap(req => h.unlinkSource(req, req.params.id, req.params.key)));

  // 1회성 직접 올리기 — 저장소를 안 쓰는 사람의 길 (D-66). 보관하지 않는다
  router.post('/projects/:id/oneshot', wrap(req => h.oneshotUpload(req, req.params.id, req.body)));
  router.get('/projects/:id/oneshot', wrap(req => h.listOneshot(req, req.params.id)));
  router.put('/projects/:id/issuer', wrap(req => h.saveIssuer(req, req.params.id, req.body)));
  router.get('/projects/:id/spec', wrap(req => h.getSpec(req, req.params.id)));
  router.post('/projects/:id/spec', wrap(req => h.saveSpec(req, req.params.id, req.body)));
  router.post('/projects/:id/spec/confirm', wrap(req => h.confirmSpec(req, req.params.id, req.body)));
  router.get('/projects/:id/facts', wrap(req => h.getFacts(req, req.params.id)));
  router.put('/projects/:id/facts', wrap(req => h.saveFacts(req, req.params.id, req.body)));
  router.get('/projects/:id/reports', wrap(req => h.listReports(req, req.params.id)));
  // 파일은 JSON 이 아니다 — 성공하면 파일을, 실패하면 평소처럼 JSON 사유를 보낸다
  router.get('/projects/:id/file', async (req, res, next) => {
    try {
      const r = await h.getFile(req, req.params.id, req.query && req.query.rel);
      if (!r.file) return send(res, r);
      res.set(r.headers || {});
      res.type(r.contentType);
      res.sendFile(r.file);
    } catch (e) { next(e); }
  });
  router.post('/projects/:id/reports', wrap(req => h.generate(req, req.params.id, req.body)));

  return router;
}

module.exports = {
  createHandlers, createRouter, DOC_PLANS, OUTPUTS, isExpected, FILES_PLAN,
  PLAN_RANK, PROJECT_ID, CONTENT_TYPES,
  MAX_FILE_BYTES, MAX_REQUEST_BYTES,
};
