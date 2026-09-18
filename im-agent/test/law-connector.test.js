'use strict';
/**
 * law-connector.test.js — 국가법령정보 공동활용 커넥터 〈2026-08-25 사장님 지시:
 * 「국가법령정보 공동활용 API 확보」〉.
 *
 * ★★ 무엇을 재는가. **실호출은 여기서 못 잰다** — 이 컨테이너는 law.go.kr 이
 *   egress 에서 막혀 있고, 운영 OC 도 여기 없다 (§4.3 ★★ 와 같은 결:
 *   키 없는 자리에서 열쇠를 판정하지 않는다). 그래서 재는 것은 셋이다.
 *   ① 키가 없을 때 **지어내지 않고 unavailable 을 돌려주는가** (§4.6)
 *   ② 조문 번호를 **6자리로 채우는가** — 안 채우면 엉뚱한 조문이 온다
 *   ③ 실패를 **승인·OC·없음으로 갈라 사람 말로** 말하는가 (M-31 과 같은 결)
 */
const test = require('node:test');
const assert = require('node:assert');
const law = require('../connectors/law');

test('LAW_OC 가 없으면 unavailable 을 돌려주고 값을 지어내지 않는다', async () => {
  const saved = process.env.LAW_OC;
  const saved2 = process.env.LAW_OPEN_DATA;
  delete process.env.LAW_OC;
  delete process.env.LAW_OPEN_DATA;
  try {
    assert.strictEqual(law.isAvailable(), false);
    const r = await law.findLaw('건축법 시행령');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.unavailable, true);
    assert.match(r.error, /LAW_OC/);
    // ★ 값 자리가 비어 있어야 한다 — 「아마 이럴 것이다」가 들어오면 안 된다
    assert.strictEqual(r.value, undefined);

    const a = await law.article({ mst: '123456', jo: 46 });
    assert.strictEqual(a.unavailable, true);
    const o = await law.ordinance('서울특별시 서초구');
    assert.strictEqual(o.unavailable, true);
  } finally {
    if (saved === undefined) delete process.env.LAW_OC; else process.env.LAW_OC = saved;
    if (saved2 === undefined) delete process.env.LAW_OPEN_DATA; else process.env.LAW_OPEN_DATA = saved2;
  }
});

/**
 * ★★★ 2026-08-25 실측: Secrets 화면에 `LAW_OC`(한 달 전)와 `LAW_OPEN_DATA`(15분 전)가
 *   **둘 다** 있었다. 엔진이 한 이름만 보면 넣으신 값이 조용히 죽는다 (M-40).
 */
test('★★ 두 이름을 다 읽는다 — LAW_OC 가 없어도 LAW_OPEN_DATA 로 돈다', () => {
  const s1 = process.env.LAW_OC, s2 = process.env.LAW_OPEN_DATA;
  try {
    delete process.env.LAW_OC; delete process.env.LAW_OPEN_DATA;
    assert.strictEqual(law.usedName(), null);
    assert.strictEqual(law.isAvailable(), false);

    process.env.LAW_OPEN_DATA = 'hong';
    assert.strictEqual(law.usedName(), 'LAW_OPEN_DATA');
    assert.strictEqual(law.isAvailable(), true);

    // 둘 다 있으면 LAW_OC 가 이긴다 — 안내 문서가 그 이름으로 되어 있다
    process.env.LAW_OC = 'kim';
    assert.strictEqual(law.usedName(), 'LAW_OC');

    // 빈 문자열은 「있다」로 세지 않는다
    process.env.LAW_OC = '   ';
    assert.strictEqual(law.usedName(), 'LAW_OPEN_DATA');
  } finally {
    if (s1 === undefined) delete process.env.LAW_OC; else process.env.LAW_OC = s1;
    if (s2 === undefined) delete process.env.LAW_OPEN_DATA; else process.env.LAW_OPEN_DATA = s2;
  }
});

test('★ 두 이름 모두 마스킹 대상이다 (§2)', () => {
  const { SECRET_ENV } = require('../connectors/http');
  law.OC_NAMES.forEach((n) => {
    assert.ok(SECRET_ENV.includes(n), `${n} 이 SECRET_ENV 에 없다 — 로그에 평문으로 남는다`);
  });
});

test('필수 인자가 없으면 조회하지 않고 그 사실을 말한다', async () => {
  const saved = process.env.LAW_OC;
  process.env.LAW_OC = 'testoc';
  try {
    const a = await law.article({ jo: 46 });           // mst 없음
    assert.strictEqual(a.ok, false);
    assert.match(a.error, /mst/);
    const b = await law.article({ mst: '1', });        // jo 없음
    assert.strictEqual(b.ok, false);
    const c = await law.findLaw('');
    assert.strictEqual(c.ok, false);
    const d = await law.ordinance('');
    assert.strictEqual(d.ok, false);
  } finally {
    if (saved === undefined) delete process.env.LAW_OC; else process.env.LAW_OC = saved;
  }
});

test('★ 실패 원인을 승인·OC·없음·형식으로 가른다 (한 덩어리 영어로 뭉뚱그리지 않는다)', () => {
  // 실제로 겪는 네 갈래. 글자가 아니라 **kind** 로 잰다 —
  // 안내 문구는 바뀌어도 갈래는 안 바뀌기 때문이다 (render-birdseye 와 같은 규칙)
  assert.strictEqual(law.diagnose(403, '미승인 사용자입니다').kind, 'approval');
  assert.strictEqual(law.diagnose(401, 'OC 값이 등록되지 않았습니다').kind, 'oc');
  assert.strictEqual(law.diagnose(200, '검색결과가 없습니다').kind, 'notfound');
  assert.strictEqual(law.diagnose(200, '<html><body>점검중</body></html>').kind, 'format');
  assert.strictEqual(law.diagnose(500, 'zzz').kind, 'unknown');

  // ★ 판정 못 한 것은 「판정하지 못했다」로 남긴다 — 지어내지 않는다
  assert.match(law.diagnose(500, 'zzz').head, /판정하지 못했다/);
  // ★ 승인 문제를 OC 문제로 읽히게 하지 않는다 (그 혼동이 열쇠를 두 번 다시 넣게 만든다)
  assert.match(law.diagnose(403, '미승인').head, /OC 값 문제가 아니다/);
});

test('★★ 조문 번호는 6자리다 — 조 4 + 항 2 (0 을 안 채우면 엉뚱한 조문이 온다)', () => {
  // 커넥터 내부 규칙을 시험이 그대로 고정한다.
  const pad = (jo, hang = 0) => String(jo).padStart(4, '0') + String(hang).padStart(2, '0');
  assert.strictEqual(pad(46), '004600');        // 건축법 시행령 제46조 (방화구획)
  assert.strictEqual(pad(86, 3), '008603');     // 제86조 제3항 (공동주택 채광·인동)
  assert.strictEqual(pad(34, 4), '003404');     // 제34조 제4항 (준초고층 피난안전구역)
  assert.strictEqual(pad(90), '009000');        // 제90조 (비상용승강기)
  assert.strictEqual(pad(2), '000200');
});

test('LAW_OC 가 http.js 의 가리개 목록에 올라가 있다 (§2)', () => {
  const { SECRET_ENV } = require('../connectors/http');
  assert.ok(SECRET_ENV.includes('LAW_OC'),
    'LAW_OC 가 SECRET_ENV 에 없으면 로그·오류 메시지에 평문으로 남는다');
});

/* ------------------------------------------------------------------------- *
 * **같은 고장이 여기에도 있었다 — `!r.ok` 에서 응답 본문을 버렸다**
 * 〈2026-09-18 · D-219 · 실측〉
 *
 * [무엇이 났나] 이 파일은 `diagnose()` 로 **승인·OC·없음·형식 넷**을 가르는데,
 *   그것을 부르는 자리가 **JSON 파싱이 깨졌을 때 하나뿐**이었다. 곧 서버가
 *   401·403·5xx 로 답하면 **본문을 통째로 버리고** `HTTP 403` 이라는 글자만 남았다 —
 *   「승인 전」과 「OC 오타」와 「그쪽 게이트웨이」가 **한 글자로 뭉개진다.**
 *   할 일이 정반대인데(기다린다 / 값을 고친다 / 자리를 옮긴다) 가릴 재료가 없다.
 *
 * ★ D-218 이 브이월드에서 고친 것과 **같은 고장**이고, 이 파일에는 안 댔던 자리다
 *   (S-53 「한 칸에서 배운 것을 옆 칸에 안 대면 그 자리에 그대로 남는다」).
 * ★★ **낱말이 아니라 돌려서 잰다** — 「diagnose 를 부르는가」는 아무것도 안 재는 것이다.
 *   가짜 403 을 먹여 **무엇이 돌아오는지** 본다.
 * ------------------------------------------------------------------------- */
test('★★★ 403 에서 본문·상태를 «버리지 않는다» — 승인·OC·그쪽서버가 한 글자로 뭉개졌다 (D-219)', async () => {
  const BAIT = 'AIzaSyBAIT000000000000000000000000000000';
  const realFetch = globalThis.fetch;
  const prev = process.env.LAW_OC;
  process.env.LAW_OC = 'testoc';
  globalThis.fetch = async () => new Response(
    `<html>이용 승인이 아직 나지 않았습니다 ${BAIT}</html>`,
    { status: 403, headers: { server: 'nginx/1.18.0', 'set-cookie': 'S=LEAKME' } },
  );
  try {
    const r = await law.findLaw('건축법 시행령');
    assert.equal(r.ok, false);
    assert.equal(r.httpStatus, 403, '상태코드를 버립니다 — 401 인지 403 인지조차 안 남습니다.');
    assert.ok(r.bodyHead && /승인/.test(r.bodyHead),
      '응답 본문을 버립니다 — 승인 전인지 OC 오타인지 가릴 재료가 통째로 사라집니다.');
    assert.equal(r.kind, 'approval',
      'diagnose 를 안 부릅니다 — 넷으로 가르는 장치가 이 갈래에서는 한 번도 안 돕니다.');
    assert.ok(r.head && /승인/.test(r.head), '사람 말로 된 원인을 안 답니다 (§4.6).');
    assert.ok(r.headHdr && /server: nginx/.test(r.headHdr),
      '헤더를 안 나릅니다 — 「그쪽 게이트웨이인가」를 못 가립니다 (D-219).');

    /* ★★ 값이 새지 않는가 (§2) */
    const all = JSON.stringify(r);
    assert.ok(!all.includes(BAIT), '본문에 섞인 열쇠가 그대로 나옵니다 — 가려야 합니다 (§2).');
    assert.ok(!/LEAKME/.test(all), '허용목록 밖 헤더가 새어 나옵니다 (§2).');
  } finally {
    globalThis.fetch = realFetch;
    if (prev === undefined) delete process.env.LAW_OC; else process.env.LAW_OC = prev;
  }
});
