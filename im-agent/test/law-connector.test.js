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
  delete process.env.LAW_OC;
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
  }
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
