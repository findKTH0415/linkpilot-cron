/**
 * **열쇠가 배포마다 조용히 지워지고 있었다.**
 *
 * ★★★ 2026-08-24. 배포의 열쇠 단계는 `cat > linkpilot.env` 로 파일을 통째로
 *   덮으면서 **`GEMINI_API_KEY` 한 줄만** 다시 썼다. 그래서 NAS 에 손으로 넣어
 *   둔 `VWORLD_KEY` 같은 값이 **배포할 때마다 사라졌다.**
 *
 *   ★ 증상이 고약하다 — 지적도가 없으면 매스가 직사각형으로 서고 조감도가
 *     아예 안 나오는데, 그것이 **정상 동작처럼 보인다.** 「원래 그런가 보다」로
 *     읽히는 실패가 이 저장소에서 가장 비싸다.
 *
 * ★ 여기서 재는 것:
 *   ① 배포가 아는 열쇠를 **전부** Secret 에서 받아 쓰는가
 *   ② 사라진 키의 **이름을 대고 말하는가** (조용히 없어지지 않는가)
 *   ③ Secret 이 하나도 없으면 **안 건드리는가**
 *   ④ 값을 로그·명령줄로 흘리지 않는가 (§2)
 *   ⑤ 지적도 켜짐/꺼짐/못 잼 **셋을 가르는가** (못 잰 것은 꺼진 것이 아니다)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WF = fs.readFileSync(
  path.join(__dirname, '..', '..', '.github', 'workflows', 'deploy-nas.yml'), 'utf8');

/** ★ 주석을 떼고 본다 — 경위를 잘 적어 둘수록 검사가 눈이 먼다 (CLAUDE.md §8) */
const CODE = WF.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

function step(name) {
  const i = CODE.indexOf(`- name: ${name}`);
  assert.ok(i !== -1, `단계가 없다: ${name}`);
  const j = CODE.indexOf('\n      - name:', i + 10);
  return CODE.slice(i, j === -1 ? CODE.length : j);
}

const WRITE = () => step('Write engine keys (열쇠 파일)');

test('★★★ 아는 열쇠를 전부 Secret 에서 받는다 — 하나만 쓰면 나머지가 지워진다', () => {
  const s = WRITE();
  ['GEMINI_API_KEY', 'VWORLD_KEY', 'VWORLD_DOMAIN', 'DATA_GO_KR_KEY',
    'ECOS_API_KEY', 'KMA_APIHUB_KEY', 'REB_API_KEY', 'KOSIS_API_KEY',
    'DART_API_KEY', 'LAW_OC'].forEach((n) => {
    assert.ok(s.indexOf(`${n}: \${{ secrets.${n} }}`) !== -1, `${n} 를 안 받는다`);
    assert.ok(new RegExp(`NAMES=.*\\b${n}\\b`).test(s), `${n} 가 쓰는 목록에 없다`);
  });
});

test('★★★ 앞 파일에만 있던 열쇠의 **이름을 대고 말한다**', () => {
  const s = WRITE();
  assert.ok(/OLDKEYS=/.test(s), '앞 파일의 키 이름을 안 읽는다');
  assert.ok(/LOST=/.test(s), '사라진 것을 안 모은다');
  assert.ok(/::warning::.*앞 파일에 있던 열쇠/.test(s),
    '사라진 것을 조용히 넘긴다 — 이 저장소에서 가장 비싼 실패다');
});

test('★★ Secret 이 하나도 없으면 파일을 안 건드린다', () => {
  const s = WRITE();
  assert.ok(/if \[ -z "\$HAVE" \]; then/.test(s), '빈 값으로 덮을 수 있다');
  assert.ok(/안 건드렸다/.test(s));
});

test('★★★ 값을 명령줄로 안 넘긴다 — NAS 프로세스 목록에 뜬다 (§2)', () => {
  const s = WRITE();
  /* 값은 파일 → stdin 으로만 흐른다 */
  assert.ok(/KEYFILE=\$\(mktemp\)/.test(s), '임시 파일을 안 쓴다');
  assert.ok(/< "\$KEYFILE"/.test(s), 'stdin 으로 안 넘긴다');
  assert.ok(/rm -f "\$KEYFILE"/.test(s), '임시 파일을 안 지운다');
  /* 열쇠 이름이 echo 되는 것은 괜찮다 — 값이 아니다. 값이 찍히는 꼴만 잡는다 */
  assert.ok(!/echo .*\$GEMINI_API_KEY/.test(s), '값을 찍는다');
  assert.ok(!/echo .*\$VWORLD_KEY/.test(s), '값을 찍는다');
});

test('★★ 되돌릴 자리를 먼저 만들고 파일 권한을 좁힌다', () => {
  const s = WRITE();
  assert.ok(/cp -p linkpilot\.env 'linkpilot\.env\.bak-/.test(s), '되돌릴 자리가 없다');
  assert.ok(/chmod 600 linkpilot\.env/.test(s),
    '덮어쓸 때는 umask 가 안 먹는다 — 이미 있는 파일은 모드를 지킨다');
});

/* ── 지적도를 재는가 ─────────────────────────────────────── */

test('★★★ 지적도 켜짐·꺼짐·못 잼 **셋을 가른다** — 못 잰 것은 꺼진 것이 아니다', () => {
  const s = step('Check map power (지적도·공시지가)');
  assert.ok(/env-doctor\.js --keys/.test(s), '엔진 자신에게 안 묻는다');
  assert.ok(/못 쟀다/.test(s), '못 잰 것을 꺼진 것으로 센다 (M-11 · M-12 · M-30)');
  assert.ok(/::notice::.*지적도가 켜져 있다/.test(s));
  assert.ok(/::warning::.*지적도가 꺼져 있다/.test(s));
  assert.ok(/조감도가 아예 안 그려진다/.test(s),
    '꺼졌을 때 무엇이 안 나오는지를 안 말한다 — 「원래 그런가 보다」가 된다');
});

/* ── 진단기가 값을 안 찍는가 ─────────────────────────────── */

test('★★★ --keys 는 이름과 길이만 찍는다 — 값은 한 글자도 안 찍는다 (§2)', () => {
  const { execFileSync } = require('node:child_process');
  const SECRET = 'SUPERSECRETVALUE1234567890';
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '..', 'tools', 'env-doctor.js'), '--keys'],
    { encoding: 'utf8', env: { ...process.env, VWORLD_KEY: SECRET, VWORLD_DOMAIN: 'https://x.example/a.html' } });
  assert.ok(out.indexOf(SECRET) === -1, '값이 로그에 그대로 찍혔다');
  assert.ok(/VWORLD_KEY\(\d+자\)/.test(out), '길이를 안 적는다');
  assert.ok(/지적·위성지도\(VWorld\): 켜짐/.test(out));
});

test('★★ 열쇠가 없으면 꺼짐으로 적고, 도메인이 비면 그 사실을 따로 말한다', () => {
  const { execFileSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.VWORLD_KEY; delete env.VWORLD_DOMAIN;
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '..', 'tools', 'env-doctor.js'), '--keys'],
    { encoding: 'utf8', env });
  assert.ok(/지적·위성지도\(VWorld\): \*\*꺼짐\*\*/.test(out));
  assert.ok(/VWORLD_DOMAIN: \*\*비어 있다\*\*/.test(out),
    '도메인이 빈 것은 키가 빈 것과 다른 원인이다 (§4.1)');
});

test('★ 스킴 없는 도메인을 잡는다 — 간헐적 거부의 원인이라 가장 안 잡힌다', () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '..', 'tools', 'env-doctor.js'), '--keys'],
    { encoding: 'utf8', env: { ...process.env, VWORLD_KEY: 'k'.repeat(36), VWORLD_DOMAIN: 'nas.example/a.html' } });
  assert.ok(/스킴\(https:\/\/\)이 없다/.test(out));
});

/* ── 안내 문서가 사람 말로 되어 있는가 ───────────────────── */

test('★★ 안내 문서가 막히는 자리를 **미리** 짚는다 (CLAUDE.md §5)', () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', '지적도-켜는-법-VWORLD-키.md'), 'utf8');
  assert.ok(/여기서 대개 막힙니다|여기가 함정입니다|여기가 제일 중요합니다/.test(doc),
    '막히기 쉬운 곳을 미리 안 짚는다');
  assert.ok(doc.indexOf('dry_run') !== -1 && /초록으로 끝나는데 아무것도 안 올라갑니다/.test(doc),
    'dry_run 기본값 함정을 안 적었다 — 실제로 두 번 당했다');
  assert.ok(/터미널은 안 씁니다/.test(doc),
    '마우스로 되는 길을 먼저 준다고 안 밝혔다');
  assert.ok(/못 쟀다/.test(doc), '「꺼짐」과 「못 쟀다」를 안 가른다');
});

/* ── 값에 줄바꿈이 섞이면 파일이 깨진다 ───────────────────── */

/**
 * ★★★ **NAS 파일이 실제로 깨져 있었다** 〈2026-08-24〉.
 *
 *   배포가 3개를 썼는데 진단은 이렇게 말했다:
 *
 *     linkpilot.env — 207바이트 · **7줄** · 읽힌 키: GEMINI_API_KEY,
 *     **VWORLD_KEY, VWORLD_KEY**, LAW_OC · **못 읽은 줄 1개**
 *
 *   Secret 칸에 붙여 넣을 때 줄바꿈이 딸려 오면 한 줄이 여러 줄이 된다.
 *   뒤 조각은 쓰레기 줄이 되거나 **다른 키를 덮어쓴다.**
 *
 * ★ 무서운 것은 **아무도 안 죽는다**는 점이다. 배포는 초록이고 파일도 생긴다 —
 *   값만 조용히 틀린다.
 */

test('★★★ 배포가 값의 줄바꿈을 떼고 싣는다 — 안 떼면 파일이 깨진다', () => {
  const s = WRITE();
  assert.ok(/tr -d '\\r\\n'/.test(s), '줄바꿈을 안 뗀다 — 한 줄이 여러 줄이 된다');
  assert.ok(/DIRTY=/.test(s), '어느 Secret 이 더러운지 안 모은다');
  assert.ok(/::warning::.*줄바꿈이 섞인 Secret/.test(s),
    '조용히 떼기만 한다 — 값 자체가 틀렸을 수 있는데 아무도 모른다');
  /* ★ 이름만 댄다. 값은 한 글자도 안 찍는다 (§2) */
  assert.ok(!/echo.*\$clean/.test(s), '다듬은 값을 찍는다');
});

test('★★★ 진단이 **같은 키가 두 번**과 **못 읽은 줄**을 말한다', () => {
  const fs2 = require('node:fs');
  const os2 = require('node:os');
  const doctor = path.join(__dirname, '..', 'tools', 'env-doctor.js');
  /* ★ 진단은 저장소 뿌리에서 읽는다 — 거기 표본을 잠깐 둔다 */
  const target = path.join(__dirname, '..', '..', 'linkpilot.env');
  assert.ok(!fs2.existsSync(target), '저장소 뿌리에 진짜 열쇠 파일이 있다 — 덮지 않는다');
  try {
    fs2.writeFileSync(target, 'GEMINI_API_KEY=a\nVWORLD_KEY=b\n부서진줄\nVWORLD_KEY=c\n', 'utf8');
    const { execFileSync } = require('node:child_process');
    const out = execFileSync(process.execPath, [doctor, '--keys'], { encoding: 'utf8' });
    assert.ok(/같은 키가 두 번 있다: VWORLD_KEY/.test(out),
      `중복을 안 잡는다 — 이것이 이번 사고를 드러낸 단서였다:\n${out}`);
    assert.ok(/KEY=값 모양이 아닌 줄이 1개/.test(out), out);
  } finally {
    fs2.rmSync(target, { force: true });
    void os2;
  }
});

test('★★ 멀쩡한 파일에는 아무 말도 안 붙인다 (헛울음 금지)', () => {
  const fs2 = require('node:fs');
  const doctor = path.join(__dirname, '..', 'tools', 'env-doctor.js');
  const target = path.join(__dirname, '..', '..', 'linkpilot.env');
  assert.ok(!fs2.existsSync(target));
  try {
    fs2.writeFileSync(target, 'GEMINI_API_KEY=a\nVWORLD_KEY=b\n', 'utf8');
    const { execFileSync } = require('node:child_process');
    const out = execFileSync(process.execPath, [doctor, '--keys'], { encoding: 'utf8' });
    assert.ok(!/같은 키가 두 번/.test(out), out);
    assert.ok(!/KEY=값 모양이 아닌 줄/.test(out), out);
  } finally {
    fs2.rmSync(target, { force: true });
  }
});
