'use strict';
/**
 * upload-stall.test.js — **멈춘 것과 느린 것은 다르다** (2026-08-22).
 *
 * ★★ 실제 신고 화면: 8.7MB 를 올리는데 자취가 **6.1초 동안 평평했다.**
 *   145번을 쟀는데 한 번도 늘지 않았다. 그런데 화면은 그냥 「보내는 중」이었고,
 *   사용자는 기다릴지 다시 누를지 정할 근거가 없었다.
 *
 * ★ `upload-core.js` 머리말에는 그때도 「조용히 죽지 않는다」가 적혀 있었다.
 *   **적어 두는 것과 재는 것은 다른 일이다** — `onerror` 는 연결이 **죽어야**
 *   온다. 앞단이 본문을 안 받아 주면서 붙들고 있으면 아무 이벤트도 안 온다.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const UP = require(path.join(__dirname, '..', 'ui', 'platform', 'upload-core.js'));

/** 아무 일도 일어나지 않는 XHR — 열리고, 보내지고, 그대로 멎는다 */
function stubXHR() {
  const made = [];
  function X() { this.upload = {}; this.withCredentials = false; this.timeout = 0; made.push(this); }
  X.prototype.open = function () {};
  X.prototype.setRequestHeader = function () {};
  X.prototype.send = function () {};      // ★ 보내고 아무 소식이 없다
  X.prototype.abort = function () {};
  global.XMLHttpRequest = X;
  return made;
}

/** 시험이 끝나면 반드시 감시를 끈다 — 안 끄면 시험 과정이 안 죽는다 */
function finish(xhr) { if (xhr && typeof xhr.onerror === 'function') xhr.onerror(); }

test('★★ 진행이 멎으면 화면에 말한다 (사유와 크기를 함께)', async () => {
  const made = stubXHR();
  const seen = [];
  UP.send({
    url: 'https://example.invalid/x',
    files: [{ name: 'ㄱ.pdf', contentBase64: 'QUFB'.repeat(4000) }],
    onUpdate: (u) => seen.push(u),
    onFail: () => {},
    stallMs: 120,          // 시험용으로만 줄인다. 기본값(12초)은 그대로다
  });
  assert.strictEqual(made.length, 1, 'XHR 을 안 만들었다');
  try {
    await new Promise((r) => setTimeout(r, 500));

    const stall = seen.find((u) => u.stalled);
    assert.ok(stall, '멎었는데 아무 말도 안 한다 — 화면은 영원히 「보내는 중」이다');
    assert.match(stall.stallWhy || '', /늘지 않습니다/, '왜 멈춤으로 봤는지를 안 적는다');
    assert.match(stall.stallWhy || '', /본문 크기|한도/,
      '무엇을 해야 하는지가 없다 — 사유만 주면 같은 파일을 또 올린다');
    assert.ok(stall.bodyBytes > 0, '보내는 양을 안 알려 준다 — 원인 찾기의 첫 단서다');
    assert.notStrictEqual(stall.phase, 'error',
      '아직 실패한 것이 아니다 — 빨간 칸으로 그리면 다 끝난 줄 안다');

    // ★ 한 번만 말한다. 매초 같은 말을 쌓으면 화면이 경고로 뒤덮인다
    assert.strictEqual(seen.filter((u) => u.stalled).length, 1, '멈춤 경고가 여러 번 나온다');

    // ★ 영원히 매달려 있지 않게 천장이 있어야 한다
    assert.ok(made[0].timeout > 0, 'xhr.timeout 이 없다 — 안 끝나는 요청이 영원히 남는다');
  } finally { finish(made[0]); }
});

test('★ 진행이 있으면 멈춤이라고 하지 않는다 (느린 회선을 고장으로 만들지 않는다)', async () => {
  const made = stubXHR();
  const seen = [];
  UP.send({
    url: 'https://example.invalid/x',
    files: [{ name: 'ㄱ.pdf', contentBase64: 'QUFB' }],
    onUpdate: (u) => seen.push(u),
    onFail: () => {},
    stallMs: 200,
  });
  try {
    for (let i = 1; i <= 8; i += 1) {
      await new Promise((r) => setTimeout(r, 60));
      made[0].upload.onprogress({ loaded: i * 100, total: 800, lengthComputable: true });
    }
    assert.ok(!seen.some((u) => u.stalled),
      '진행 중인데 멈췄다고 했다 — 느린 회선을 고장으로 만든다');
  } finally { finish(made[0]); }
});

test('★ 멎었다가 다시 움직이면 경고를 거둔다', async () => {
  const made = stubXHR();
  const seen = [];
  UP.send({
    url: 'https://example.invalid/x',
    files: [{ name: 'ㄱ.pdf', contentBase64: 'QUFB'.repeat(100) }],
    onUpdate: (u) => seen.push(u),
    onFail: () => {},
    stallMs: 120,
  });
  try {
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(seen.some((u) => u.stalled), '먼저 멈춤이 잡혀야 이 시험이 뜻이 있다');
    // 다시 움직인다
    made[0].upload.onprogress({ loaded: 500, total: 1000, lengthComputable: true });
    const after = seen[seen.length - 1];
    assert.ok(!after.stalled, '다시 움직이는데 아직 멈춤이라고 한다');
  } finally { finish(made[0]); }
});
