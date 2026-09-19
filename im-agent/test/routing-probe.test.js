'use strict';
/**
 * routing-probe.test.js — **길찾기 소요시간 진단** 〈2026-09-19 · D-227〉
 *   〈사장님: 「권하는 개선안 대로 진행해」 — 제가 올린 권장 ②(진단을 돌린다)〉
 *
 * ★★★ **무엇을 재는가.** 실호출은 여기서 못 잰다 — 이 컨테이너는 그 호스트가
 *   막혀 있고(실측) 운영 열쇠도 여기 없다 (§4.3 ★★ 와 같은 결). 그래서 재는 것은
 *   **「무엇이 오든 갈래를 갈라 말하는 구조인가」**다.
 *
 * ★ **갈래마다 사장님이 하실 일이 정반대다** — 그래서 뭉뚱그리면 안 된다:
 *     0 값이 왔다 · 2 열쇠가 없다(넣으실 일) · 3 못 닿았다(**열쇠 문제가 아니다**) ·
 *     4 인증 거부(열쇠·서비스 신청) · 5 대답은 왔는데 값을 못 뽑았다(**규격을 고친다**)
 *   §12-24 가 브이월드에서 세운 그 규칙과 **같은 것**이다.
 *
 * ★★ **베끼지 않고 오려 내 돌린다** (§12-24 에서 사보타주 둘이 빠져나간 자리).
 *   「`verdictOf` 라는 낱말이 있는가」는 이름만 바꿔 끼워도 통과하는, 아무것도 안 재는 검사다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { yamlNoComment } = require('./yaml-lite.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'scripts', 'routing-probe.mjs');
const WF = path.join(ROOT, '.github', 'workflows', 'api-smoke.yml');
const read = (p) => fs.readFileSync(p, 'utf8');

/** `function 이름(...) { … }` 을 **중괄호 짝을 세어** 오려 낸다 (꼬리 글자로 찾지 않는다 · §12-6) */
function cutFn(src, name) {
  const at = src.search(new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm'));
  if (at < 0) return null;
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}

test('★★★ 갈래 다섯을 «갈라» 말한다 — 값마다 하실 일이 정반대다 (D-227)', () => {
  const src = read(SRC);
  const fn = cutFn(src, 'verdictOf');
  assert.ok(fn, 'verdictOf() 를 못 오려 냈습니다 — 이 칸은 아무것도 안 잽니다');
  const verdictOf = new Function(`${fn}\nreturn verdictOf;`)();

  /* ① 열쇠가 없다 — 부른 적이 없으므로 「안 된다」로 적으면 안 된다 */
  const none = verdictOf([]);
  assert.strictEqual(none.code, 2);
  assert.ok(/열쇠가 없다|미설정/.test(none.head), '열쇠가 없는 것을 그렇게 안 적습니다.');

  /* ② 값이 왔다 */
  assert.strictEqual(verdictOf([{ status: 200, gotValue: true }]).code, 0);

  /* ③ 못 닿았다 — **열쇠 문제가 아니다**를 «부정으로» 적는다 (§4.6 · M-86) */
  const un = verdictOf([{ status: null }, { status: null }]);
  assert.strictEqual(un.code, 3, '응답이 한 번도 안 왔는데 다른 갈래로 셉니다.');
  assert.ok(/못 닿/.test(un.head));
  assert.ok(/문제가 아니다|아니다/.test(un.head),
    `못 닿았는데 열쇠를 가리킵니다 — 다시 넣으시게 만듭니다 (M-86): ${un.head}`);

  /* ④ 인증 거부 — 여기서만 열쇠·신청을 가리킨다 */
  const auth = verdictOf([{ status: 401 }, { status: 403 }]);
  assert.strictEqual(auth.code, 4);
  assert.ok(/인증|신청/.test(auth.head));

  /* ⑤ 대답은 왔는데 값을 못 뽑았다 — 규격 문제이지 열쇠 문제가 아니다 */
  const shape = verdictOf([{ status: 200, gotValue: false }]);
  assert.strictEqual(shape.code, 5, '200 인데 값이 없는 것을 인증 거부로 셉니다.');
  assert.ok(/문제가 아니다|아니다/.test(shape.head),
    `규격 문제인데 열쇠를 가리킵니다: ${shape.head}`);

  /* ★ 섞이면 「고칠 것이 있는 쪽」이 이긴다 — 못 닿음 하나에 묻히지 않는다 */
  assert.strictEqual(verdictOf([{ status: null }, { status: 403 }]).code, 4,
    '한 후보가 못 닿았다고 인증 거부를 덮습니다 — 고칠 것이 있는 쪽을 가려야 합니다.');
});

test('★★ 「대답이 왔다」와 「값이 왔다」를 갈라 센다 (§8 「걸었다 ≠ 올라갔다」와 같은 결)', () => {
  const src = read(SRC).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  /* HTTP 200 만으로 「됐다」로 세면, 규격이 달라 빈 답이 와도 초록이 된다.
     ★ **글자 모양을 박지 않는다** — D-228 에서 이 줄을 `probe()` 안으로 옮기자
       **고침이 옳은데 빨개졌다.** 재려던 성질(「200 하나로 세지 않는가」)은 그대로 두고
       **세는 자리를 옮겼다** (§6-2-5 의 잣대). 어느 자리에 적혔든 성질만 본다. */
  const calc = (cutFn(src, 'probe') || src).match(/gotValue\s*:\s*Boolean\([^)]*\)|gotValue\s*=\s*Boolean\([^;]*/);
  assert.ok(calc, 'gotValue 를 계산하는 자리를 못 찾았습니다 — 이 칸은 아무것도 안 잽니다');
  assert.match(calc[0], /r\.ok\s*&&/,
    'gotValue 를 r.ok 만으로 셉니다 — 200 인데 값이 없는 갈래가 사라집니다.');
  assert.ok(/duration/.test(src) && /totalTime/.test(src),
    '소요시간을 실제로 뽑았는지 안 봅니다 — 갈래 5 를 영영 못 잽니다.');
});

test('★★★ 열쇠 이름을 여럿 읽고, 값은 한 글자도 안 남긴다 (§2)', () => {
  const src = read(SRC).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  /* ★★★ 이름이 갈리면 아무 오류도 안 나고 조용히 죽는다 — 셋·둘을 다 읽는다.
     ★ **「소스에 그 글자가 있는가」로는 아무것도 안 잰다** 〈사보타주가 실제로 빠져나갔다〉.
       읽는 목록에서 이름을 빼도 **안내 문구에 그 글자가 남아** 통과했다.
       그래서 `pick()` 을 **오려 내 돌리고**, 목록도 소스에서 뽑아 먹인다 (§12-24 의 그 방식). */
  const pickFn = cutFn(read(SRC), 'pick');
  assert.ok(pickFn, 'pick() 을 못 오려 냈습니다 — 이 칸은 아무것도 안 잽니다');
  const pick = new Function('process', `${pickFn}\nreturn pick;`);

  const lists = [...src.matchAll(/pick\(\[([^\]]*)\]\)/g)]
    .map((m) => m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
  assert.strictEqual(lists.length, 2, `pick() 호출이 둘이 아닙니다 (${lists.length}) — 자동차·대중교통 둘입니다`);
  const reads = lists.flat();

  for (const n of ['KAKAO_MOBILITY_REST_API', 'KAKAO_MOBILITY_KEY', 'KAKAOMOBILITY_KEY',
    'ODSAY_API_KEY', 'ODSAY_KEY']) {
    assert.ok(reads.includes(n),
      `열쇠 이름 ${n} 을 «읽는 목록»에 안 넣습니다 — 그 이름으로 넣으셔도 조용히 죽습니다.`);
    /* ★ 목록에 있다고 실제로 읽히는 것은 아니다 — 심어서 돌려 본다 */
    const list = lists.find((l) => l.includes(n));
    const got = pick({ env: { [n]: 'x'.repeat(30) } })(list);
    assert.ok(got && got.name === n, `${n} 을 목록에 적어 두고 실제로는 안 읽습니다.`);
  }
  /* ★ 반대로도 막는다 — 아무것도 없으면 null 이어야 「미설정」 갈래로 간다 */
  assert.strictEqual(pick({ env: {} })(reads), null, '열쇠가 없는데 있는 것으로 셉니다.');

  /* ★★ 본문·JSON 이 redact 를 지나간다. 안 지나가면 응답에 섞인 값이 그대로 남는다 */
  assert.match(src, /redact\(/, 'redact 를 안 씁니다 — 응답 본문에 섞인 값이 로그에 남습니다 (§2).');
  assert.match(src, /writeFile\([^)]*routing-probe\.json[^)]*redact\(/,
    'JSON 결과가 redact 를 안 지나갑니다.');

  /* ★★★ 요약에 **길이만** 적고 값은 안 적는다.
     ★ **세는 자리는 「요약에 나가는 줄」이다** 〈이 칸이 실제로 옳은 코드에 빨개졌다〉.
       소스 전체를 세면 `Authorization: KakaoAK ${…}` 같은 **헤더 조립**까지 걸린다 —
       그것은 요청에 실리는 것이지 화면에 찍히는 것이 아니다. 재려던 성질
       (**요약에 값이 실리는가**)은 그대로 두고 세는 자리를 옮겼다 (§6-2-5 의 잣대). */
  const printed = (src.match(/^\s*P\(.*$/gm) || []).join('\n');
  assert.ok(printed.length > 200, `요약에 찍는 줄을 못 읽었습니다 (${printed.length}자) — 이 칸이 아무것도 안 잽니다`);
  assert.ok(!/\.value\}/.test(printed),
    '열쇠 값을 요약에 그대로 찍습니다 — 이 저장소는 공개입니다 (§2 · D-10).');
  assert.match(src, /\.value\.length/, '길이로 적는 자리가 없습니다 — 들어왔는지 가릴 수 없습니다.');
});

test('★ 판정이 «실행 요약 첫 화면»까지 간다 — 파일 안에만 두면 아무도 안 본다 (§12-19)', () => {
  const y = yamlNoComment(read(WF));
  assert.ok(/node\s+scripts\/routing-probe\.mjs/.test(y),
    '진단이 워크플로에서 안 돌아갑니다 — 열쇠가 있는 자리에서만 뜻이 있습니다 (§4.3).');
  assert.ok(/GITHUB_STEP_SUMMARY/.test(y) && /routing-probe\.md/.test(y),
    '판정을 실행 요약으로 안 나릅니다 — 요약 파일을 아무도 안 열어 봅니다.');

  /* ★ 열쇠가 env 로 실제로 들어가는가 — 안 넣으면 늘 「미설정」이 나온다 */
  for (const n of ['KAKAO_MOBILITY_REST_API', 'ODSAY_API_KEY']) {
    assert.ok(new RegExp(`${n}:\\s*\\$\\{\\{\\s*secrets\\.${n}`).test(y),
      `워크플로가 ${n} 을 안 넘깁니다 — 넣으셔도 진단이 「미설정」으로 끝납니다.`);
  }

  /* ★★ 결과가 커밋·아티팩트보다 «먼저» 만들어진다 — 아니면 받을 것이 안 남는다 (§12-24) */
  const names = [...y.matchAll(/^\s*- name:\s*(.+)$/gm)].map((m) => m[1].trim());
  const iProbe = names.findIndex((n) => /길찾기/.test(n));
  const iCommit = names.findIndex((n) => /결과 커밋/.test(n));
  assert.ok(iProbe >= 0 && iCommit >= 0, `단계를 못 읽었습니다 (${names.length}개)`);
  assert.ok(iProbe < iCommit,
    `진단이 결과 커밋보다 뒤에 있습니다 — 그날 결과가 안 남습니다 (진단 ${iProbe + 1} · 커밋 ${iCommit + 1})`);
});

/* ★★★ D-228 — **잣대가 앞머리 300자만 봤다.** 그래서 카카오가 「길찾기 성공」을
   HTTP 200 으로 돌려줬는데도 판정이 **5(값을 못 뽑았다 · 규격을 고쳐라)** 로 나왔다.
   그 글은 **틀린 곳을 가리킨다** — 고칠 규격이 없다 (§4.6 · §12-24 와 같은 결).
   잣대는 하나다 — **「그 숫자를 재는 법이 재려는 것을 다 덮는가」** (§6-2-6 의 46 → 105). */
test('probe 는 «본문 전체»로 값을 재고, 요약에는 앞머리만 싣는다', async () => {
  const src = read(SRC);
  const fn = cutFn(src, 'probe');
  assert.ok(fn, 'probe 를 못 떼어 냈습니다 — 이 칸은 아무것도 안 잽니다');

  /* 실제로 온 모양: summary.duration 이 **앞 300자 밖**에 있다 */
  const body = JSON.stringify({
    trans_id: 'x'.repeat(32),
    routes: [{
      result_code: 0, result_msg: '길찾기 성공',
      summary: {
        origin: { name: '', x: 126.9784, y: 37.5666 },
        destination: { name: '', x: 127.0276, y: 37.4979 },
        waypoints: [], priority: 'RECOMMEND',
        bound: { min_x: 126.9, min_y: 37.4, max_x: 127.1, max_y: 37.6 },
        fare: { taxi: 12000, toll: 0 },
        distance: 11234, duration: 1820,
      },
    }],
  });
  assert.ok(body.indexOf('"duration"') > 300,
    '표본이 재려던 성질을 안 지킵니다 — 소요시간 칸이 앞 300자 «안»에 있으면 이 고장을 영영 못 잽니다');

  const probe = new Function('fetch', 'redact', 'AbortSignal',
    `${fn}\nreturn probe;`)(
    async () => ({ ok: true, status: 200, text: async () => body, headers: { get: () => null } }),
    (x) => x,
    { timeout: () => null },
  );

  const r = await probe('표본', 'https://example.invalid/x', {}, /"duration"\s*:\s*\d/);
  assert.strictEqual(r.gotValue, true,
    '값이 왔는데 «못 뽑았다»로 셉니다 — 앞머리만 보고 판정하면 「규격을 고치라」는 틀린 글이 나갑니다');
  assert.ok(r.head && r.head.length <= 300,
    `요약에 본문을 통째로 싣습니다 (${r.head ? r.head.length : 0}자) — 값이 샐 자리입니다 (§2)`);
  assert.strictEqual(r.truncated, true, '잘렸다는 사실을 안 적습니다 — 다음 사람이 또 앞머리만 봅니다');

  /* 반대로도 막는다 — 정말 값이 없으면 여전히 «못 찾았다»다 */
  const empty = new Function('fetch', 'redact', 'AbortSignal',
    `${fn}\nreturn probe;`)(
    async () => ({ ok: true, status: 200, text: async () => '{"routes":[]}', headers: { get: () => null } }),
    (x) => x, { timeout: () => null },
  );
  const r2 = await empty('빈 것', 'https://example.invalid/x', {}, /"duration"\s*:\s*\d/);
  assert.strictEqual(r2.gotValue, false,
    '값이 없는데 «왔다»로 셉니다 — 그러면 이 판정이 아무것도 안 가릅니다');
});

/* ★ 두 자리(자동차·대중교통)가 **같은 글**을 쓰는지 — 두 벌이면 한쪽이 옛말을 한다 (§8-1) */
test('후보 결과를 적는 글이 한 벌이고, 「대답이 왔다」와 「값이 왔다」를 갈라 적는다', () => {
  const src = read(SRC);
  assert.ok(cutFn(src, 'sayRow'), 'sayRow 를 못 찾았습니다 — 이 칸은 아무것도 안 잽니다');
  const calls = (src.match(/^\s*sayRow\(r\);/gm) || []).length;
  assert.ok(calls >= 2,
    `두 자리가 같은 글을 안 씁니다 (${calls}곳) — 한쪽만 고쳐지면 그 자리가 옛말을 합니다`);
  const say = cutFn(src, 'sayRow');
  assert.ok(/gotValue/.test(say),
    '「값이 왔는가」를 화면에 안 적습니다 — HTTP 200 하나를 보고 「됐다」로 읽힙니다');
  assert.ok(!/\.value\b/.test(say), '열쇠 값을 요약에 찍습니다 (§2)');
});
