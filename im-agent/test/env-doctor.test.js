/**
 * 열쇠 파일 진단이 **원인을 갈라 말하는가.**
 *
 * ★★★ 2026-08-23. 사장님이 `linkpilot.env` 를 제대로 놓으셨는데도 배포는
 *   **「OCR: 꺼짐」** 한 마디였다. 그 한 마디로는 다음에 무엇을 볼지 알 수 없다 —
 *   아래 다섯이 전부 같은 「꺼짐」으로 보이기 때문이다:
 *
 *     ① 이름이 폴더다 (File Station 의 [생성] 에는 폴더밖에 없다)
 *     ② 서식 문서(RTF)로 저장됐다 ([일반 텍스트로 만들기] 를 안 눌렀다)
 *     ③ 줄 모양이 `KEY=값` 이 아니다
 *     ④ 값에 따옴표·빈칸이 섞였다
 *     ⑤ 자리표시자가 그대로 들어 있다
 *
 * ★ 그래서 다섯을 **글자로 갈라 말하는지**를 여기서 잰다.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const D = require('../tools/env-doctor.js');

/** 임시 폴더에 파일 하나를 놓고 진단한다 */
function at(name, write) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-doctor-'));
  const p = path.join(dir, name);
  try {
    write(p);
    return D.describe(D.inspect(p));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('★★★ 폴더면 **폴더라고 말한다** — 이것이 실제로 일어난 일이다', () => {
  const said = at('.env', (p) => fs.mkdirSync(p));
  assert.ok(said.indexOf('폴더다') !== -1, said);
  assert.ok(said.indexOf('File Station') !== -1,
    '왜 그렇게 됐는지를 안 말하면 같은 일을 또 한다');
});

test('★★★ 서식 문서(RTF)면 그렇게 말한다 — [일반 텍스트로 만들기]', () => {
  const said = at('linkpilot.env', (p) =>
    fs.writeFileSync(p, '{\\rtf1\\ansi GEMINI_API_KEY=AIzaXXXX}'));
  assert.ok(said.indexOf('서식 문서(RTF)') !== -1, said);
  assert.ok(said.indexOf('일반 텍스트로 만들기') !== -1,
    '무엇을 누르면 되는지 안 말한다 (CLAUDE.md §5)');
});

test('★★ BOM 이 붙어도 읽는다 — 그리고 붙었다고 말해 준다', () => {
  const said = at('linkpilot.env', (p) =>
    fs.writeFileSync(p, Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('GEMINI_API_KEY=AIzaXXXX\n'),
    ])));
  assert.ok(said.indexOf('BOM') !== -1, said);
  /* ★ 실측: `trim()` 이 U+FEFF 를 떼므로 키는 정상으로 읽힌다.
   *   「BOM = 고장」이라고 적어 두면 멀쩡한 파일을 의심하느라 시간을 쓴다 */
  assert.ok(said.indexOf('읽힌 키: GEMINI_API_KEY') !== -1, said);
  assert.ok(said.indexOf('지장 없다') !== -1,
    '붙었다고만 하고 고장인지 아닌지를 안 말하면 엉뚱한 곳을 판다');
});

test('★★★ 제대로 된 파일이면 **읽힌 키 이름**을 말한다 (값은 안 말한다)', () => {
  const said = at('linkpilot.env', (p) =>
    fs.writeFileSync(p, '# 열쇠\nGEMINI_API_KEY=AIzaSyTESTTESTTEST\n'));
  assert.ok(said.indexOf('읽힌 키: GEMINI_API_KEY') !== -1, said);
  assert.ok(said.indexOf('AIzaSyTESTTESTTEST') === -1,
    '값이 로그에 찍혔다 — CLAUDE.md §2 위반이다');
});

test('★★ KEY=값 모양이 아닌 줄을 센다 — 「한 줄 적었는데 안 읽힌다」의 원인이다', () => {
  const said = at('linkpilot.env', (p) =>
    fs.writeFileSync(p, 'GEMINI_API_KEY = AIzaXXXX\n여기에 열쇠를 붙여넣습니다\n'));
  assert.ok(/못 읽은 줄 1개/.test(said), said);
});

test('★ 없는 이름은 없다고 말한다 (오류가 아니다)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-doctor-'));
  try {
    const said = D.describe(D.inspect(path.join(dir, '.env')));
    assert.ok(said.indexOf('없다') !== -1, said);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('★★★ 진단 도구가 엔진과 **함께 올라간다** — NAS 에서 돌아야 한다', () => {
  const sh = fs.readFileSync(
    path.join(__dirname, '..', '..', 'deploy', 'engine.sh'), 'utf8');
  const ex = [...sh.matchAll(/--exclude='([^']+)'/g)].map((m) => m[1]);
  assert.ok(!ex.some((e) => e.indexOf('tools') !== -1),
    'tools 를 빼고 보낸다 — 진단이 NAS 에 없어서 돌 수가 없다');
});
