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

/**
 * ★★★ **자료를 넣고 읽는 길은 로그인을 묻지 않는다** 〈2026-08-22 사용자 결정 · D-82〉.
 *
 * 한 곳에서만 만든다 — 길마다 `{ anon: true }` 를 손으로 적으면, 다음에 길이
 * 하나 늘 때 **거기만 조용히 로그인을 묻는다.** 그 차이는 화면에서 안 보이고
 * 「어떤 파일은 되고 어떤 파일은 안 된다」로만 나타난다.
 *
 * ★★ **연 것은 넷뿐이다.** 무엇을 열었는지가 흐려지면 다음 사람이
 *   아무 데나 붙인다. 그래서 여기 적어 둔다.
 *
 * ★★★ **넷째가 늘었다** 〈2026-08-23 사장님 결정 · D-94〉 — `createProject`.
 *   앞 판은 셋만 열려 있었는데, **자료를 넣을 프로젝트를 만들 수가 없어서**
 *   열어 둔 셋이 통째로 못 쓰이고 있었다. 사장님 화면에서 그 자리에서 막혔다
 *   (「＋ 신규프로젝트 → 만들기」가 401 · 「로그인이 필요합니다」).
 *
 * | 길 | 로그인 | 왜 |
 * |---|:--:|---|
 * | `createProject`(＋ 신규프로젝트) | **안 묻는다** | 자료를 넣을 **그릇**을 만드는 자리다 (D-94) |
 * | `linkSource`   (폴더 지정) | **안 묻는다** | 자료를 **넣는** 길이다 |
 * | `oneshotUpload`(파일업로드)      | **안 묻는다** | 실제로 막혔던 자리다 |
 * | `scanSources`  (읽어서 값으로)   | **안 묻는다** | 넣고 나서 바로 이어지는 걸음이다 |
 * | `listLinked` · `listOneshot` | 묻는다 | 남의 프로젝트에 **무엇이 들었는지**가 나간다 |
 * | `verifyLinked`               | 묻는다 | 남의 저장소를 대신 두드린다 |
 * | `unlinkSource`               | 묻는다 | **지우는** 길이다 |
 * | 보고서 생성·산출물·값 저장   | 묻는다 | 손대지 않았다 |
 *
 * ★ 넣는 길만 열면 화면은 그대로 돈다 — 목록은 로그인한 사람이 보고,
 *   자료는 로그인이 흔들려도 들어간다. 실제로 막혔던 조합이 그것이었다.
 */
const ANON = { anon: true };

/** 화면에서 사람이 넣은 값의 표시. 다시 저장할 때 이전 입력을 찾아 지우는 데 쓴다 */
const USER_NOTE = 'user_input';

// 업로드 한도는 읽기 라우터와 한 값을 쓴다 (화면이 GET /intake 로 같은 값을 받는다)
const { MAX_FILE_BYTES, MAX_REQUEST_BYTES } = require('./api-router.cjs');
const issuerMod = require('../core/issuer');
const routes = require('./routes.cjs');
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
  // ★ `needsBrowser` — **이 서버에 크롬이 있어야 나온다** 〈2026-08-21 · 본체 인수인계 교차검증〉.
  //   운영 NAS 에는 크롬이 없다. 없는 서버에서 이 셋은 **원리상 안 나온다** —
  //   그것을 「아직 안 나왔다」로 그리면 사용자는 나올 때까지 기다린다.
  { id: 'pdf', name: 'PDF', rel: '12_Final/im-a4.pdf', when: 'format:pdf', needsBrowser: true,
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
    needsBrowser: true, why: '토지가치 탁상검토가 나온 딜에서만 함께 나옵니다' },
  { id: 'corp_md', name: '법인가치 검토', rel: '10_Corporate/corp-review.md', when: 'conditional',
    why: '법인 재무자료(순손익 3개 연도·순자산)가 있어야 나옵니다' },
  { id: 'corp_pdf', name: '법인가치 검토 (PDF)', rel: '10_Corporate/corp-review-a4.pdf', when: 'conditional',
    needsBrowser: true, why: '법인가치 검토가 나온 딜에서만 함께 나옵니다' },
];

/**
 * 이 프로젝트에서 **나와야 하는** 산출물인가 (분모 판정).
 *
 * 사양을 못 읽으면 `format:*` 를 **기대에 넣지 않는다** — 넣으면 사양에 없는
 * 형식을 「안 나왔다」로 세어 진행률이 영영 100% 가 안 된다.
 */
/**
 * @param {boolean} [hasBrowser] 이 서버가 브라우저를 갖고 있는가.
 *   `false` 면 브라우저가 필요한 산출물은 **분모에서 뺀다** —
 *   원리상 안 나오는 것을 분모에 두면 **어떤 딜도 100% 가 되지 않는다.**
 *   `undefined`(모름)면 빼지 않는다 — 모르는 것을 「안 된다」로 그리지 않는다.
 */
function isExpected(out, spec, hasBrowser) {
  // ★★ 크롬이 없는 서버에서는 PDF 가 **나올 수 없다.** 기다려도 안 나온다 —
  //   분모에 두면 진행률이 영영 안 찬다 (운영 NAS 가 실제로 그렇다)
  if (out.needsBrowser && hasBrowser === false) return false;
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

  /**
   * 연결 자료를 읽는 함수 — **없으면 엔진 것을 쓴다** 〈2026-08-20〉.
   *
   * ★★ 전에는 아무도 주지 않아서 연결 갈래가 통째로 501 이었다. 등록조차
   *   받지 않는다 — 읽을 수 없으면 받지 않는다는 설계다.
   *
   * ★ 엔진 기본 구현은 **토큰을 모른다.** 「그때그때 고르기」에서 제공자가 준
   *   짧게 사는 주소를 `core/handoff.js` 가 잠깐 들고 있고, 그것으로 받아 온다.
   *   그래서 남의 계정 열쇠가 이 저장소 어디에도 저장되지 않는다 (D-69).
   *
   * ★ 붙이는 쪽이 자기 구현을 주면 **그쪽이 이긴다** — 토큰을 들고 있는 곳이
   *   따로 있으면 그쪽이 더 잘 안다.
   */
  const linkedIO = load('core/linked-fetch');
  const fetchLinked = typeof d.fetchLinked === 'function' ? d.fetchLinked : linkedIO.fetchLinked;
  const headLinked = typeof d.headLinked === 'function' ? d.headLinked : linkedIO.headLinked;
  const projectDir = (id) => path.join(d.agentRoot || process.env.IM_AGENT_ROOT || '', id);

  /**
   * 인증 + 플랜. 실패 사유를 화면과 같은 어휘로 돌려준다.
   *
   * ★★★ **자료를 넣는 길은 로그인을 묻지 않는다** 〈2026-08-22 사용자 결정 · D-82〉.
   *
   *   왜 바꿨나. 목록은 멀쩡히 뜨는데 **올리기만** 401 이 돌아오는 일이 실제로
   *   났다. 로그인은 되어 있었다. 즉 이 401 은 「로그인하라」가 아니라
   *   **「이 요청에서 세션을 못 읽었다」**였는데, 화면에는 로그인 문제로 보이고
   *   사용자는 고칠 방법이 없다. 자료를 못 넣으면 **그다음이 통째로 막힌다.**
   *
   *   ★ 그래서 `anon` 을 준 길은 사람을 못 알아봐도 **그냥 받는다.** 누가 넣었는지
   *     모르면 `by: null` 로 남는다 — 모르는 것을 지어내지 않는다.
   *
   *   ★★ **열어 둔 범위를 분명히 한다.** 열린 것은 **자료를 넣고 읽는 길뿐**이다.
   *     보고서 생성·산출물 내려받기·값 저장은 **그대로 로그인을 묻는다.**
   *     `anon` 을 새 길에 붙일 때는 그 길이 무엇을 내보내는지 먼저 본다 —
   *     **읽어 가는 길에 붙이면 남의 자료가 열린다.**
   *
   *   ★ 이 파일은 **NAS 엔진이 실제로 돌리는 파일**이다. 화면 배포
   *     〈2026-08-23 · D-88 로 바뀌었다〉 이제 `deploy-nas` 워크플로가 **엔진도
   *     함께 올린다**(`deploy/engine.sh`). 앞 판 주석은 「화면 배포로는 안 올라가니
   *     `deploy/nas.sh` 를 돌려라」였는데 **더 이상 맞지 않는다.**
   */
  function gate(ctx, requiredPlan, opts) {
    const user = d.authenticate(ctx);
    if (!user && opts && opts.anon) return { user: null };
    if (!user) return { error: bad('로그인이 필요합니다', 401) };
    // ★ 열어 둔 길은 만료·플랜도 묻지 않는다. 「로그인 조건 삭제」의 뜻이 그것이다
    if (opts && opts.anon) return { user };
    if (user.status === 'expired') return { error: bad('멤버십이 만료되었습니다', 403) };

    const have = PLAN_RANK[user.planId];
    // 모르는 플랜 코드·정보 없음을 통과시키지 않는다 (오타 하나로 열리면 안 된다)
    if (have === undefined) return { error: bad('멤버십 정보를 확인할 수 없습니다', 403) };

    const need = PLAN_RANK[requiredPlan];
    if (need !== undefined && have < need) {
      /* ★ D-71 결정(2026-08-22 사장님): 「무료 계정은 테스트만」 — 막다른 길처럼 읽히지 않게, 무엇이 되고 무엇이 Pro 인지 한 줄로 */
      return { error: bad(user.planId === 'free' ? '무료 계정은 테스트만 가능합니다 — 보고서 생성·완성은 Pro 플랜부터 (내 정보 → 멤버십)' : `${requiredPlan} 플랜부터 사용할 수 있습니다`, 403) };
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
      /* ★★★ **프로젝트 만들기도 로그인을 묻지 않는다** 〈2026-08-23 사장님 결정 · D-94〉.
       *
       *   앞 판은 `gate(ctx, 'pro')` 였다 — 로그인 **＋ Pro 플랜**. 그런데
       *   `oneshotUpload`(파일업로드)는 D-82 로 이미 열려 있었다. 그래서 이런
       *   상태가 됐다: **자료를 넣는 길은 열려 있는데, 자료를 넣을 프로젝트를
       *   만들 수가 없다.** 열어 둔 셋이 통째로 못 쓰이고 있었던 셈이다.
       *
       *   ★ 사장님 화면에서 실제로 그 자리에서 막혔다 — 「＋ 신규프로젝트 →
       *     만들기」가 401, 문구는 「로그인이 필요합니다」.
       *
       *   ★★ **연 것은 만드는 것까지다.** 만든 뒤에 값을 저장하고 보고서를
       *     생성하는 길은 **그대로 로그인과 플랜을 묻는다** — 그쪽이 돈이 드는
       *     자리이고, 여기는 「자료를 넣을 그릇」을 만드는 자리다.
       *   ★ 누가 만들었는지 모르면 `by` 는 비워 둔다 (아래 `owner`). 모르는 것을
       *     지어내지 않는다.
       */
      const g = gate(ctx, FILES_PLAN, ANON); if (g.error) return g.error;

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
        /**
         * ★★ **쓴 주체는 자동으로 기억한다** 〈2026-08-23 사장님 지시:
         *   「자동 저장된 기업은 선택시 자동 노출」〉.
         *
         *   따로 「저장」을 누르게 하지 않는다 — 누르는 장치는 안 눌린다
         *   (D-86 에서 배운 것과 같은 결이다). 「앞으로도 이 주체를 씁니다」
         *   체크와는 **다른 것**이다: 저쪽은 기본값 하나를 바꾸는 것이고
         *   이쪽은 고를 수 있는 목록에 얹는 것이다.
         *
         *   ★ 실패해도 던지지 않는다. 목록은 편의 기능이고, 이것 때문에
         *     프로젝트 생성이 죽으면 안 된다 (§4.6).
         */
        issuerMod.remember(issuerValue, kstStamp(new Date()));
      }

      /**
       * ★★ **앱의 딜 키를 남긴다** 〈2026-08-20 · 프로젝트-연결-규칙 §3〉.
       *
       * 프로젝트를 사람이 만드는 곳은 앱의 딜파이프라인이고, 여기 `LP-…` 는
       * 그 딜의 **작업 폴더**다. 둘을 **이름으로 이으면** 앱에서 이름을 바꾸는
       * 날 조용히 끊긴다 — 이름은 바뀌라고 있는 것이다. 그래서 **키로 잇는다.**
       *
       * ★ 키는 **앱이 만든다.** 엔진은 받아 적기만 한다 — 양쪽이 만들면 어느
       *   것이 진짜인지 알 수 없게 된다. 안 주면 `null` 이고, 그때는 앱에서
       *   만든 딜과 이어지지 않은 폴더라는 뜻이다.
       */
      const externalId = b.externalId ? String(b.externalId).trim().slice(0, 128) : null;
      if (externalId) {
        const project = store.readJson(out.projectId, '01_Project/project.json', {});
        project.externalId = externalId;
        store.writeJson(out.projectId, '01_Project/project.json', project);
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
        // ★★ **열 수 있는지까지 말한다** 〈2026-08-20 실측〉. 전에는 넷을 그냥
        //   내려보냈고, 화면은 그것을 「붙일 수 있는 곳」으로 읽어 **누를 수 있는
        //   버튼 넷**을 그렸다. 실제로는 콘솔 등록이 안 되어 아무것도 안 열렸고,
        //   화면은 「이 브라우저에서는 열 수 없습니다」라고 **브라우저 탓**을 했다 —
        //   사용자는 브라우저를 바꾸러 간다. **키가 있는지는 서버만 안다.**
        //   ★ 값이 아니라 **환경변수 이름**만 내보낸다 (§2 — 값은 절대 안 나간다)
        providers: storage.PROVIDER_IDS.map((id) => {
          const env = storage.PROVIDERS[id].tokenEnv;
          return {
            id, name: storage.PROVIDERS[id].name, scopeNote: storage.SCOPE_NOTE[id],
            configured: !!String(process.env[env] || '').trim(),
            keyEnv: env,
          };
        }),
        modes: storage.MODES,
        // ★★ **앱이 내부로 넘길 때 쓰는 출처 이름을 서버가 알려 준다**
        //   〈2026-08-21 · 본체 실측 보고 §3-2〉. 화면이 이 값을 손으로 적고
        //   있었고, 검증기만 그 이름을 몰라서 첨부가 전부 거절됐다.
        //   같은 값이 세 곳에 따로 있으면 반드시 갈린다 — 여기가 정본이다.
        //   ★ 단추 목록(`providers`)에는 **넣지 않는다.** 고를 창이 없는 출처다
        appProvider: storage.INTERNAL_IDS[0] || null,
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
      const g = gate(ctx, FILES_PLAN, ANON); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const linked = load('core/linked');
      const projectDir = store.projectDir(projectId);
      if (!fs.existsSync(projectDir)) return bad('프로젝트를 찾을 수 없습니다', 404);

      // ★★ 내려받기가 안 붙어 있으면 **연결을 받지 않는다.**
      //   연결만 되고 읽히지 않으면 사용자는 자료를 넣었다고 믿는데 보고서에는
      //   안 실린다 — 조용한 실패다. 「받아 두고 안 쓰는」 상태를 만들지 않는다.
      //   (2026-08-20 부터 엔진 기본 구현이 있어 여기서 막히지 않는다.)
      if (typeof fetchLinked !== 'function') {
        return bad('저장소 내려받기가 붙어 있지 않습니다 — 연결해도 자료를 읽지 못해 '
          + '보고서에 실리지 않습니다', 501);
      }

      // ★★ **읽을 수단 없이 연결을 받지 않는다.**
      //   전에는 「내려받기 함수가 붙어 있나」로 그것을 봤다. 이제 엔진 기본
      //   구현이 늘 있으므로 그 검사는 항상 통과한다 — 그러면 안전장치가 죽는다.
      //   지금 실제로 필요한 것은 **그 파일에 대한 접근권**이다. 그것 없이
      //   장부에만 올리면, 만들 때가 되어서야 「가져오지 못했습니다」가 뜨고
      //   사용자는 자료를 넣었다고 믿은 채로 보고서를 받는다 — 조용한 실패다.
      const needsAccess = fetchLinked === linkedIO.fetchLinked;
      if (needsAccess && !(body && body.access && body.access.url)) {
        return bad('이 파일을 읽을 접근권이 없습니다 — 파일을 다시 골라 주세요', 400);
      }

      const r = linked.link(projectDir, body && body.ref, { by: (g.user && g.user.name) || null });
      if (!r.ok) return bad(r.reason);

      // ★★ 접근권은 **장부에 넣지 않는다.** `normalizeRef` 가 막고 있고, 그래야
      //   맞다 — 장부는 오래 남고 오래 남는 곳에 열쇠를 두지 않는다. 대신
      //   짧게 사는 자리에 맡긴다. 시간이 지나면 스스로 버린다 (D-69②).
      let access = null;
      if (body && body.access && r.item && r.item.key) {
        const handoff = load('core/handoff');
        const kept = handoff.put(projectId, r.item.key, body.access);
        // ★ 맡기지 못했으면 **말한다.** 조용히 넘기면 만들 때가 되어서야
        //   「가져오지 못했습니다」로 나타난다
        access = kept.ok ? { expiresAt: kept.expiresAt } : { error: kept.reason };
      }
      return ok({ ...r, access, at: kstStamp(new Date()) });
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

      if (typeof headLinked !== 'function') {
        return bad('저장소 조회기가 붙어 있지 않습니다 — 원본이 그대로인지 확인할 수 없습니다', 501);
      }
      // ★ 어느 프로젝트인지 함께 넘긴다 — 접근권이 프로젝트별로 보관된다
      return ok(await linked.verify(projectDir, (it) => headLinked(it, { projectId })));
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
      const g = gate(ctx, FILES_PLAN, ANON); if (g.error) return g.error;
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


    /**
     * POST /projects/:id/scan — **넣은 자료를 읽어 값으로 만든다** 〈2026-08-21 사용자 지시〉.
     *
     * ★★ 왜 따로 있나: 지금까지 자료를 「넣는 것」과 「읽는 것」이 나뉘어 있었다.
     *   보관·연결로 넣은 자료는 **보고서를 만드는 순간에야** 읽혔다. 그래서
     *   자료를 넣은 사람은 2단계(가이드 필드)에 가서 **빈 칸만** 봤다 —
     *   값이 없는 것이 아니라 **아직 안 읽은 것**인데, 화면은 그 둘을 구분해
     *   말하지 못했다. 여기서 미리 읽어 값으로 만들어 둔다.
     *
     * ★ **셋을 한 길로 모은다** (사용자 지시 — 「모두 업로드된 자료는 OCR 스캔을 통해」).
     *     ① 보관 자료   02_Source_Data 에 있는 파일 그대로
     *     ② 연결 자료   장부에 적힌 참조를 **그때 가져와** 읽고 **버린다**
     *     ③ 앱에서 가져온 첨부  ②와 같은 길이다 (`linkpilot-app` 도 연결 항목이다)
     *   1회성(oneshot)은 **여기 오지 않는다** — 올리는 그 자리에서 이미 읽었고
     *   파일을 버렸다. 다시 읽을 원본이 우리에게 없다. 그 사실을 응답에 적는다.
     *
     * ★★ OCR 은 **이미지·스캔본에만** 걸린다. 글자가 들어 있는 PDF·워드·엑셀은
     *   옮겨 적을 이유가 없다(옮기면 신뢰도만 깎인다 · core/ocr.js).
     *   그래서 「전부 OCR 한다」고 말하지 않고 **파일마다 어떻게 읽었는지** 돌려준다.
     *
     * ★★ 읽는 경로가 안 붙어 있으면 **성공을 돌려주지 않는다.** 0건을 성공으로
     *   주면 화면은 「읽었는데 값이 없다」로 그리고, 사용자는 자료를 탓한다.
     *
     * ★ 실패는 격리한다 (CLAUDE.md §4.6) — 연결 자료 하나를 못 가져와도
     *   나머지는 읽는다. 대신 **못 읽은 것을 이름으로 돌려준다.**
     */
    async scanSources(ctx, projectId, body) {
      const g = gate(ctx, FILES_PLAN, ANON); if (g.error) return g.error;
      const e = checkId(projectId); if (e) return e;
      const store = load('core/store');
      const linked = load('core/linked');
      const ext02 = load('agents/02-extraction');
      const projectDir = store.projectDir(projectId);
      if (!fs.existsSync(projectDir)) return bad('프로젝트를 찾을 수 없습니다', 404);

      // ★ 읽는 함수는 본체가 준다. 둘 다 `pipeline.extractInto(id, files)` 를 가리킨다 —
      //   이름이 둘인 것은 1회성이 먼저 생겼기 때문이고, 하는 일은 같다.
      const extract = typeof d.extractFiles === 'function' ? d.extractFiles
        : (typeof d.extractOneshot === 'function' ? d.extractOneshot : null);
      if (!extract) {
        return bad('자료를 읽는 경로가 붙어 있지 않습니다 — 자료는 그대로 있으니 '
          + '읽기가 연결된 뒤에 다시 눌러 주십시오', 501);
      }

      const wanted = (body && body.only) ? String(body.only) : 'all';

      // ── ① 보관 자료 ──
      let kept = [];
      if (wanted === 'all' || wanted === 'kept') {
        try { kept = store.listSourceFiles(projectId); } catch (_) { kept = []; }
      }

      // ── ②③ 연결 자료 (앱 첨부 포함) — 가져와서 읽고 **버린다** ──
      const unread = [];
      let mat = null;
      if (wanted === 'all' || wanted === 'linked') {
        const items = linked.list(projectDir).items;
        if (items.length) {
          try {
            mat = await linked.materialize(projectDir, (it) => fetchLinked(it, { projectId }));
            for (const f of mat.failed) unread.push({ name: f.name, why: f.reason, from: 'linked' });
          } catch (err) {
            // 한 소스가 죽어도 보관 자료 읽기는 계속한다
            for (const it of items) unread.push({ name: it.name, why: err.message, from: 'linked' });
            mat = null;
          }
        }
      }

      /**
       * ★★ **한 번에 너무 많이 읽지 않는다** 〈2026-08-21 · 본체 인수인계 교차검증〉.
       *
       * 운영 NAS 는 RAM 1.8GB 다. 한 프로젝트에 자료가 수십 개면 한 번에 읽다가
       * 서버가 죽을 수 있고, 그때는 **스캔만 실패하는 것이 아니라 엔진이 멈춘다.**
       *
       * ★★ **조용히 자르지 않는다.** 자른 것을 말하지 않으면 화면에는 「읽었다」만
       *   남고, 빠진 자료가 무엇인지 아무도 모른다. 그래서 못 읽은 것을
       *   **이름으로** 돌려주고 「다시 누르면 이어서 읽는다」를 함께 말한다.
       */
      const MAX_SCAN_FILES = 40;
      const MAX_SCAN_BYTES = 200 * 1024 * 1024;

      let files = kept.concat(mat ? mat.files : []);
      const overflow = [];
      if (files.length > MAX_SCAN_FILES || files.reduce((a, f) => a + (f.size || 0), 0) > MAX_SCAN_BYTES) {
        const take = [];
        let bytes = 0;
        for (const f of files) {
          if (take.length >= MAX_SCAN_FILES || bytes + (f.size || 0) > MAX_SCAN_BYTES) {
            overflow.push({
              name: f.name,
              why: `한 번에 읽는 양을 넘었습니다 (${MAX_SCAN_FILES}개 · ${mb(MAX_SCAN_BYTES)}MB 까지) — `
                + '다시 누르면 이어서 읽습니다',
              from: 'limit',
            });
            continue;
          }
          take.push(f);
          bytes += (f.size || 0);
        }
        files = take;
      }

      if (!files.length) {
        if (mat) mat.dispose();

        /**
         * ★★ **「자료가 없다」고 말하기 전에 1회성 장부를 본다** 〈2026-08-21 · 실제 신고〉.
         *
         * 사용자가 「파일업로드」로 파일을 넣고 「자료 스캔」을 눌렀더니
         * **「자료를 먼저 넣어 주십시오」**가 떴다. 방금 넣은 사람에게 안 넣었다고
         * 말한 것이다 — 화면이 사용자를 탓했다.
         *
         * 사실은 이렇다: 1회성은 **올리는 그 자리에서 읽고 파일을 버린다.**
         * 그래서 여기서 다시 읽을 원본이 우리에게 없다. **고장이 아니라 설계다.**
         * 그런데 장부에는 「무엇을 언제 올렸는지」가 남아 있다 — 그것을 보고
         * **무슨 일이 있었는지 그대로 말한다.**
         *
         * ★ 「없다」와 「여기서 다시 읽을 수 없다」는 다른 말이다. 앞엣것은 넣으라고
         *   하고, 뒤엣것은 **왜 다시 못 읽는지와 다음 수**를 알려 준다.
         */
        let shots = [];
        try { shots = (load('core/oneshot').list(projectDir).items) || []; } catch (_) { shots = []; }

        return ok({
          scanned: [], unread, facts: 0, documents: 0,
          empty: true,
          // 1회성으로만 넣은 상태인가 — 화면이 이것으로 말투를 가른다
          oneshotOnly: shots.length > 0,
          oneshotCount: shots.length,
          note: shots.length
            ? `여기서 다시 읽을 자료가 없습니다 — 「파일업로드」로 넣은 ${shots.length}건은 `
              + '올리는 그 자리에서 이미 읽었고, 보관하지 않으므로 원본이 남아 있지 않습니다. '
              + '다시 읽어야 하면 「폴더 지정」으로 넣으십시오.'
            : '읽을 자료가 없습니다 — 자료를 먼저 넣어 주십시오.',
          at: kstStamp(new Date()),
        });
      }

      // ★ 어떻게 읽을지를 **읽기 전에** 정해 둔다. 나중에 세면 못 읽은 파일이 빠진다
      const plan = files.map((f) => {
        const how = ext02.FORMATS[f.ext] || null;
        return {
          name: f.name,
          how,
          // 「OCR 스캔」이라고 뭉뚱그리지 않는다 — 실제로 옮겨 적는 것만 true 다
          ocr: how === 'ocr',
          // ★★ `readable` 은 **읽을 작정이었나**다. 「읽혔나」가 아니다 —
          //   아래에서 추출 결과를 보고 `read` 로 따로 답한다
          readable: !!how && how !== 'convert',
          note: how === 'ocr' ? '이미지입니다 — 글자로 옮겨서 읽습니다 (신뢰도를 낮춰 표시합니다)'
            : how === 'convert' ? `이 형식은 읽지 못합니다 — ${ext02.CONVERT_HINT[f.ext] || 'PDF 나 PNG 로 바꿔서 올립니다'}`
            : how ? null : '처음 보는 형식입니다 — 본문을 읽지 못할 수 있습니다',
        };
      });

      let read = null;
      let failed = null;
      try {
        read = await extract(projectId, files);
      } catch (err) {
        failed = err.message;
      } finally {
        // ★ 연결 자료 사본은 **반드시** 지운다. 읽다 죽어도 지운다 — 「보관하지
        //   않는다」는 성공했을 때만 지키는 약속이 아니다
        if (mat) mat.dispose();
      }
      if (failed) return bad(`자료를 읽지 못했습니다: ${failed}`, 500);

      /**
       * ★★ **작정과 결과를 합친다** 〈2026-08-21 · 실제로 돌려 보고 잡았다〉.
       *
       * 전에는 `scanned` 에 「어떻게 읽을 작정인가」를, `unread` 에 「실제로
       * 어떻게 됐나」를 따로 담아 **둘 다** 돌려줬다. 그래서 화면에 같은 파일이
       * 모순된 두 줄로 떴다:
       *
       *     · 등기부.png — OCR — 글자로 옮겨 읽음
       *     · 등기부.png — 못 읽음: GEMINI_API_KEY 가 필요합니다
       *
       * 읽을 작정이었던 것과 읽힌 것은 **다르다.** 키가 없으면 OCR 은 안 돈다.
       * 파일 하나에 답은 하나여야 한다 — 그래서 결과를 작정 위에 덮는다.
       *
       * ★ `unread` 에는 **아예 오지도 못한 것**만 남긴다 (연결 자료 내려받기
       *   실패 등). 온 파일의 실패는 그 파일 줄에 적힌다.
       */
      const byName = new Map(plan.map(x => [x.name, x]));
      for (const u of (read && read.unsupported) || []) {
        const why = u.reason || u.why || '읽지 못했습니다';
        const row = byName.get(u.name);
        if (row) {
          // 실제로 못 읽었다 — **작정을 지운다.** 「OCR 로 읽음」이 남으면 거짓말이다
          row.read = false;
          row.ocr = false;
          row.readable = false;
          row.why = why;            // 왜 못 읽었는지는 **실제 사유**가 이긴다
        } else {
          unread.push({ name: u.name, why, from: 'extract' });
        }
      }
      // 실패로 안 잡힌 것은 읽힌 것이다
      for (const row of plan) if (row.read === undefined) row.read = !!row.readable;

      // ★ 양이 넘쳐 못 읽은 것도 **같은 목록**에 담는다. 따로 두면 화면이 한쪽만 그린다
      for (const o of overflow) unread.push(o);

      const facts = ((read && read.facts) || []).length;
      const documents = ((read && read.documents) || []).length;
      // ★ 실제로 OCR 이 **돈** 파일 수. 화면·앱이 「OCR 몇 건」을 적을 거면 이것을 쓴다
      const ocrCount = plan.filter(x => x.ocr && x.read).length;
      return ok({
        scanned: plan,
        unread,
        facts,
        documents,
        ocr: ocrCount,
        // ★ 값이 하나도 안 나왔으면 **그렇다고 말한다.** 화면이 다음 단계로
        //   넘어가기 전에 알아야 한다 — 넘어가면 빈 칸만 보게 된다
        empty: facts === 0,
        // ★ 남은 것이 있으면 **몇 개인지 말한다.** 「다시 누르면 이어서」가 사실이려면
        //   사용자가 남았다는 것을 알아야 한다
        remaining: overflow.length,
        // 1회성은 여기서 다시 못 읽는다. 그 사실을 숨기지 않는다
        oneshotNote: '1회성으로 올린 자료는 올릴 때 이미 읽었습니다 — 보관하지 않으므로 다시 읽지 않습니다.',
        at: kstStamp(new Date()),
      });
    },

    /**
     * PUT /projects/:id/hidden — 목록에서 **접거나 편다** 〈2026-08-24 사장님 지시:
     * 「지난 리스트는 삭제해줘 목록에서 혼란스러움」〉.
     *
     * ★★ **지우는 것이 아니다.** 폴더·자료·보고서는 그대로 있고 목록에서만
     *   안 보이게 한다. 여쭤 보고 「숨기기」로 정했다 — 목록에는 시험용과
     *   앱에서 가져온 **실제 딜**이 섞여 있고, 지우면 되돌릴 수 없다.
     *
     * ★ 쓰기다. 읽기 라우터가 아니라 **여기** 있어야 한다.
     * ★ 실패해도 던지지 않는다 (`hidden.set` 이 false 를 돌려준다). 다만
     *   **바뀌었는지(`changed`)를 그대로 말한다** — 「눌렀는데 아무 일도 안
     *   났다」를 화면이 알 수 있어야 한다.
     */
    async hideProject(ctx, projectId, body) {
      const e = checkId(projectId); if (e) return e;
      const hidden = load('core/hidden');
      const want = !(body && body.hidden === false);
      const changed = hidden.set(projectId, want);
      return ok({
        id: projectId, hidden: want, changed,
        note: want
          ? '목록에서만 접었습니다 — 폴더·자료·보고서는 그대로 있습니다.'
          : '목록에 다시 폈습니다.',
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
      // ★ 여기서도 목록에 얹는다 — 고쳐 쓴 주체가 다음번에 안 뜨면 이상하다
      issuerMod.remember(norm.value, kstStamp(new Date()));

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
        /* ★★ **목록이 한 곳에 더 있으면 갈린다** 〈2026-08-25 · 실제로 갈렸다〉.
         *   여기 이름을 손으로 적어 두는 바람에 화면이 보낸 `cadastral` 이
         *   **조용히 버려졌다** — 켰는데 안 켜지고, 오류도 안 난다.
         *   그래서 **사양이 아는 이름**을 그대로 쓴다 (단일 출처). */
        Object.keys(outputspec.VISUAL_DEFAULT).forEach((k) => {
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
            /* ★★★ **어디서 온 값인지를 화면에 넘긴다** 〈2026-08-25 사장님:
             *   「스캔, 읽는 흉내만 내지 실제 판독을 하지않음 거짓」〉.
             *
             *   화면이 「N 개의 값을 **자료에서 읽었습니다**」라고 적으면서
             *   **요청문에서 뽑은 값까지 세고 있었다.** 사장님 화면의 셋은
             *   전부 `user_request` 였다 — 자료에서 읽은 것이 하나도 없는데
             *   「자료에서 읽었다」고 적은 것이다.
             *
             * ★ 이 저장소의 전부가 그 구분이다 — **사용자가 말했다는 것은
             *   문서로 확인됐다는 뜻이 아니다.** 화면이 그걸 뭉갰다. */
            origin: f.origin || null,
            originGuessed: !!f.originGuessed,
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
        /**
         * ★★ **언제 읽었는지 함께 준다** 〈2026-08-23 사장님: 「데이터를 정말
         *   스캔했는지 모르겠다 알수 있는 방법이 좋을듯」〉.
         *
         *   값만 주면 화면은 「이 값이 지금 자료에서 나온 것인지, 지난주에
         *   나온 것인지」를 말할 수 없다. 자료를 새로 올린 뒤에도 옛 값이
         *   그대로 떠 있으면 **읽은 것으로 보인다.**
         *   `resolvedAt` 은 Dataset 이 저장될 때 KST 로 찍힌다.
         */
        readAt: (json && json.resolvedAt) || null,
        // ★ 값이 갈린 항목 수. 0 이 아니면 화면이 그 사실을 적는다
        conflicts: (json && Array.isArray(json.conflicts)) ? json.conflicts.length : 0,
        /**
         * ★★★ **읽은 것과 표에 들어온 것을 **둘 다** 준다** 〈2026-08-24 사장님 화면〉.
         *
         *   3단계는 「문서 15건에서 값 87개를 만들었습니다」라고 했는데
         *   4단계는 **「2개」**만 보여 줬다. 그 둘이 같은 화면에 없으니
         *   **어디서 없어졌는지 물어볼 수조차 없다** — 「안 읽혔나」와
         *   「읽었는데 표에 안 들어왔나」가 구분이 안 된다.
         *
         * ★ 값 87개는 **항목 87개가 아니다.** 같은 항목을 여러 문서에서
         *   뽑으면 표에서는 한 줄이 되고, 항목표(FIELDS)에 없는 값은
         *   애초에 들어오지 않는다. 그 셈을 화면이 말할 수 있어야 한다.
         * ★ 버려진 값(REJECTED)도 센다 — 조용히 버려지는 것이 가장 나쁘다.
         */
        extraction: (() => {
          const ex = store.readJson(projectId, '01_Project/extraction.json', null);
          if (!ex) return null;
          return {
            at: ex.at || null,
            documents: Array.isArray(ex.documents) ? ex.documents.length : 0,
            factCount: ex.factCount || 0,
            unsupported: Array.isArray(ex.unsupported) ? ex.unsupported.length : 0,
          };
        })(),
        rejected: (json && Array.isArray(json.conflicts))
          ? json.conflicts.filter((c) => c && c.type === 'REJECTED').length : 0,
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

      /**
       * ★★ **이 서버에 브라우저가 있는가** 〈2026-08-21 · 본체 인수인계 교차검증〉.
       *
       * 운영 NAS 에는 크롬이 없다. 그러면 PDF 세 종은 **원리상 안 나온다** —
       * 기다려도 안 나온다. 그런데 지금까지 화면은 그것을 「아직 안 나왔다」로
       * 그렸고, 사용자는 나올 때까지 기다리거나 고장으로 읽었다.
       *
       * ★ 여기서 하는 일은 둘이다:
       *   ① 분모에서 뺀다 — 안 그러면 **어떤 딜도 100% 가 되지 않는다**
       *   ② 목록에는 남기고 **왜 못 나오는지 적는다** — 지우면 「나올 수 있는
       *      문서가 있었다」는 사실까지 사라진다
       *
       * ★ 못 찾겠으면 `null` 로 둔다. **모르는 것을 「없다」로 그리지 않는다** —
       *   그러면 되는 서버에서 PDF 가 목록에서 사라진다.
       */
      let hasBrowser = null;
      try { hasBrowser = !!load('core/raster').findBrowser(); } catch (_) { hasBrowser = null; }
      const NO_BROWSER = '이 서버에는 브라우저가 없어 PDF 를 만들 수 없습니다 — '
        + '최종본은 12_Final/im-a4.html 로 나옵니다';

      const all = OUTPUTS.map((o) => {
        const full = path.join(dir, o.rel);
        let stat = null;
        try { stat = fs.statSync(full); } catch (_) { stat = null; }
        // ★ 못 나오는 이유가 있으면 **그것이 이긴다.** 「사양에 PDF 를 넣으세요」라고
        //   안내해 놓고 넣어도 안 나오면, 사용자는 자기가 잘못한 줄 안다
        const blockedByBrowser = !!o.needsBrowser && hasBrowser === false;
        return {
          id: o.id, name: o.name, path: o.rel,
          when: o.when,
          why: blockedByBrowser ? NO_BROWSER : (o.why || null),
          // 화면이 「기다리면 나온다」와 「여기서는 안 나온다」를 갈라 그릴 수 있게 한다
          impossible: blockedByBrowser,
          needsBrowser: !!o.needsBrowser,
          expected: isExpected(o, spec, hasBrowser),
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
        // ★ 서버가 무엇을 못 하는지 화면에 그대로 넘긴다. 화면이 짐작하지 않는다.
        //   `null` = 판정하지 못했다 (모름과 없음을 구분한다)
        hasBrowser,
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
/**
 * 쓰기 라우트 — **표가 단일 출처다** (`ui/routes.cjs` 참조).
 *
 * ★★ **차례가 규칙이다.** `/sources/verify` 를 `/sources/:name` 보다 먼저 두지
 *   않으면 「verify 라는 이름의 파일을 지워라」로 잡힌다. `/linked/verify` 도 같다.
 *   줄을 옮길 때 그 둘의 앞뒤를 반드시 지킨다 (테스트가 고정한다).
 *
 * ★ NAS 서버는 이 배열을 그대로 걸어야 한다. 손으로 옮기면 라우트가 늘 때
 *   그쪽만 모르고 404 가 난다 — 실제로 11개가 빠졌다 (2026-08-18).
 */
const ROUTES = [
  { method: 'POST', path: '/projects', handler: 'createProject', call: (h, req) => h.createProject(req, req.body) },

  { method: 'POST', path: '/projects/:id/sources', handler: 'uploadSources', call: (h, req, p) => h.uploadSources(req, p.id, req.body) },
  { method: 'GET', path: '/projects/:id/sources', handler: 'listSources', call: (h, req, p) => h.listSources(req, p.id) },
  // ★ 지우기·되돌리기·비우기·대조는 **길을 따로 낸다.** 올리기와 같은 자리에 두면
  //   실수로 지우는 요청이 올리기로 읽히거나 그 반대가 된다.
  { method: 'POST', path: '/projects/:id/sources/restore', handler: 'restoreSource', call: (h, req, p) => h.restoreSource(req, p.id, req.body) },
  { method: 'POST', path: '/projects/:id/sources/purge', handler: 'purgeSources', call: (h, req, p) => h.purgeSources(req, p.id, req.body) },
  { method: 'POST', path: '/projects/:id/sources/verify', handler: 'verifySources', call: (h, req, p) => h.verifySources(req, p.id) },
  { method: 'DELETE', path: '/projects/:id/sources/:name', handler: 'deleteSource', call: (h, req, p) => h.deleteSource(req, p.id, p.name) },

  // 연결 자료 — 보관하지 않는 쪽 (D-65). /verify 를 :key 보다 먼저 둔다
  { method: 'GET', path: '/projects/:id/linked', handler: 'listLinked', call: (h, req, p) => h.listLinked(req, p.id) },
  { method: 'POST', path: '/projects/:id/linked', handler: 'linkSource', call: (h, req, p) => h.linkSource(req, p.id, req.body) },
  { method: 'POST', path: '/projects/:id/linked/verify', handler: 'verifyLinked', call: (h, req, p) => h.verifyLinked(req, p.id) },
  { method: 'DELETE', path: '/projects/:id/linked/:key', handler: 'unlinkSource', call: (h, req, p) => h.unlinkSource(req, p.id, p.key) },

  // 1회성 직접 올리기 — 저장소를 안 쓰는 사람의 길 (D-66). 보관하지 않는다
  { method: 'POST', path: '/projects/:id/oneshot', handler: 'oneshotUpload', call: (h, req, p) => h.oneshotUpload(req, p.id, req.body) },
  { method: 'GET', path: '/projects/:id/oneshot', handler: 'listOneshot', call: (h, req, p) => h.listOneshot(req, p.id) },
  {
    method: 'PUT', path: '/projects/:id/hidden', handler: 'hideProject',
    call: (h, req, p) => h.hideProject(req, p.id, req.body),
  },
  // ★ 넣은 자료를 **값으로** 만든다 — 셋(보관·연결·앱첨부)을 한 길로 (2026-08-21)
  { method: 'POST', path: '/projects/:id/scan', handler: 'scanSources', call: (h, req, p) => h.scanSources(req, p.id, req.body) },

  { method: 'PUT', path: '/projects/:id/issuer', handler: 'saveIssuer', call: (h, req, p) => h.saveIssuer(req, p.id, req.body) },
  { method: 'GET', path: '/projects/:id/spec', handler: 'getSpec', call: (h, req, p) => h.getSpec(req, p.id) },
  { method: 'POST', path: '/projects/:id/spec', handler: 'saveSpec', call: (h, req, p) => h.saveSpec(req, p.id, req.body) },
  { method: 'POST', path: '/projects/:id/spec/confirm', handler: 'confirmSpec', call: (h, req, p) => h.confirmSpec(req, p.id, req.body) },
  { method: 'GET', path: '/projects/:id/facts', handler: 'getFacts', call: (h, req, p) => h.getFacts(req, p.id) },
  { method: 'PUT', path: '/projects/:id/facts', handler: 'saveFacts', call: (h, req, p) => h.saveFacts(req, p.id, req.body) },
  { method: 'GET', path: '/projects/:id/reports', handler: 'listReports', call: (h, req, p) => h.listReports(req, p.id) },
  // ★ 파일은 JSON 이 아니다 — 성공하면 파일을, 실패하면 평소처럼 JSON 사유를 보낸다.
  //   부르는 쪽이 그 구분을 알아야 하므로 kind 를 붙인다
  {
    method: 'GET', path: '/projects/:id/file', handler: 'getFile', kind: routes.KIND.FILE,
    call: (h, req, p) => h.getFile(req, p.id, req.query && req.query.rel),
  },
  { method: 'POST', path: '/projects/:id/reports', handler: 'generate', call: (h, req, p) => h.generate(req, p.id, req.body) },
];

function createRouter(deps = {}) {
  let express;
  try {
    express = require('express');
  } catch (_) {
    throw new Error('express 를 찾을 수 없다 — createHandlers() 를 직접 사용하라');
  }
  // ★ 등록을 여기서 다시 적지 않는다 — 표를 건다 (routes.cjs)
  return routes.mount(express.Router(), ROUTES, createHandlers(deps), {
    sendFile: (res, r) => {
      res.set(r.headers || {});
      return res.sendFile(r.file);
    },
  });
}

module.exports = {
  createHandlers, createRouter, ROUTES, DOC_PLANS, OUTPUTS, isExpected, FILES_PLAN,
  PLAN_RANK, PROJECT_ID, CONTENT_TYPES,
  MAX_FILE_BYTES, MAX_REQUEST_BYTES,
};
