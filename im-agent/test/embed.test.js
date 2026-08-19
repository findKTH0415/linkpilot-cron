'use strict';
/**
 * embed.test.js — 이관 ②③④ (2026-08-18).
 *
 * ★★ 왜 있나: 본체가 배포용 사본을 만들면서 **원본 글자를 찾아 끼워 넣고**
 *   있었다. 앵커가 되는 줄이 한 글자만 바뀌면 치환이 빗나가고, 그러면
 *   **설정이 안 들어간 사본이 나간다** — 화면은 멀쩡히 뜨고 값만 비어 있다.
 *   실제로 새 화면(`files.html`)은 그 목록에 없어서 목록이 비었다.
 *
 * 여기서 지키는 것:
 *   ① 화면마다 브리지가 **올바른 자리**에 있다 (순서가 틀리면 조용히 덮인다)
 *   ② 배포용 사본 목록이 실제 참조와 같다
 *   ③ 브리지가 **부모 설정을 실제로 병합한다** (헤드리스 실호출)
 *   ④ NAS 반영 스크립트가 문법이 맞고 되돌리는 길을 낸다
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const embed = require('../ui/platform/build-embed.js');
const FLOW = require('../ui/platform/flow-core.js');

/* ═════════ ① 브리지 자리 ═════════ */

/**
 * ★★ **있는지만 보지 않는다.** 대입 패턴이면 브리지가 **뒤**에, 병합 패턴이면
 *   **앞**에 있어야 한다. 반대로 두면 대입이 병합을 덮어써서 설정이 사라진다 —
 *   그리고 화면은 기본값으로 멀쩡히 뜬다. 실제로 한 번 그렇게 만들었다.
 */
test('★★ 화면마다 브리지가 올바른 자리에 있다', () => {
  Object.keys(embed.GLOBALS).forEach((f) => {
    const r = embed.checkBridge(f);
    assert.strictEqual(r.ok, true, `${f}: ${r.why}`);
  });
});

test('★ 브리지가 전역 이름을 스스로 정하지 않는다 (태그가 알려 준다)', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'embed-bridge.js'), 'utf8');
  assert.match(src, /getAttribute\('data-lp-global'\)/,
    '전역 이름을 코드에 박아 두면 화면마다 브리지를 따로 만들게 된다');
  // 이름을 모르면 아무것도 하지 않는다 — 엉뚱한 전역을 건드리지 않는다
  assert.match(src, /if \(!name\) return;/);
});

test('★ 브리지가 대입이 아니라 병합한다', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'embed-bridge.js'), 'utf8');
  assert.ok(!/window\[name\] = cfg/.test(src), '대입하면 화면 기본값이 통째로 날아간다');
  assert.match(src, /Object\.keys\(src\)\.forEach/, '병합이 아니다');
  // 토큰은 헤더로만 쓰고 전역에 남기지 않는다
  assert.match(src, /delete target\.token/, '토큰이 전역에 남으면 로그·장부에 실릴 자리가 생긴다');
});

test('★ 다른 출처면 조용히 넘어가지 않고 이유를 남긴다', () => {
  const src = fs.readFileSync(path.join(PLATFORM, 'embed-bridge.js'), 'utf8');
  assert.match(src, /같은 출처가 아닙니다/, '읽기 실패 이유가 없으면 「설정이 왜 없나」를 못 찾는다');
  assert.match(src, /state\.reason/);
});

/* ═════════ ② 배포용 사본 ═════════ */

test('★ 배포용 사본 목록이 실제 참조와 같다', () => {
  const r = embed.build(null);
  // 탭 셋 + 4단계 + 브리지 + 토큰
  FLOW.TABS.forEach(t => assert.ok(r.files.includes(t.file), `${t.file} 이 빠졌다`));
  assert.ok(r.files.includes('embed-bridge.js'), '브리지가 사본에 안 들어간다');
  assert.ok(r.files.includes('tokens.css'), '토큰이 빠지면 색 없이 뜬다');
  r.files.forEach((f) => {
    assert.ok(fs.existsSync(path.join(PLATFORM, f)), `${f} 이 실제로 없다`);
    assert.match(r.manifest.files[f].sha256, /^[0-9a-f]{64}$/);
  });
});

/** ★ 확인에 걸리면 **만들지 않는다** — 설정 없는 사본이 나가는 것이 더 나쁘다 */
test('★★ 브리지가 어긋나면 사본을 만들지 않는다', () => {
  const f = path.join(PLATFORM, 'outputs.html');
  const keep = fs.readFileSync(f, 'utf8');
  try {
    fs.writeFileSync(f, keep.replace(/<script src="embed-bridge\.js"[^>]*><\/script>/, ''), 'utf8');
    assert.throws(() => embed.build(null), /브리지 확인 실패/);
  } finally { fs.writeFileSync(f, keep, 'utf8'); }
});

test('★ 사본을 실제로 쓸 수 있다 (--out)', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-out-'));
  try {
    const r = embed.build(out);
    r.files.forEach(f => assert.ok(fs.existsSync(path.join(out, f)), `${f} 이 안 써졌다`));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

/* ═════════ ④ NAS 반영 스크립트 ═════════ */

test('★ deploy/nas.sh 가 문법이 맞고 되돌리는 길을 낸다', () => {
  const p = path.join(ROOT, 'deploy', 'nas.sh');
  assert.ok(fs.existsSync(p), 'deploy/nas.sh 가 없다');
  execFileSync('bash', ['-n', p]);          // 문법 오류면 여기서 던진다
  const src = fs.readFileSync(p, 'utf8');
  // 덮어쓰기 전에 백업 — 없으면 되돌리려고 다시 tar 를 말아야 한다
  assert.match(src, /im-agent\.bak-/, '백업을 안 뜬다');
  assert.match(src, /되돌리려면/, '되돌리는 명령을 안 알려 준다');
  // 「올렸다」로 끝내지 않는다
  assert.match(src, /sha256sum/, '지문 대조가 없다 — 전송 성공이 내용 일치는 아니다');
  assert.match(src, /healthz/, '살아났는지 안 묻는다');
});

test('★ dry-run 이 아무것도 건드리지 않고 돈다', () => {
  const out = execFileSync('bash', [path.join(ROOT, 'deploy', 'nas.sh'), '--dry-run'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /dry-run/);
  assert.match(out, /되돌리려면/);
});

/* ═════════ ④ verify:nas ═════════ */

test('★★ verify:nas 는 못 잰 것을 통과로 세지 않는다', () => {
  let out = '';
  let code = 0;
  try {
    out = execFileSync('node', [path.join(__dirname, '..', 'tools', 'verify-nas.js')],
      { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { LP_BASE: '' }) });
  } catch (e) { out = e.stdout || ''; code = e.status; }
  assert.match(out, /못 잰 것은 통과가 아니다/,
    '주소가 없으면 「서버는 못 쟀다」가 보여야 한다 — 초록으로 읽히면 안 된다');
  assert.strictEqual(code, 2, '못 잰 것이 있으면 0 으로 끝나면 안 된다');
});

test('★ verify:nas 가 저장소만으로 아는 것은 실제로 잰다', () => {
  let out = '';
  try {
    out = execFileSync('node', [path.join(__dirname, '..', 'tools', 'verify-nas.js')],
      { cwd: ROOT, encoding: 'utf8' });
  } catch (e) { out = e.stdout || ''; }
  assert.match(out, /탭 셋이 flow-core 한 곳에서 나온다/);
  assert.match(out, /라우트 표/);
  assert.match(out, /읽기 6 · 쓰기 22 = 28/);
});
