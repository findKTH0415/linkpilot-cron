'use strict';
/**
 * upload-limits.test.js — **업로드 한도는 한 곳에서만 정한다** (2026-08-22).
 *
 * ★★ 한도를 20MB → 30MB 로 올리다가 알았다. 같은 숫자가 **세 곳**에 있었다:
 *
 *     ui/api-router.cjs          20 * 1024 * 1024   ← 진짜 출처
 *     core/linked-fetch.js       20 * 1024 * 1024   ← 손으로 베낀 사본
 *     ui/platform/build-files.js 30 * 1024 * 1024   ← 미리보기용으로 적어 둔 값
 *
 *   베낀 사본에는 「api-router.cjs 와 같은 값을 쓴다」는 주석까지 달려 있었다.
 *   **같은 값이었던 것은 적어 둔 그날뿐이다.**
 *
 *   그대로 올렸으면 이렇게 됐다 — 화면은 「한도 30MB」라고 말하고, 직접 올리는
 *   길은 30MB 까지 받고, **연결 자료만 조용히 20MB 에서 잘린다.** 사용자는
 *   26MB 짜리가 왜 어떤 길로는 되고 어떤 길로는 안 되는지 알 방법이 없다.
 *
 * ★ 그래서 숫자를 고정하지 않는다. **한 곳에서 나오는가**를 고정한다 —
 *   숫자를 박아 두면 다음에 한도를 바꿀 때 이 시험이 걸려서, 고치는 사람이
 *   시험의 숫자만 바꾸고 넘어가게 된다. 그때 사본은 또 뒤에 남는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const AR = require('../ui/api-router.cjs');
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const mb = (b) => b / (1024 * 1024);

test('★ 한도가 값으로 나온다 (파일 < 요청)', () => {
  assert.ok(AR.MAX_FILE_BYTES > 0, '파일 한도가 없다');
  assert.ok(AR.MAX_REQUEST_BYTES > AR.MAX_FILE_BYTES,
    '한 번에 올릴 수 있는 양이 파일 하나보다 작거나 같다 — 그러면 큰 파일을 아예 못 올린다');
});

/** ★★ 이것이 이 파일의 이유다 */
test('★★ 연결 자료 한도가 **베낀 값이 아니라** 같은 출처에서 온다', () => {
  const io = require('../core/linked-fetch.js');
  assert.strictEqual(io.MAX_BYTES, AR.MAX_FILE_BYTES,
    `연결 자료만 ${mb(io.MAX_BYTES)}MB 에서 잘린다 — 화면은 ${mb(AR.MAX_FILE_BYTES)}MB 라고 말한다`);

  // 값이 같은 것만으로는 부족하다. **오늘 우연히 같은 것**일 수 있다
  const src = read('core/linked-fetch.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(src, /require\(['"][^'"]*api-router\.cjs['"]\)/,
    '한도를 손으로 적어 두었다 — 오늘은 같아도 다음에 올릴 때 갈린다');
  assert.doesNotMatch(src, /MAX_BYTES\s*=\s*\d+\s*\*/,
    '한도를 숫자로 적은 줄이 남아 있다');
});

test('★★ 미리보기가 말하는 한도가 실제 한도와 같다', () => {
  const src = read('ui/platform/build-files.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /maxBytesPerFile:\s*\d+\s*\*/,
    '미리보기에 한도를 숫자로 적어 두었다 — 한도를 올린 날 미리보기만 옛말을 한다');
  assert.match(src, /apiLimits\.MAX_FILE_BYTES/, '미리보기가 실제 한도를 안 가져온다');
});

/**
 * ★★ **엔진까지 오지도 못하고 끊기는 자리가 하나 더 있다.**
 *   파일은 base64 로 실려 오므로 본문은 원본보다 약 33% 크다. 앱의
 *   `express.json()` 기본값은 100KB 다 — 안 올리면 413 으로 끊기고, 그 오류는
 *   화면이 말하는 한도와 전혀 다른 얼굴로 나타난다.
 */
test('★★ 본체가 잡아야 할 본문 한도를 엔진이 계산해 준다', () => {
  assert.ok(AR.MIN_BODY_BYTES > AR.MAX_REQUEST_BYTES,
    '본문 한도가 요청 한도보다 작거나 같다 — base64 로 부푸는 몫이 빠졌다');
  const need = AR.MAX_REQUEST_BYTES * AR.BASE64_OVERHEAD;
  assert.ok(AR.MIN_BODY_BYTES >= need,
    `본문 한도(${Math.round(mb(AR.MIN_BODY_BYTES))}MB)가 base64 로 부푼 크기(${Math.round(mb(need))}MB)보다 작다`);
  assert.ok(AR.MIN_BODY_BYTES < need * 2, '여유가 지나치다 — 메모리를 그만큼 열어 두는 것이다');
});

/** ★ 그 값을 어디에 넣는지 사람이 읽을 곳이 있어야 한다. 없으면 아무도 안 넣는다 */
test('★ 본체가 할 일이 문서로 남아 있다', () => {
  const doc = path.join(ROOT, '..', 'deploy', '앱-업로드-한도.md');
  assert.ok(fs.existsSync(doc), '앱 쪽 본문 한도 안내가 없다 — 엔진만 올리면 413 으로 끊긴다');
  const t = fs.readFileSync(doc, 'utf8');
  assert.match(t, /express\.json/, '어디에 넣는지가 없다');
  assert.match(t, /MIN_BODY_BYTES/, '숫자를 베껴 적으라고 안내하고 있다 — 다음에 또 갈린다');
  assert.match(t, /413/, '막혔을 때 무엇이 보이는지가 없다');
  /* ★★ **고칠 파일 이름이 있어야 한다.** 처음 판은 「앱 본체의 Node API」라고만
     적어서, 없는 파일을 찾게 만들었다. 앱은 미리 컴파일된 HTML 이고 Node
     프로세스는 엔진 서버 하나뿐이다 (2026-08-22 정정) */
  assert.match(t, /im-engine-server\.cjs/,
    '어느 파일을 고치는지가 없다 — 「앱 어딘가」로는 못 찾는다');
  assert.match(t, /역방향 프록시/,
    '앞단 프록시를 어디서 고치는지가 없다 — DSM 에서 그 자리는 잘 안 보인다');
});

/**
 * ★★ **합계를 재고 보내기 전에 막는가** 〈2026-08-22 · D-81〉.
 *
 * 전에는 파일 하나씩만 재고 합계는 아무도 안 쟀다. 화면은 「한 번에 N MB 까지」를
 * 적어 두기만 하고 그대로 보냈고, 서버는 받다가 **연결을 그냥 끊었다** — 응답이
 * 없어서 화면에는 「전송이 끊겼습니다」밖에 뜰 수 없다.
 *
 * ★ 화면 코드를 **실제로 불러** 잰다. 「그런 함수가 있다」를 재면 그 함수가
 *   아무것도 안 하게 된 날에도 통과한다 (M-08).
 */
test('★★ 한 번에 보낼 합계가 넘으면 화면이 보내기 전에 막는다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ui/platform/files.html'), 'utf8');
  const at = src.indexOf('function overRequest(');
  assert.ok(at > -1, '화면에 합계를 재는 자리가 없다 — 넘겨도 그대로 보낸다');
  let i = src.indexOf('{', at), depth = 0, end = -1;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (!depth) { end = i + 1; break; } }
  }
  const mk = (picked) => {
    const state = { limits: { maxBytesPerRequest: AR.MAX_REQUEST_BYTES }, picked };
    // eslint-disable-next-line no-new-func
    return new Function('state', `${src.slice(at, end)}; return overRequest();`)(state);
  };
  const mbFile = (n) => ({ size: n * 1024 * 1024, data: 'x', tooBig: false });

  assert.strictEqual(mk([mbFile(10), mbFile(10)]), null, '한도 안인데 막았다');

  const over = mk([mbFile(30), mbFile(20)]);
  assert.ok(over, `합 50MB 인데 안 막았다 (한도 ${Math.round(mb(AR.MAX_REQUEST_BYTES))}MB)`);
  assert.strictEqual(over.files, 2);
  assert.ok(over.total > over.cap);

  /* ★ 너무 큰 파일·못 읽은 파일은 **합계에 넣지 않는다** — 어차피 안 실린다.
     넣으면 보낼 수 있는 묶음이 엉뚱하게 막힌다 */
  assert.strictEqual(mk([mbFile(10), { size: 99 * 1024 * 1024, data: 'x', tooBig: true }]), null,
    '너무 큰 파일을 합계에 넣었다');
  assert.strictEqual(mk([mbFile(10), { size: 99 * 1024 * 1024, data: null, tooBig: false }]), null,
    '아직 못 읽은 파일을 합계에 넣었다');
});

/**
 * ★ 약속한 한도가 **NAS 가 실제로 받는 64MB 안에** 들어오는가 〈D-81〉.
 *   숫자를 검사에 적어 두지 않는다 — 관계를 잰다.
 */
test('★★ 한 번에 보낼 본문이 NAS 의 64MB 벽 안에 여유를 두고 들어온다', () => {
  const WALL = 64 * 1024 * 1024;                 // 실측: im-engine-server.cjs 의 MAX_BODY
  const body = AR.MAX_REQUEST_BYTES * AR.BASE64_OVERHEAD;
  assert.ok(body < WALL,
    `한 번에 ${Math.round(mb(AR.MAX_REQUEST_BYTES))}MB 는 본문 ${Math.round(mb(body))}MB 라 `
    + `벽(${Math.round(mb(WALL))}MB)을 넘는다 — 화면이 「됩니다」라고 해 놓고 조용히 끊긴다`);
  assert.ok(WALL - body >= 2 * 1024 * 1024,
    `벽까지 ${Math.round(mb(WALL - body))}MB 밖에 안 남았다 — 파일 이름·JSON 껍데기에 넘어간다`);

  // 파일 하나만 올려도 벽 안이어야 한다
  assert.ok(AR.MAX_FILE_BYTES * AR.BASE64_OVERHEAD < WALL,
    '파일 하나가 벽을 넘는다 — 한 개짜리 업로드가 끊긴다');
});

/**
 * ★★★ **읽는 중인 파일을 조용히 빼고 올리지 않는다** 〈2026-08-22 · 실제로 잃었다〉.
 *
 * ★★ 무슨 일이 있었나. 파일을 고르면 줄은 **바로** 생기지만 내용은 `FileReader`
 *   가 **나중에** 채운다. 앞 판은 「내용이 찬 것」이 하나라도 있으면 올리기
 *   단추를 열었다. 그래서 둘을 골라 곧바로 누르면 **덜 읽힌 하나가 조용히 빠진
 *   채로** 올라갔다. 화면은 「1개를 올렸습니다」라고 **맞는 말**을 하고,
 *   사용자는 2개를 골랐다 — 어긋난 것을 화면 어디서도 말하지 않는다.
 *
 * ★ 사람 손으로는 거의 안 잡힌다. 읽기는 보통 눈 깜짝할 새라 기계가 바쁠 때만
 *   재현된다. 실제로 미리보기 빌드가 45번에 한 번쯤 「이관 칸이 없다」로 멎어서
 *   발자국을 찍어 보고서야 잡았다 — 빠진 것은 pdf 였고 값이 0이었다.
 *
 * ★★ 재는 방법. 화면을 통째로 띄우지 않고 **판단하는 식 두 개를 화면 소스에서
 *   그대로 떼어 와** 값을 넣어 본다(`overRequest` 검사와 같은 방법). 브라우저를
 *   띄우는 판도 만들어 봤지만, 헤드리스에서는 읽기가 너무 빨리 끝나 **상황이
 *   안 만들어진 채 초록**이 되기 쉬웠다 — 그건 M-08 이 말하는 「부르지 않는
 *   검사」다. 여기서는 「아직 안 읽힌 파일」을 손으로 만들어 넣는다.
 */
test('★★★ 아직 읽는 중인 파일이 있으면 올리기가 잠긴다 (조용히 빠지지 않는다)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ui/platform/files.html'), 'utf8');

  /* ① 「아직 읽는 중」을 세는 식을 화면에서 떼어 온다 — 손으로 옮겨 적지 않는다.
        옮겨 적으면 화면이 바뀐 날 검사만 옛말을 하고, 그때는 아무도 모른다 */
  const rd = src.match(/var reading = state\.picked\.filter\(function \(f\) \{([\s\S]*?)\}\);/);
  assert.ok(rd, '화면에 「아직 읽는 중」을 세는 자리가 없다 — 덜 읽힌 파일이 그대로 빠진다');

  /* ② 단추를 잠그는 식도 같은 자리에서 떼어 온다 */
  const dis = src.match(/go\.disabled = ([^;]+);/);
  assert.ok(dis, '올리기 단추를 잠그는 식을 못 찾았다');
  assert.match(dis[1], /reading/,
    '단추가 「읽는 중」을 안 본다 — 하나만 읽혀도 열리고, 나머지는 조용히 빠진다');

  // eslint-disable-next-line no-new-func
  const countReading = new Function('state',
    `var reading = state.picked.filter(function (f) {${rd[1]}}); return reading.length;`);
  // eslint-disable-next-line no-new-func
  const locked = new Function('state', 'ready', 'over',
    `var reading = state.picked.filter(function (f) {${rd[1]}});`
    + `return !!(${dis[1]});`);

  const st = (picked) => ({ picked, busy: false, way: 'oneshot', limits: {} });
  const readFile = { name: 'a.pdf', size: 64, data: 'x', error: null, tooBig: false };
  const stillReading = { name: 'b.pdf', size: 64, data: null, error: null, tooBig: false };
  const failed = { name: 'c.pdf', size: 64, data: null, error: '못 읽음', tooBig: false };
  const huge = { name: 'd.pdf', size: 9e9, data: null, error: null, tooBig: true };

  /* ★★ 먼저 **옛 판이 실제로 걸리는지**를 잰다 — 하나는 읽혔고 하나는 읽는 중.
     이 조합이 바로 사용자가 파일을 잃던 자리다 */
  assert.strictEqual(countReading(st([readFile, stillReading])), 1,
    '읽는 중인 파일을 못 세고 있다');
  assert.strictEqual(locked(st([readFile, stillReading]), [readFile], null), true,
    '하나가 아직 읽는 중인데 올리기가 열린다 — 누르면 그 하나가 조용히 빠진 채로 올라간다');

  /* ★ 다 읽히면 열려야 한다. 안 그러면 이번엔 아무도 못 올린다 */
  assert.strictEqual(locked(st([readFile]), [readFile], null), false,
    '다 읽혔는데도 잠겨 있다 — 이번엔 올릴 수가 없다');

  /* ★ 못 읽은 것·너무 큰 것은 **기다릴 대상이 아니다.** 그것까지 기다리면
     영원히 안 열린다 (그 둘은 이미 화면이 이유를 말하고 있다) */
  assert.strictEqual(countReading(st([readFile, failed, huge])), 0,
    '못 읽은 파일이나 너무 큰 파일을 「읽는 중」으로 세고 있다 — 단추가 영영 안 열린다');
  assert.strictEqual(locked(st([readFile, failed, huge]), [readFile], null), false,
    '못 읽은 것·너무 큰 것 때문에 단추가 잠겼다');

  /* ★ 왜 못 누르는지를 화면이 말해야 한다. 잠긴 단추만 보면 고장으로 읽는다 */
  assert.match(src, /아직 읽는 중입니다/,
    '기다리는 이유를 화면이 말하지 않는다');
});
