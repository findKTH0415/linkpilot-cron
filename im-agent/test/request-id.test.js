'use strict';
/**
 * request_id — **요청 한 건을 가리키는 이름** 〈2026-08-26 · 감사 H-3 · D-136〉
 *
 * ★★★ 이 검사가 지키는 것은 하나다 —
 *   **같은 프로젝트를 두 번 요청하면 둘이 갈라져야 한다.**
 *
 *   앞 판은 이 이름이 **코드에 0곳**이었다. `project_id` 는 82개 파일,
 *   `status` 는 114개인데 이것만 없었다. 그래서 run-log 가 이어 붙기만 하고
 *   **어디까지가 첫 번째 요청이었는지 알 수 없었다** —
 *   지침 §11-1 이 완료의 첫 조건으로 삼은 자리다.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const request = require('../core/request.js');

/** 진짜 `im-projects/` 를 건드리지 않는다 (design-gate 에서 이미 한 번 당했다) */
function scratch(fn) {
  const saved = process.env.IM_AGENT_ROOT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-req-'));
  process.env.IM_AGENT_ROOT = dir;
  try {
    require('../core/store.js').createProjectDirs('LP-REQ-TEST');
    return fn('LP-REQ-TEST');
  } finally {
    if (saved === undefined) delete process.env.IM_AGENT_ROOT;
    else process.env.IM_AGENT_ROOT = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ───────────── 번호가 밀리지 않는가 ───────────── */

test('★★★ 닫은 요청이 다음 번호를 밀지 않는다 (실제로 났던 버그다)', () => {
  scratch((P) => {
    const a = request.open(P, { by: '김대표', docType: 'im' });
    assert.strictEqual(a.requestId, 'REQ-LP-REQ-TEST-001');
    request.close(P, a.requestId, { status: 'blocked' });

    const b = request.open(P, { by: '김대표', docType: 'im' });
    // ★ 처음 만들 때 `list()` 로 세었더니 **닫는 줄까지 세어져 -003 이 나왔다.**
    //   번호가 한 칸씩 밀리면 「몇 번째 요청인가」가 거짓이 되고,
    //   그 거짓은 값도 형식도 멀쩡해서 문서만 봐서는 안 잡힌다.
    assert.strictEqual(b.requestId, 'REQ-LP-REQ-TEST-002',
      '닫는 줄까지 세면 번호가 밀린다');
    assert.strictEqual(b.seq, 2);
  });
});

test('★★ 요청을 닫아도 `current()` 는 **연 요청**을 가리킨다', () => {
  scratch((P) => {
    const a = request.open(P, {});
    request.close(P, a.requestId, { status: 'done' });
    assert.strictEqual(request.current(P).requestId, a.requestId,
      '닫는 줄을 current 로 돌려주면 그 뒤 코드가 엉뚱한 것을 붙잡는다');
  });
});

/* ───────────── 갈라 보이는가 — 이것이 목적이다 ───────────── */

test('★★★ 같은 프로젝트의 두 요청이 갈라진다 — 이 작업의 전부다', () => {
  scratch((P) => {
    const a = request.open(P, { by: '김대표', docType: 'im' });
    request.close(P, a.requestId, { status: 'blocked', note: '연면적 충돌' });
    const b = request.open(P, { by: '김대표', docType: 'im', note: '연면적 고치고 다시' });
    request.close(P, b.requestId, { status: 'awaiting_approval' });

    const s = request.summary(P);
    assert.strictEqual(s.length, 2, '두 요청이 하나로 뭉쳤다');
    assert.notStrictEqual(s[0].requestId, s[1].requestId);
    assert.strictEqual(s[0].status, 'blocked');
    assert.strictEqual(s[1].status, 'awaiting_approval');
    assert.strictEqual(s[0].seq, 1);
    assert.strictEqual(s[1].seq, 2);
  });
});

test('★★ **어떻게 끝났는지**가 남는다 — 없으면 왜 다시 돌았는지 모른다', () => {
  scratch((P) => {
    const a = request.open(P, {});
    request.close(P, a.requestId, { status: 'blocked', note: 'RED 2건' });
    const rows = request.list(P).filter((r) => r.closing);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].note, 'RED 2건');
  });
});

test('★★ 장부는 **이어 붙이기만** 한다 — 덮으면 있었던 것이 사라진다', () => {
  scratch((P) => {
    const a = request.open(P, {});
    request.close(P, a.requestId, { status: 'done' });
    request.open(P, {});
    assert.strictEqual(request.list(P).length, 3, '줄이 덮였다 (열기·닫기·열기 = 3줄)');
  });
});

/* ───────────── 지어내지 않는가 ───────────── */

test('★★★ 무작위도 시각도 번호에 안 쓴다 — 세어서 만든다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'request.js'), 'utf8')
    // 주석을 떼고 본다 (CLAUDE.md §8)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Math\.random\(\)/.test(src), '무작위를 쓰면 같은 입력이 다른 답을 낸다');
  assert.ok(!/new Date\(|Date\.now\(\)/.test(src),
    '시각은 kstStamp() 한 곳에서만 만든다 (CLAUDE.md §5)');
  assert.match(src, /kstStamp\(\)/);
});

test('★ 깨진 줄이 있어도 번호가 안 밀린다', () => {
  scratch((P) => {
    const store = require('../core/store.js');
    const p = path.join(store.projectDir(P), request.PATH);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{ 이건 JSON 이 아니다 }\n');
    assert.strictEqual(request.open(P, {}).seq, 1, '깨진 줄을 세면 첫 요청이 2번이 된다');
  });
});

/* ───────────── 배선 — 파이프라인이 실제로 쓰는가 ───────────── */

test('★★★ 파이프라인이 요청을 열고 닫는다 — 만들어만 두면 0곳과 같다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /require\('\.\/core\/request'\)/, '파이프라인이 안 부른다');
  assert.match(src, /request\.open\(projectId/, '요청을 안 연다');
  assert.match(src, /request\.close\(projectId, req\.requestId/, '요청을 안 닫는다');
  assert.match(src, /requestId: req\.requestId/,
    '돌려주는 값에 requestId 가 없으면 부른 쪽이 그 요청을 못 가리킨다');
});

test('★★ 요청 이름이 실행 기록(run-log)에도 남는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /appendRunLog\(projectId, \{ agent: 'pipeline', status: 'request_open', requestId/,
    'run-log 에 안 남기면 「어디까지가 첫 요청인가」를 여전히 못 가른다');
});
