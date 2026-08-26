'use strict';
/**
 * 겹친 경로를 화면이 스스로 말하는가 〈2026-08-26 · 실제로 났다〉
 *
 * ★★★ 앱 안에서 `/im-flow/im-flow/tokens.css` 로 찾다가 못 받았다.
 *   그때 띠는 **「못 받았습니다」만** 말했고, 그러면
 *
 *     ① 파일이 아직 안 올라왔다   ② 앱이 엉뚱한 자리에서 찾는다
 *
 *   이 **똑같은 문장으로 보인다.** ①이면 새로고침으로 없어지고 ②는 안 없어진다.
 *   가리지 못하면 사장님은 새로고침만 반복하시게 된다 (M-25 와 같은 결).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..', 'ui', 'platform');
const GUARDED = ['fields.html', 'files.html', 'intake.html', 'outputs.html',
  'report-flow.html', 'reports.html', 'section-preview.html'];

test('★★★ 띠를 가진 화면 **전부**가 겹침을 가려 말한다 — 하나만 고치면 나머지가 옛말을 한다', () => {
  for (const f of GUARDED) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    assert.ok(src.includes('화면에 필요한 파일을 못 받았습니다'), `${f} 에 띠가 없다`);
    assert.ok(src.includes('가 **두 번** 들어 있습니다'),
      `${f} 이 겹침을 안 가린다 — 「파일이 없다」와 「엉뚱한 자리」가 같은 문장으로 보인다`);

    /* ★★★ **재는 것을 문구에서 뜻으로 바꿨다** 〈2026-08-26 · M-56〉.
     *
     *   앞 판은 「새로고침으로는 안 없어집니다」라는 **문장이 있는지**를 쟀다.
     *   그런데 그 문장은 **고장이 났다는 전제**의 말이다 — 지금은 화면이
     *   받기 전에 자리를 바로잡아 **고장이 아예 안 난다.**
     *
     *   문구를 고정하면 **더 나은 고침을 검사가 막는다.** 실제로 이번에
     *   이 검사가 빨개졌다 — 코드는 나아졌는데.
     *
     * ★ 그래서 재려던 **뜻**만 남긴다: **겹친 경로에 새로고침을 권하지 않는다.**
     *   겹침은 새로고침으로 안 없어지고, 권하면 사장님이 헛되이 누르신다. */
    const dupBranch = src.slice(src.indexOf('if (dup) {'), src.indexOf('} else {', src.indexOf('if (dup) {')));
    assert.ok(dupBranch.length > 50, `${f} 에서 겹침 갈래를 못 찾았다`);
    assert.ok(!/새로고침/.test(dupBranch),
      `${f} 이 겹친 경로에 새로고침을 권한다 — 겹침은 새로고침으로 안 없어진다`);
  }
});

test('★★ 이 화면들의 형제 링크는 **상대 경로**다 — 앞을 붙이는 쪽이 앱이라는 근거', () => {
  // 이것이 참이어야 「덧붙이는 것은 앱 쪽」이라는 띠의 문장이 참이 된다.
  // 절대 경로로 바꾸면 그 문장이 거짓이 되므로 여기서 잡는다.
  for (const f of GUARDED) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    const links = [...src.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?v=[0-9a-f]*)?)"/g)].map(m => m[1]);
    for (const l of links) {
      assert.ok(!l.startsWith('/') && !/^https?:/.test(l),
        `${f} 의 ${l} 가 절대 경로다 — 상대 경로여야 앱이 붙이는 앞부분과 안 겹친다`);
    }
  }
});

test('★ 겹치지 않은 주소에는 그 말을 안 붙인다 — 늑대야가 되면 아무도 안 본다', () => {
  const src = fs.readFileSync(path.join(HERE, 'report-flow.html'), 'utf8');
  // 겹침을 찾는 조각과 평소 문구가 **둘 다** 있어야 한다
  assert.ok(src.includes('배포가 도는 중이면'), '평소 문구가 사라졌다');
  assert.match(src, /segs\[i\] === segs\[i \+ 1\]/,
    '이어진 같은 토막만 겹침으로 본다 — 떨어져 있는 같은 이름은 정상일 수 있다');
});
