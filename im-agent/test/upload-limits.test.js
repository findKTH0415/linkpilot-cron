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
