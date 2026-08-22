'use strict';
/**
 * routes.cjs — **라우트 표를 코드가 아니라 데이터로 갖는다** (2026-08-18).
 *
 * ★★ 왜 만들었나: NAS 의 서버 파일(`im-engine-server.cjs`)이 라우트 등록을
 *   **손으로 옮겨 적고** 있었다. 엔진에 라우트가 늘어도 그쪽은 모르므로,
 *   **새 라우트 11개가 빠진 채 404 가 났다**(2026-08-18 본체 실측).
 *   오류 메시지는 「없는 주소」라서, 원인이 「서버가 옛 표를 들고 있다」라는 것은
 *   양쪽을 나란히 놓고 세어 보기 전까지 보이지 않는다.
 *
 * ★ 그래서 표가 **단일 출처**다. `createRouter()` 도 이 표에서 만든다 —
 *   표와 실제 등록이 갈릴 수가 없다(테스트가 그것을 고정한다).
 *
 * ★ **express 를 요구하지 않는다.** `match()` 하나면 순수 http 서버도 같은 표로
 *   길을 찾을 수 있다. 프레임워크를 강요하면 결국 또 손으로 옮기게 된다.
 */

/** `/projects/:id/file` 처럼 JSON 이 아닌 것 — 부르는 쪽이 알아야 한다 */
const KIND = { JSON: 'json', FILE: 'file' };

/**
 * 길 하나를 맞춰 본다. **등록 순서를 지킨다** — 앞의 것이 먼저다.
 *
 * ★ 순서가 뜻을 바꾼다: `/sources/verify` 를 `/sources/:name` 보다 **먼저** 두지
 *   않으면 「verify 라는 이름의 파일을 지워라」로 잡힌다. 표의 차례가 곧 규칙이다.
 *
 * @returns {{route, params}|null}
 */
function match(routes, method, pathname) {
  const want = String(method || '').toUpperCase();
  const got = String(pathname || '').split('?')[0].split('/').filter(Boolean);
  for (const route of routes) {
    if (route.method !== want) continue;
    const parts = route.path.split('/').filter(Boolean);
    if (parts.length !== got.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i][0] === ':') {
        // 빈 조각을 값으로 받지 않는다 — `/projects//sources` 가 id='' 로 통과하면
        // 그 뒤 검사들이 전부 「모르는 프로젝트」로 엉뚱하게 답한다
        if (!got[i]) { ok = false; break; }
        params[parts[i].slice(1)] = decodeURIComponent(got[i]);
      } else if (parts[i] !== got[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

/**
 * express 라우터에 표를 그대로 건다. **여기서만 등록한다** —
 * 라우터마다 따로 적으면 그 순간 표가 사본이 된다.
 */
function mount(router, routes, h, opt) {
  const o = opt || {};
  const send = o.send || ((res, r) => res.status(r.status).json(r.body));
  const sendFile = o.sendFile;
  routes.forEach((route) => {
    const verb = route.method.toLowerCase();
    router[verb](route.path, async (req, res, next) => {
      try {
        const r = await route.call(h, req, req.params || {});
        if (route.kind === KIND.FILE && r && r.file && sendFile) return sendFile(res, r);
        return send(res, r);
      } catch (e) { return next(e); }
    });
  });
  return router;
}

/** 사람이 읽는 목록 — 문서·점검 스크립트가 이걸 쓴다 (손으로 세지 않게) */
function list(routes) {
  return routes.map(r => r.method + ' ' + r.path);
}

module.exports = { match, mount, list, KIND };
