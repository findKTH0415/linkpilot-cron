// scripts/probe-lib.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다.
//
// **진단 공용 창구** 〈2026-09-20 · D-247〉
//
// ★★★ **왜 한 벌인가** (CLAUDE.md §8-1). 진단이 둘이 되는 순간(길찾기 · 날씨)
//   `probe`·`verdictOf`·`sayRow` 를 **두 벌로 적을 자리**가 생긴다. 그러면 같은
//   HTTP 응답에 **다른 사람 말**이 붙고, 한쪽만 고쳐진다 — §12-32 의 `fmtHeaders`
//   와 **같은 자리**다. 판정 번호(0·2·3·4·5)의 **뜻이 갈리는 것**이 특히 나쁘다:
//   값마다 사장님이 하실 일이 정반대라, 뜻이 갈리면 **틀린 곳을 가리킨다** (§4.6).
//
// ★★ **값은 한 글자도 안 남긴다** (§2). 이 저장소는 공개다 (D-10) —
//   본문·경로·오류 글이 전부 `redact()` 를 지나간다.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { redact } = require('../im-agent/connectors/http');

export { redact };

/** 열쇠 이름 여럿 중 먼저 든 것을 쓴다. 값은 **쓰는 자리에서만** 읽는다.
 *  ★ 이름이 갈리면 아무 오류도 안 나고 조용히 죽는다
 *    (`ECOS_API_KEY`/`ECOS_BOK_KEY` · `LAW_OC`/`LAW_OPEN_DATA` 에서 두 번 당했다). */
export function pick(names) {
  const n = names.find((x) => (process.env[x] || '').trim());
  return n ? { name: n, value: String(process.env[n]).trim() } : null;
}

/* ★★★ **인증 거부는 «상태코드»로만 못 가른다** 〈2026-09-19 · 실측 · D-229〉.
   ODsay 는 **HTTP 200** 으로 주고 본문에 `[ApiKeyAuthFailed]` 를 넣는다 —
   상태코드만 보면 「값을 못 뽑았다(규격을 고쳐라)」로 세지고, 그 글은
   **「열쇠 문제가 아니다」**라고 **정반대**를 말한다. §4.2 가 이미 적어 둔 그 자리다:
   「키 문제와 구분하려면 **응답 본문을 봐야 한다** — 상태코드만 보면 둘이 같아 보인다」.
   ★ 낱말을 지어내지 않는다 — **실측한 것**과 §4.2 의 표에 있는 것만 적는다. */
export const AUTH_FAIL_RE =
  /ApiKeyAuthFailed|authentication failed|INVALID_KEY|SERVICE_KEY_IS_NOT_REGISTERED|NOT_REGISTERED|UNAUTHORIZED|SERVICE_ACCESS_DENIED/i;

/* ★★★ **「우리 자리의 문지기가 막은 403」을 «인증 거부»로 적지 않는다**
   〈2026-09-20 · 실측 · D-247〉.
   [무엇이 났나] 이 개발 컨테이너의 나가는 길에 문지기가 있어, 허용 목록에 없는
   호스트를 **HTTP 403** 과 「Host not in allowlist …」 본문으로 막는다. 그런데
   `verdictOf` 는 403 을 보고 **판정 4(인증 거부 — 열쇠·신청을 보라)** 라고 적었다.
   기관 서버에는 **한 번도 안 닿았는데** 그 글은 사장님을 **콘솔로 보낸다** —
   거기에는 고칠 것이 없다 (M-86 · §4.6 · §12-12 와 **같은 결**).
   ★ **D-206 이 세운 그 잣대다** — 「못 닿음」을 「승인 안 됨」으로 적지 않는다.
     할 일이 정반대다: 앞은 **도는 자리를 옮기는 일**, 뒤는 **열쇠를 보는 일**.
   ★★ **낱말을 지어내지 않는다** — 실측한 글자만 적는다. 넓히면 기관이 보낸
     멀쩡한 거부까지 「못 닿았다」로 접혀 **반대로 틀린다** (§4.6 의 그 잣대).
   ★ 그리고 이것은 **새 판정 번호가 아니다** — 「못 닿았다(3)」가 곧 사실이다. */
export const GATEWAY_BLOCK_RE = /Host not in allowlist|network egress settings|__agentproxy/i;

/** 응답 JSON 을 훑어 **그 칸이 어디에 있는지**를 적는다 〈2026-09-19 · D-230〉.
 *
 * ★★★ **왜 필요한가.** `gotValue` 는 「그 칸이 **왔다**」까지만 말한다. 배선하려면
 *   **어느 경로에 있는지**를 알아야 하는데, 요약에 실리는 것은 앞머리 300자뿐이라
 *   `routes[0].summary.duration` 자리가 **안 보인다.** 그러면 경로를 **추측으로** 박게 되고,
 *   §4.3 이 금한 그 자리다 — R-ONE 은 이것을 안 해서 **여섯 번 다시 썼다.**
 *   ★ 「대답이 왔다」·「값이 왔다」에 이어 **「그 값이 어디 있다」**가 셋째 사실이다.
 *
 * ★★ **경로와 숫자만 담는다** (§2 · 이 저장소는 공개다 · D-10).
 *
 * ★ **JSON 으로 못 읽으면 「못 쟀다」로 적는다** — 빈 것으로 두면 「그 칸이 **없다**」와
 *   같은 값이 되어, 이름만 다른 멀쩡한 응답을 「규격이 틀렸다」로 읽게 된다 (§8 · §12-12).
 */
export function findFields(body, re, max = 4) {
  let root;
  try { root = JSON.parse(body); } catch (_) { return { parsed: false, hits: [] }; }
  const hits = [];
  /* ★ `g` 가 붙은 잣대는 `lastIndex` 를 들고 다녀 **두 번째 칸부터 조용히 빗나간다** */
  const isField = (k) => { re.lastIndex = 0; return re.test(k); };
  const walk = (node, at, depth) => {
    if (hits.length >= max || depth > 12 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length && hits.length < max; i += 1) walk(node[i], `${at}[${i}]`, depth + 1);
      return;
    }
    for (const k of Object.keys(node)) {
      if (hits.length >= max) return;
      const v = node[k];
      const p = at ? `${at}.${k}` : k;
      if (isField(k) && typeof v === 'number') hits.push({ path: p, value: v });
      else walk(v, p, depth + 1);
    }
  };
  walk(root, '', 0);
  return { parsed: true, hits };
}

/**
 * 한 후보를 걸어 보고 **무엇이 왔는지 그대로** 돌려준다.
 * ★ 던지지 않는다 — 걸린 것이 곧 우리가 알고 싶은 것이다 (§4.6).
 */
export async function probe(label, url, init, valueRe, fieldRe) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    const flat = body.replace(/\s+/g, ' ').trim();
    return {
      label, ok: r.ok, status: r.status, ms: Date.now() - t0,
      /* 값 판정은 **자르기 전 본문 전체**로 한다. 앞머리만 보면 값이 왔는데
         「못 뽑았다」가 되고, 그 글이 「규격을 고치라」고 틀린 곳을 가리킨다
         (실측 D-228: 카카오의 소요시간 칸이 앞 300자 밖이라 판정 5 가 나왔다).
         잣대는 하나다 — 「그 숫자를 재는 법이 재려는 것을 다 덮는가」 (§6-2-6). */
      gotValue: Boolean(r.ok && valueRe && valueRe.test(flat)),
      /* ★ 200 으로 오는 인증 거부를 잡는다 — 본문 전체로 본다 (D-229) */
      authFail: AUTH_FAIL_RE.test(flat),
      /* ★ **우리 자리의 문지기**가 막은 것인가 — 기관에는 안 닿았다 (D-247) */
      blocked: GATEWAY_BLOCK_RE.test(flat),
      /* ★★★ **그 칸이 «어디»에 있는지**까지 잰다 — 배선은 잰 값으로 한다 (D-230 · §4.3).
         본문«원문»을 넘긴다: `flat` 은 문자열 안의 빈칸까지 접어 값을 바꾼다 */
      fields: fieldRe ? findFields(body, fieldRe) : null,
      /* ★ 본문 전체는 이 함수 밖으로 안 나간다 — 요약에 실리는 것은 앞머리뿐이다 (§2) */
      head: redact(flat.slice(0, 300)),
      truncated: flat.length > 300,
      server: r.headers.get('server') || null,
    };
  } catch (e) {
    return { label, ok: false, status: null, ms: Date.now() - t0, gotValue: false, authFail: false, blocked: false,
      /* ★ 오류 글도 **가린다** — ODsay 는 열쇠를 «주소»에 실으므로, 그 주소가 섞인
         오류가 오면 그 자리에서 샌다. 이 저장소는 공개다 (§2 · D-10) */
      fields: null, transport: redact(String((e && e.message) || e)) };
  }
}

/** 한 후보가 무엇을 돌려줬는지 사람이 읽게 적는다 — 진단 둘이 **같은 글**을 쓴다 (§8-1).
 *  ★ 「대답이 왔다」와 「값이 왔다」를 **갈라** 적는다 — 둘을 뭉뚱그리면
 *    HTTP 200 하나를 보고 「됐다」로 읽힌다.
 *  @param P 한 줄을 적는 손. 진단마다 제 로그를 들고 있어 **밖에서 받는다.**
 *  @param want 그 진단이 찾는 칸의 사람 말 (「소요시간」·「관측값」) */
export function sayRow(P, r, want = '값') {
  P(`- \`${r.label}\` — ${r.status == null ? `**못 닿음** (${r.transport})` : `HTTP ${r.status}`} · ${r.ms}ms`);
  if (r.head) P(`  - 본문 «${r.head}»${r.truncated ? ' …' : ''}`);
  if (r.truncated) P('  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)');
  if (r.status != null) P(`  - ${want} 칸: ${r.gotValue ? '**찾았다**' : '**못 찾았다**'}`);
  /* ★ 「왔다」와 「어디 있다」는 다른 사실이다 — 경로를 적어야 추측 없이 배선한다 (D-230) */
  if (r.fields && !r.fields.parsed) {
    P('  - ★ 본문을 **JSON 으로 못 읽었다** — 칸 자리는 **못 쟀다** (값 판정은 글자로 했다)');
  } else if (r.fields) {
    for (const h of r.fields.hits) P(`  - 칸 \`${redact(h.path)}\` = ${h.value}`);
    if (!r.fields.hits.length) P('  - 칸 자리: **못 찾았다** — JSON 은 읽었으니 **이름이 다른 것**이다');
  }
  if (r.blocked) P('  - ★ **우리 자리의 문지기가 막았다** — 기관 서버에는 **안 닿았다**. 열쇠 문제가 아니다 (D-247)');
  if (r.authFail) P('  - ★ 본문이 **인증 거부**를 말한다 — 상태코드가 200 이어도 그렇다 (D-229)');
  if (r.server) P(`  - 서버 ${r.server}`);
}

/* ★★★ **갈래를 가른다 — 값마다 사장님이 하실 일이 정반대다** (§12-24 의 그 규칙).
   0 값이 왔다 · 2 열쇠가 없다 · 3 못 닿았다 · 4 인증 거부 · 5 대답은 왔는데 값을 못 뽑았다 */
export function verdictOf(rows) {
  if (!rows.length) return { code: 2, head: '열쇠가 없다 — 넣으시면 그날 잰다. 여기서 부른 적이 없다' };
  if (rows.some((r) => r.gotValue)) return { code: 0, head: '**값이 왔다** — 이 후보로 배선한다' };
  /* ★★★ **「닿은 줄」만 보고 판정한다** (D-247). 상태코드를 못 받은 것과, 받았지만
     그것이 **우리 자리의 문지기**가 보낸 것은 **둘 다 기관에 안 닿은 것**이다.
     뒤엣것을 인증 거부로 세면 **고칠 것이 없는 콘솔**을 가리킨다 (§4.6 · D-206). */
  const reached = rows.filter((r) => r.status != null && !r.blocked);
  if (!reached.length) {
    const gate = rows.some((r) => r.blocked);
    return { code: 3, head: '**못 닿았다** — 기관 서버의 대답을 한 번도 못 받았다. '
      + (gate ? '★ 403 이 왔지만 그것은 **우리 자리의 문지기**가 보낸 것이다. ' : '')
      + '**열쇠 문제가 아니다** (다시 넣거나 신청하실 일이 아니다). 도는 자리를 옮겨 다시 잰다' };
  }
  /* ★★★ 상태코드«와» 본문을 함께 본다 — 200 으로 오는 인증 거부가 있다 (D-229 · §4.2) */
  if (reached.some((r) => r.status === 401 || r.status === 403 || r.authFail)) {
    return { code: 4, head: '**인증이 거부됐다** — 열쇠 자체이거나 **그 서비스 등록·신청**이 안 된 것이다. '
      + '★ 상태코드가 **200 이어도** 본문이 그렇게 말하는 곳이 있다(ODsay 가 그렇다). '
      + '아래 응답 본문이 둘 중 어느 쪽인지 말해 준다' };
  }
  return { code: 5, head: '대답은 왔는데 **값을 못 뽑았다** — 주소·파라미터 규격이 다르다. '
    + '**열쇠 문제가 아니다.** 아래 본문을 보고 배선을 고친다' };
}

/* ★★★ **갈래 번호만 적지 않는다 — 뜻을 함께 적는다.** 「판정 3」만 보이면
   무엇을 하실지가 안 보이고, 그때 사장님은 **고칠 것이 없는 자리를 보러 가신다**
   (§4.6 「원인을 사람 말로 적는다」 · §12-24 의 그 규칙). 값마다 할 일이 정반대다. */
export const MEAN = {
  0: '값이 왔다 — 배선할 수 있다',
  2: '열쇠가 없다 — 넣으시면 그날 잰다',
  3: '못 닿았다 — **열쇠 문제가 아니다.** 도는 자리를 옮겨 다시 잰다',
  4: '인증이 거부됐다 — 열쇠이거나 그 서비스 신청이다',
  5: '대답은 왔는데 값을 못 뽑았다 — **규격**을 고친다. 열쇠 문제가 아니다',
};
