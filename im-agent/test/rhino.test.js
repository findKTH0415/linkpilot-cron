'use strict';
/**
 * rhino.test.js — Rhino.Compute + Grasshopper Connector.
 *
 * 이 커넥터의 위험은 **우리가 만든 숫자가 근거처럼 쓰이는 것**이다.
 * 매스 스터디 결과는 공부(公簿)에서 온 값과 화면에서 구분되지 않는다 —
 * 「연면적 32,000㎡」는 어느 쪽이든 똑같이 생겼다. 그래서 생성물 표시가
 * 붙어 있는지, fact 로 등록되지 않는지를 테스트로 못 박는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const rhino = require('../connectors/rhino');

function withEnv(env, fn) {
  const saved = {};
  Object.keys(env).forEach((k) => { saved[k] = process.env[k]; });
  Object.keys(env).forEach((k) => {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  });
  const done = () => Object.keys(saved).forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
  const r = fn();
  return (r && typeof r.then === 'function') ? r.finally(done) : (done(), r);
}

test('★ 주소가 없으면 지어내지 않고 사유를 돌려준다', async () => {
  const r = await withEnv({ RHINO_COMPUTE_URL: undefined }, () =>
    rhino.solve({ definition: { pointer: 'massing.gh' }, inputs: { 대지면적: 12000 } }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.unavailable, true);
  assert.match(r.error, /Rhino 라이선스가 필요하다/,
    '왜 못 쓰는지 적어야 한다 — 「미설정」만 있으면 설정하면 되는 줄 안다');
});

test('★ 정의가 없으면 부르지 않는다', async () => {
  const r = await withEnv({ RHINO_COMPUTE_URL: 'http://127.0.0.1:9' }, () =>
    rhino.solve({ inputs: { 대지면적: 12000 } }));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Grasshopper 정의가 없다/);
});

/* ───────────── 입력 변환 ───────────── */

test('★ 값을 Compute 가 받는 DataTree 로 바꾼다', () => {
  const { values, skipped } = rhino.toTree({ 대지면적: 12000, 용도: '업무', 지하: true });
  assert.deepStrictEqual(skipped, []);
  assert.strictEqual(values.length, 3);
  assert.deepStrictEqual(values[0], {
    ParamName: '대지면적',
    InnerTree: { '{0}': [{ type: 'System.Double', data: '12000' }] },
  });
  assert.strictEqual(values[1].InnerTree['{0}'][0].type, 'System.String');
  assert.strictEqual(values[2].InnerTree['{0}'][0].type, 'System.Boolean');
});

/**
 * ★ 못 보내는 입력을 **조용히 버리지 않는다.** 버리면 Grasshopper 가 기본값으로
 *   풀고 결과는 정상으로 보인다 — 넣은 줄 알았던 값이 안 들어간 것을 아무도 모른다.
 */
test('★ 보낼 수 없는 입력이 있으면 풀기 전에 멈춘다', async () => {
  const { skipped } = rhino.toTree({ 좌표: { x: 1 }, 층수: null, 대지면적: 12000 });
  assert.strictEqual(skipped.length, 2);
  assert.ok(skipped.some(s => s.includes('좌표')) && skipped.some(s => s.includes('층수')));

  const r = await withEnv({ RHINO_COMPUTE_URL: 'http://127.0.0.1:9' }, () =>
    rhino.solve({ definition: { pointer: 'm.gh' }, inputs: { 좌표: { x: 1 } } }));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /기본값으로 풀리면 결과가 조용히 달라진다/);
});

/* ───────────── 출력 변환 ───────────── */

test('★ 응답을 평평한 값으로 바꾼다', () => {
  const got = rhino.fromTree({
    values: [{ ParamName: '연면적', InnerTree: { '{0}': [{ type: 'System.Double', data: '32000.5' }] } }],
  });
  assert.strictEqual(got.values.연면적, 32000.5);
  assert.deepStrictEqual(got.geometry, []);
});

/**
 * ★ 가지가 여럿이면 **합치지 않는다.** 합치면 「동 3개의 연면적」이 한 숫자로
 *   뭉개져 어느 동인지 사라진다.
 */
test('★ 가지가 여럿이면 배열로 둔다 (합치지 않는다)', () => {
  const got = rhino.fromTree({
    values: [{
      ParamName: '동별연면적',
      InnerTree: {
        '{0}': [{ type: 'System.Double', data: '12000' }],
        '{1}': [{ type: 'System.Double', data: '20000.5' }],
      },
    }],
  });
  assert.deepStrictEqual(got.values.동별연면적, [12000, 20000.5]);
  assert.notStrictEqual(got.values.동별연면적, 32000.5, '합계로 뭉개면 안 된다');
});

/**
 * ★ 형상은 값으로 만들지 않는다. rhino3dm 없이는 못 읽는데, 억지로 파싱하면
 *   틀린 숫자가 그럴듯하게 나온다.
 */
test('★ 형상은 값으로 만들지 않고 「있다」까지만 알린다', () => {
  const got = rhino.fromTree({
    values: [{ ParamName: '매스', InnerTree: { '{0}': [{ type: 'Rhino.Geometry.Brep', data: '{...}' }] } }],
  });
  assert.deepStrictEqual(got.values, {});
  assert.deepStrictEqual(got.geometry, [{ param: '매스', type: 'Rhino.Geometry.Brep' }]);
});

/* ───────────── 생성물 표시 ───────────── */

/**
 * ★ **이 표시를 떼면 우리가 만든 숫자가 공부에서 온 값과 구분되지 않는다.**
 *   IM 에 「연면적 32,000㎡(출처: 매스 스터디)」라고 적히면 우리가 만든 것으로
 *   우리 주장을 증명하는 셈이 된다.
 */
test('★ 결과에 생성물 표시가 붙는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'rhino.js'), 'utf8');
  assert.match(src, /assumption: true/, '가정 표시가 없다');
  assert.match(src, /사람이 확인하고 채택해야 한다/, '출처에 채택 절차를 적어야 한다');
  assert.match(src, /definition: def\.pointer/, '어느 정의로 푼 결과인지 남겨야 한다');
});

/** ★ fact 를 등록하지 않는다 — 등록하면 사람 확인 없이 IM 에 실린다 */
test('★ 이 커넥터는 fact 를 만들지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'rhino.js'), 'utf8');
  assert.ok(!/facts?\.push|addMany|new Dataset/.test(src),
    'fact 를 등록하고 있다 — 생성물이 사람 확인 없이 IM 에 실린다');
  assert.match(src, /fact 를 등록하지 않는다/, '왜 안 하는지 코드에 적어야 한다');
});

/* ───────────── 시크릿 · 스모크 ───────────── */

/** ★ 키가 로그·오류에 평문으로 남으면 안 된다 (CLAUDE.md §2) */
test('★ 접근키가 SECRET_ENV 에 등록되어 있다', () => {
  const http = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'http.js'), 'utf8');
  assert.match(http, /'RHINO_COMPUTE_KEY'/,
    'SECRET_ENV 에 없으면 오류 메시지에 키가 그대로 남을 수 있다');
});

test('★ 스모크가 서버 생존을 확인한다', () => {
  const smoke = fs.readFileSync(path.join(__dirname, '..', 'tools', 'smoke-public-data.js'), 'utf8');
  assert.match(smoke, /Rhino\.Compute \(매스\)/, '붙였는데 확인할 방법이 없다');
  assert.match(smoke, /생성물이다/, '스모크도 이 값의 성격을 말해야 한다');
});

/** ★ 「무료」가 아니라는 사실을 문서와 코드 양쪽에 남긴다 */
test('★ 라이선스가 필요하다는 사실이 적혀 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'rhino.js'), 'utf8');
  assert.match(src, /「무료」가 아니다|무료가 아니다/);
  assert.match(src, /D-38/, '등록부 번호가 있어야 어디서 결정하는지 알 수 있다');

  const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8');
  assert.match(env, /RHINO_COMPUTE_URL=/);
  assert.match(env, /Rhino 라이선스가 필요하다/, '.env.example 만 보고 무료로 오해하면 안 된다');
});

/** ★ POST 를 쓰려면 http.js 가 body 를 보낼 수 있어야 한다 */
/**
 * ★ 본문 파라미터 이름을 `body` 로 두면 **응답 본문(`const body`)과 겹쳐
 *   모든 HTTP 호출이 죽는다.** 섀도잉이라 문법 오류도 안 나고
 *   `Cannot access 'body' before initialization` 만 남는다 — 실제로 그렇게
 *   만들었다가 교차검증에서 잡았다. 이름을 되돌리지 못하게 못 박는다.
 *   (실제 동작은 `http-live.test.js` 가 localhost 서버로 확인한다)
 */
test('★ http 헬퍼가 본문을 실어 보낸다 (이름이 응답 본문과 겹치지 않는다)', () => {
  const http = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'http.js'), 'utf8');
  assert.match(http, /requestBody = undefined/, 'POST 본문을 못 보내면 Grasshopper 를 못 부른다');
  assert.match(http, /if \(requestBody !== undefined\) init\.body = requestBody;/);
  assert.ok(!/if \(body !== undefined\)/.test(http),
    '파라미터 이름이 body 로 되돌아갔다 — 응답 본문과 겹쳐 모든 호출이 죽는다');
  assert.match(http, /부수효과가 있는 POST 라면/,
    '재시도해도 되는지의 판단 근거를 남겨야 한다 — 안 남기면 결제 API 에 이 헬퍼를 쓴다');
});
