'use strict';
/**
 * inner-script-parses.test.js — **글자로 만든 스크립트도 파싱해 본다**
 *   〈2026-08-29 · D-178〉.
 *
 * ★★★ 미리보기의 예시 서버와 「눌러 보는 손」은 **템플릿 문자열 속의
 *   자바스크립트**다. 그래서 이 모듈 자체는 멀쩡히 파싱되고, 안에 든 글자가
 *   깨져 있어도 **아무 오류가 안 난다.** 브라우저는 그 조각을 조용히 버리고,
 *   예시 서버가 통째로 안 붙은 채 화면만 멀쩡히 뜬다 — 올리기만
 *   「전송이 끊겼습니다」로 실패한다. **오류를 안 내는 고장**이다.
 *
 *   실제로 당했다: 정규식 하나에서 역슬래시를 빼먹어 내보낸 글자가
 *   `//oneshot$/` 가 됐다(주석에서 시작하는 꼴). 미리보기 빌드만 엉뚱한
 *   자리에서 멎었고, 원인을 찾는 데 한참 걸렸다.
 *
 * ★ 그래서 **내보내는 글자를 그대로 파싱한다.** 파싱은 공짜이고, 이 한 칸이
 *   그 하루를 없앤다.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const vm = require('vm');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');

/** `<script>…</script>` 안의 알맹이만 꺼낸다 (여럿이면 전부) */
function bodies(html) {
  const out = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(String(html)))) out.push(m[1]);
  return out;
}

test('★★★ 미리보기가 끼워 넣는 스크립트가 실제로 파싱된다 (예시 서버 · 눌러 보는 손)', () => {
  const { INNER_SCRIPTS } = require(path.join(PLATFORM, 'build-files.js'));
  assert.ok(INNER_SCRIPTS, '내부 스크립트를 밖으로 안 내놓았다 — 검사가 볼 수가 없다');

  const made = {
    fakeServer: INNER_SCRIPTS.fakeServer({ maxFileBytes: 1, maxRequestBytes: 2, formats: [] }),
    uploadDriver: INNER_SCRIPTS.uploadDriver(),
  };

  Object.keys(made).forEach((name) => {
    const parts = bodies(made[name]);
    assert.ok(parts.length, `${name}: <script> 알맹이를 못 찾았다`);
    parts.forEach((code, i) => {
      try {
        new vm.Script(code, { filename: `${name}[${i}]` });
      } catch (e) {
        assert.fail(`${name} 의 ${i + 1}번째 조각이 파싱되지 않는다 — `
          + '브라우저는 이것을 조용히 버린다(오류를 안 내는 고장): ' + e.message);
      }
    });
  });
});
