'use strict';
/**
 * workflow-default.test.js — **손대지 않고 눌러도 도는가**
 * 〈2026-08-21 · 실제로 첫 실행에서 죽어서 만들었다〉
 *
 * ★★ 무슨 일이 있었나. `deploy-nas` 를 아무것도 안 고치고 그냥 띄웠더니
 *   **첫 단계에서 죽었다.**
 *
 *       ##[error]파일 없음: im-agent/ui/platform/myinfo.html
 *
 *   그런 파일은 저장소에 없다. 화면 이름을 바꾸면서 워크플로 기본값만
 *   따라오지 않은 것이다. 그 뒤로 **아무도 안 눌러 봐서** 몰랐다.
 *
 * ★★ **기본값은 「아무 값이나」가 아니다.** 사람이 Run workflow 를 누르면
 *   대개 그대로 실행한다. 기본값이 죽으면 **처음 써 보는 사람이 처음에 만나는
 *   것이 오류**다 — 그러면 장치가 고장 났다고 읽는다.
 *
 * ★ 그리고 이 종류는 **문서로는 안 잡힌다.** 안내서에는 「Run workflow 를
 *   누르세요」라고만 적혀 있고, 그 말은 여전히 맞다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const WF = path.join(ROOT, '.github', 'workflows');

/** `default: '...'` 를 뽑는다 — yaml 파서를 들이지 않는다 (§5 의존성 최소) */
function defaultOf(yml, inputName) {
  const at = yml.indexOf('\n      ' + inputName + ':\n');
  if (at < 0) return null;
  const m = /^\s+default: '([^']*)'/m.exec(yml.slice(at, at + 1200));
  return m ? m[1] : null;
}

test('★★ deploy-nas 의 기본 파일이 실제로 있다 (첫 실행에서 죽은 자리)', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const def = defaultOf(y, 'files');
  assert.ok(def, 'files 기본값을 못 찾았다');
  def.split(/\s+/).filter(Boolean).forEach((f) => {
    assert.ok(fs.existsSync(path.join(ROOT, f)),
      `기본값이 없는 파일을 가리킨다: ${f} — 손대지 않고 누르면 거기서 죽는다`);
  });
});

/**
 * ★ 있기만 하면 되는 것이 아니다. **올릴 대상**이어야 한다.
 *   저장소 안 아무 파일이나 있으면 검사를 통과하지만, 웹 루트에 올릴
 *   물건이 아니면 기본값으로는 틀린 값이다.
 */
test('★ 기본 파일이 실제로 NAS 로 올라가는 묶음에 들어 있다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const def = defaultOf(y, 'files');
  const set = new Set(require('../ui/platform/build-embed.js').required());
  def.split(/\s+/).filter(Boolean).forEach((f) => {
    assert.ok(set.has(path.basename(f)),
      `${f} 는 배포 묶음에 없다 — 기본값으로 쓰면 엉뚱한 것을 올린다`);
  });
});

/**
 * ★★ 반대쪽 — **열쇠 보고가 파일 목록에 매달리면 안 된다.**
 *   위 사고에서 `Check files` 가 먼저 죽는 바람에 `Check secrets` 가 통째로
 *   건너뛰어졌다. Secret 이 들어왔는지 보려고 띄웠는데 **그것만 못 봤다.**
 *   재는 단계를 앞에 둔다.
 */
test('★★ 열쇠를 먼저 재고 파일을 본다 — 파일이 틀려도 열쇠는 보인다', () => {
  const y = fs.readFileSync(path.join(WF, 'deploy-nas.yml'), 'utf8');
  const sec = y.indexOf('      - name: Check secrets');
  const fil = y.indexOf('      - name: Check files');
  assert.ok(sec > 0 && fil > 0, '두 단계가 다 있어야 한다');
  assert.ok(sec < fil,
    'Check files 가 먼저다 — 파일 목록이 틀리면 열쇠 보고를 통째로 못 본다');
});
