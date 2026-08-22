'use strict';
/**
 * 자료 업로드 — **끝에서 끝까지 실제로 올려 보고 잰다** 〈2026-08-22〉.
 *
 * ★★ 왜 있나: 지금까지 업로드 검사는 화면 쪽(브라우저)과 서버 쪽(핸들러)이
 *   따로 있었다. 둘 다 초록인데 **사이에서** 갈린 곳이 있었다 —
 *   서버는 저장 건수를 **숫자**(`saved: 1`)로 주는데 화면은 `.length` 로 세고
 *   있어서 「값 undefined개를 가져왔습니다」가 떴다. 값은 실제로 들어갔는데
 *   화면만 못 셌다. 어느 쪽 검사도 그것을 볼 수 없었다.
 *
 * ★ 그래서 여기서는 **진짜 핸들러를 불러 나온 응답**을 **화면의 그 함수**에
 *   그대로 먹인다. 응답 모양을 손으로 적어 두지 않는다 — 적어 두면 서버가
 *   바뀐 날 검사만 옛말을 한다 (MEMORY M-08).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const api = require(path.join(ROOT, 'ui/report-api.cjs'));
const SCREEN = path.join(ROOT, 'ui/platform/files.html');

/** 진짜 핸들러 한 벌 — 프로젝트 폴더는 임시 자리에 만든다 */
function handlers() {
  const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-e2e-'));
  process.env.IM_AGENT_ROOT = agentRoot;
  process.env.IM_AGENT_OFFLINE = '1';
  const pipeline = require(path.join(ROOT, 'pipeline.js'));
  const h = api.createHandlers({
    agentRoot,
    agentModulePath: ROOT,
    authenticate: () => ({ name: '검증', planId: 'pro', status: 'active' }),
    extractOneshot: (id, files) => pipeline.extractInto(id, files, { log: () => {} }),
    extractFiles: (id, files) => pipeline.extractInto(id, files, { log: () => {} }),
  });
  return { h, agentRoot };
}

/** 화면 파일에서 함수 하나를 꺼내 실제로 부른다 (베끼지 않는다) */
function fromScreen(name) {
  const src = fs.readFileSync(SCREEN, 'utf8');
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at > -1, `화면에서 ${name}() 을 못 찾았다 — 이름이 바뀌었으면 검사도 함께 옮긴다`);
  // 중괄호 짝을 세어 함수 하나만 잘라낸다
  let i = src.indexOf('{', at), depth = 0, end = -1;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (!depth) { end = i + 1; break; } }
  }
  assert.ok(end > -1, `${name}() 의 끝을 못 찾았다`);
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(at, end)}; return ${name};`)();
}

const B = (s) => Buffer.from(s, 'utf8').toString('base64');

test('★★ 앱에서 가져온 값의 개수를 화면이 실제로 센다 (서버 응답을 그대로 먹인다)', async () => {
  const { h } = handlers();
  const mk = await h.createProject({}, { request: '서울 서초구 태양광 발전소 IM 을 만들어 주십시오' });
  const pid = mk.body && mk.body.projectId;
  assert.ok(pid, '프로젝트를 못 만들었다');

  const saved = await h.saveFacts({}, pid, {
    facts: [{ key: 'land.area_sqm', value: 1234.5, unit: 'm2', source: 'LinkPilot 앱 · TEST-DEAL' }],
  });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));

  const savedCount = fromScreen('savedCount');
  const n = savedCount(saved.body.saved);
  assert.strictEqual(n, 1,
    `화면이 ${n} 로 셌다 (서버 응답 saved=${JSON.stringify(saved.body.saved)}). `
    + '「값 undefined개를 가져왔습니다」가 이렇게 나왔다 — 값은 들어갔는데 화면만 못 센 것이다');

  // 목록으로 주는 응답(`POST /sources`)도 같은 함수가 세야 한다
  assert.strictEqual(savedCount([{ name: 'a' }, { name: 'b' }]), 2, '목록 응답을 못 센다');
  assert.strictEqual(savedCount(undefined), 0, '없는 값을 0 이 아닌 것으로 센다');
});

test('★★ 파일업로드(1회성) — 받고 · 읽고 · 지운다. 못 읽은 것은 이름으로 돌려준다', async () => {
  const { h } = handlers();
  const mk = await h.createProject({}, { request: '서울 서초구 태양광 발전소 IM 을 만들어 주십시오' });
  const pid = mk.body.projectId;

  const up = await h.oneshotUpload({}, pid, {
    files: [
      { name: '사업계획서.txt', contentBase64: B('대지면적 1,234.5 m2\n총사업비 452억원\n') },
      { name: '도면.hwp', contentBase64: B('한글파일') },
      { name: '빈파일.txt', contentBase64: '' },
    ],
  });
  assert.strictEqual(up.status, 200, JSON.stringify(up.body));
  assert.ok((up.body.accepted || []).length >= 1, '받은 것이 없다');

  /* ★ 「빈 파일」은 **거절 사유로** 나와야 한다. 조용히 빠지면 사용자는
     올렸다고 믿는데 아무 일도 안 일어난다 */
  assert.ok((up.body.rejected || []).some((x) => /빈 파일/.test(x.reason || '')),
    `빈 파일이 사유 없이 사라졌다 — ${JSON.stringify(up.body.rejected)}`);

  /* ★ 못 읽는 형식은 **이름으로** 돌려준다 (MEMORY M-16) */
  const unread = (up.body.read && up.body.read.unsupported) || [];
  assert.ok(unread.length >= 1, '못 읽은 파일을 안 알려 준다');

  /* ★ 1회성은 보관하지 않는다 — 응답이 그렇게 말해야 화면이 미리 경고한다 */
  assert.strictEqual(up.body.reusable, false);
  assert.strictEqual(up.body.verifiable, false);
  assert.ok(up.body.removed >= 1, '읽고 나서 원본을 안 지웠다');
});

test('★★ 한도는 실제로 막는다 — 통과가 아니라 실패를 잰다 (M-12)', async () => {
  const { h } = handlers();
  const mk = await h.createProject({}, { request: '서울 서초구 태양광 발전소 IM 을 만들어 주십시오' });
  const pid = mk.body.projectId;

  const over = Buffer.alloc(api.MAX_FILE_BYTES + 1024, 0x41).toString('base64');
  const up = await h.oneshotUpload({}, pid, {
    files: [{ name: '너무큰것.txt', contentBase64: over }],
  });
  const why = JSON.stringify(up.body.rejected || []);
  assert.match(why, /너무 큽니다/, `한도를 넘겼는데 통과했다 — ${why}`);
  assert.match(why, /30/, `사유에 한도 숫자가 없다 — ${why}`);
});

test('★★ 출처 없는 값은 들어오지 못한다 — 사유까지 확인한다', async () => {
  const { h } = handlers();
  const mk = await h.createProject({}, { request: '서울 서초구 태양광 발전소 IM 을 만들어 주십시오' });
  const pid = mk.body.projectId;

  const r = await h.saveFacts({}, pid, { facts: [{ key: 'land.area_sqm', value: 999, unit: 'm2' }] });
  const why = JSON.stringify((r.body && r.body.rejected) || []);
  /* ★ 「거절됐다」만 보면 안 된다 — 사전에 없는 키라도 거절되므로 통과해 버린다.
     실제로 **출처가 없어서** 막혔는지 사유를 읽는다 */
  assert.match(why, /출처/, `출처 없는 값이 다른 사유로 막혔다 (또는 통과했다) — ${why}`);
});

/**
 * ★★★ **문지기 — 어디가 열려 있고 어디가 닫혀 있는가** 〈2026-08-22 · D-82 로 바뀜〉.
 *
 * ★★ 앞 판은 「올리기도 401」이었다. 그런데 실제로 난 일은 이렇다: 목록은
 *   멀쩡히 뜨는데 **올리기만** 401 이 돌아왔다. 로그인은 되어 있었다.
 *   즉 그 401 은 「로그인하라」가 아니라 **「이 요청에서 세션을 못 읽었다」**였고,
 *   화면에는 로그인 문제로만 보여 사용자가 고칠 방법이 없었다.
 *
 * ★★ 그래서 **넣는 길 셋만** 열었다. 이 검사는 열린 것과 닫힌 것을 **둘 다**
 *   잰다 — 열린 쪽만 재면 다음에 실수로 읽는 길까지 열려도 초록이다.
 *   그때 새는 것은 **남의 프로젝트에 무엇이 들었는가**다.
 */
test('★★★ 문지기 — 넣는 길은 로그인을 안 묻고, 읽는·지우는·만드는 길은 묻는다', async () => {
  const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-e2e-'));
  process.env.IM_AGENT_ROOT = agentRoot;
  let who = null;
  const h = api.createHandlers({
    agentRoot, agentModulePath: ROOT,
    authenticate: () => who,
    extractOneshot: async () => ({ documents: [] }),
  });
  const ID = 'LP-SOL-2026-001';

  /* ① 넣는 길 — 사람을 못 알아봐도 **401 이 아니다.**
        (내용이 비어 400 이 날 수는 있다. 재는 것은 「문에서 막혔는가」다) */
  const put = await h.oneshotUpload({}, ID, { files: [] });
  assert.notStrictEqual(put.status, 401,
    `로그인 없이 올리기가 막혔다 — D-82 대로면 열려 있어야 한다 ${JSON.stringify(put.body)}`);
  const link = await h.linkSource({}, ID, {});
  assert.notStrictEqual(link.status, 401, '로그인 없이 폴더 연결이 막혔다');
  const scan = await h.scanSources({}, ID, {});
  assert.notStrictEqual(scan.status, 401, '로그인 없이 읽기가 막혔다');

  /* ② 읽는 길·지우는 길 — **그대로 묻는다.** 열리면 남의 자료가 나간다 */
  assert.strictEqual((await h.listLinked({}, ID)).status, 401,
    '연결 목록이 로그인 없이 열렸다 — 남의 프로젝트에 무엇이 들었는지가 나간다');
  assert.strictEqual((await h.listOneshot({}, ID)).status, 401,
    '1회성 기록이 로그인 없이 열렸다');
  assert.strictEqual((await h.unlinkSource({}, ID, 'k')).status, 401,
    '연결 끊기가 로그인 없이 열렸다 — 지우는 길이다');

  /* ③ 만드는 길 — 손대지 않았다 */
  assert.strictEqual((await h.createProject({}, { request: '테스트 요청문입니다' })).status, 401,
    '보고서 생성이 로그인 없이 열렸다');

  /* ④ 만료 회원 — 넣는 길은 통과, 만드는 길은 막힌다 */
  who = { name: '만료', planId: 'free', status: 'expired' };
  assert.notStrictEqual((await h.oneshotUpload({}, ID, { files: [] })).status, 403,
    '만료 회원이 자료를 못 넣는다 — 넣는 길은 열어 두기로 했다');
  assert.strictEqual((await h.createProject({}, { request: '테스트 요청문입니다' })).status, 403,
    '만료 회원에게 보고서 생성이 열렸다');

  /* ★ 자료 올리기는 **무료 회원도** 된다 (FILES_PLAN). 여기가 pro 로 올라가면
     무료 회원은 자료를 못 넣는데 화면은 그 이유를 말하지 못한다 */
  assert.strictEqual(api.FILES_PLAN, 'free');
});
