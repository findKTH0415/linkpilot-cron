'use strict';
/**
 * 「LinkPilot 외부 업무지침」 대조 테스트.
 *
 * 이 지침은 협력사에 배포된 문서다. 앱이 문서와 갈리면 내부 버그와 성격이 다르다 —
 * "지침에는 된다는데 안 된다"는 문의가 외부에서 들어오고, 그때는 이미 늦었다.
 *
 * 그래서 문서의 확정 사실만 여기에 상수로 박고, 코드가 벗어나면 깨지게 둔다.
 * 지침을 고치면 이 파일도 같이 고친다 — 그 순간이 '문서도 고쳐야 한다'는 신호다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const K = require('../ui/platform/catalog.js');
const IA = require('../ui/platform/inapp.js');
const API = require('../ui/report-api.cjs');

const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), 'utf8');

// ── §2 계정과 권한 ────────────────────────────────────────────────

test('★ 무료 이용 범위가 지침 §2 와 정확히 같다', () => {
  // 지침: 무료 — 할일 · 연락처 · 프로젝트 · 캘린더 · Q&A · 투자소스 DB
  assert.deepStrictEqual(K.free().map(f => f.name), K.GUIDE_FREE);
});

test('★ 유료 기능 목록이 지침 §2 와 정확히 같다', () => {
  assert.deepStrictEqual(K.paid().map(f => f.name), K.GUIDE_PAID);
});

test('무료 기능은 로그인하지 않아도 잠기지 않는다', () => {
  // 지침의 무료 칸은 '계정이 있으면 쓸 수 있는 것'이다. 잠그면 문서와 어긋난다
  K.free().forEach((f) => {
    assert.strictEqual(K.unlocked({ authenticated: false }, f), true, f.name);
  });
});

test('★ 유료 기능은 무료 계정에서 잠긴다 (숨기지 않는다)', () => {
  // 지침: "유료 기능은 무료 계정에서도 메뉴에 보이되 잠겨 있습니다."
  const freeUser = { authenticated: true, planId: 'free', status: 'active' };
  K.paid().forEach((f) => {
    assert.strictEqual(K.unlocked(freeUser, f), false, f.name + ' 이 무료에서 열렸다');
    assert.ok(K.byName(f.name), f.name + ' 이 카탈로그에 없다 — 메뉴에 보일 수 없다');
  });
});

test('플랜을 모르거나 만료면 잠근다', () => {
  const f = K.byName('아침브리핑');
  for (const s of [
    { authenticated: true, planId: null },
    { authenticated: true, planId: '' },
    { authenticated: true, planId: 'enterprise-v2' },   // 오타·미지의 코드
    { authenticated: true, planId: 'pro', status: 'expired' },
  ]) {
    assert.strictEqual(K.unlocked(s, f), false, JSON.stringify(s));
  }
});

test('★ 보고서 생성은 Pro — 지침이 등급까지 적은 유일한 항목', () => {
  const rep = K.byName('보고서 생성');
  assert.strictEqual(rep.minPlan, 'pro');
  assert.strictEqual(rep.byGuide, true, '지침에 적힌 등급이므로 임의로 못 바꾼다');
  assert.strictEqual(K.unlocked({ authenticated: true, planId: 'basic', status: 'active' }, rep), false);
  assert.strictEqual(K.unlocked({ authenticated: true, planId: 'pro', status: 'active' }, rep), true);
});

test('★ 서버의 보고서 종류별 플랜이 지침(Pro)을 넘지 않는다', () => {
  // 화면과 서버가 갈리면 화면은 열리고 생성은 403 이 된다
  Object.entries(API.DOC_PLANS).forEach(([docType, need]) => {
    assert.ok(API.PLAN_RANK[need] <= API.PLAN_RANK.pro,
      `${docType} = ${need} — 지침 §2 '보고서 생성 (Pro)' 와 어긋난다`);
  });
});

test('화면(reports.html)의 minPlan 이 서버 DOC_PLANS 와 같다', () => {
  const html = read('reports.html');
  const found = {};
  const re = /\{\s*id:\s*'([a-z]+)',\s*name:[^,]+,\s*minPlan:\s*'([a-z]+)'/g;
  let m;
  while ((m = re.exec(html))) found[m[1]] = m[2];
  Object.keys(API.DOC_PLANS).forEach((k) => {
    if (found[k]) assert.strictEqual(found[k], API.DOC_PLANS[k], k + ' 의 등급이 화면과 서버에서 다르다');
  });
  assert.ok(Object.keys(found).length >= 3, '화면에서 보고서 종류를 못 찾았다 — 정규식이 낡았다');
});

test('★ 플랜 카드에 지침에 없는 한도를 적지 않는다', () => {
  // '프로젝트 3건' 같은 근거 없는 숫자가 다시 들어오면 협력사 문서와 갈린다
  ['membership.html', 'upgrade.html'].forEach((f) => {
    const plans = read(f).split('plans:')[1] || '';
    const head = plans.slice(0, 900);
    assert.ok(!/프로젝트\s*\d+건|프로젝트\s*무제한/.test(head),
      f + ' 의 플랜 카드에 지침에 없는 프로젝트 한도가 있다');
  });
});

// ── §1 접속 방법 ──────────────────────────────────────────────────

test('★ 정상 브라우저를 인앱으로 오인하지 않는다', () => {
  // 오탐이 미탐보다 나쁘다 — 멀쩡한 사용자에게 "브라우저를 바꾸라"고 하면 못 쓰는 줄 안다
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Whale/3.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/127.0 Mobile/15E148 Safari/604.1',
  ].forEach((ua) => {
    assert.strictEqual(IA.detect(ua).inApp, false, ua.slice(0, 60));
  });
});

test('★ 카카오톡·라인 인앱 브라우저를 잡는다', () => {
  const kakao = IA.detect('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.4.5');
  assert.strictEqual(kakao.inApp, true);
  assert.strictEqual(kakao.name, '카카오톡');
  assert.strictEqual(kakao.os, 'android');

  const line = IA.detect('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) '
    + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.6.0');
  assert.strictEqual(line.inApp, true);
  assert.strictEqual(line.os, 'ios');
});

test('탈출 경로 — 카카오톡은 공식 스킴, iOS 는 주소 복사', () => {
  const url = 'https://example.invalid/linkpilot-platform.html';

  const kakao = IA.escapeRoute(IA.detect('... KAKAOTALK 10.4.5 Android'), url);
  assert.strictEqual(kakao.kind, 'scheme');
  assert.ok(kakao.url.indexOf('kakaotalk://web/openExternal?url=') === 0);
  assert.ok(kakao.url.indexOf(encodeURIComponent(url)) > -1, '주소가 인코딩되어 실려야 한다');

  // ★ iOS 인앱(카카오·라인 외)은 외부 브라우저를 강제로 열 수 없다.
  //   억지로 스킴을 던지면 아무 일도 안 일어나고 사용자는 고장으로 본다 — 지침대로 복사를 준다
  const ios = IA.escapeRoute({ inApp: true, app: 'instagram', os: 'ios' }, url);
  assert.strictEqual(ios.kind, 'copy');
  assert.strictEqual(ios.url, null);
  assert.match(ios.hint, /Safari/);

  const android = IA.escapeRoute({ inApp: true, app: 'instagram', os: 'android' }, url);
  assert.strictEqual(android.kind, 'intent');
  assert.ok(android.url.indexOf('intent://') === 0);
  assert.ok(android.url.indexOf('package=com.android.chrome') > -1);
});

// ── 지침 화면 자체 ────────────────────────────────────────────────

test('★ 지침 화면에 내부 접속 주소를 박아두지 않는다', () => {
  // 저장소는 공개다 (CLAUDE.md §2). 주소는 실행 중에 만들거나 설정으로 넣는다
  const html = read('guide.html');
  assert.ok(!/\.ts\.net|synologynas|192\.168\./.test(html),
    'guide.html 에 내부 호스트가 들어갔다');
  assert.match(html, /url:\s*null/, '설정으로 주입할 자리가 있어야 한다');
});

test('지침 9개 절이 모두 화면에 있다', () => {
  const html = read('guide.html');
  ['접속 방법', '계정과 권한', '자료 공유 규칙', '동영상 올릴 때', '프로젝트 협업',
    '미팅 잡기', '보고서', '보안 및 비밀유지', '문제가 생기면'].forEach((t) => {
    assert.ok(html.indexOf(t) > -1, '누락된 절: ' + t);
  });
  for (let i = 1; i <= 9; i++) {
    assert.ok(html.indexOf('id="s' + i + '"') > -1, '누락된 앵커: s' + i);
  }
});

test('★ 등급표를 손으로 적지 않는다 (카탈로그가 그린다)', () => {
  // 표를 정적 HTML 로 적으면 플랜을 바꿀 때 문서만 옛날 값으로 남는다
  const html = read('guide.html');
  assert.ok(html.indexOf('id="grade-body"') > -1);
  const table = html.split('grade-body')[1].split('</table>')[0];
  K.GUIDE_PAID.forEach((name) => {
    assert.ok(table.indexOf(name) === -1, name + ' 이 표에 하드코딩돼 있다');
  });
});

test('유료 화면들이 카탈로그·인앱 배너를 싣는다', () => {
  ['guide.html', 'reports.html', 'membership.html', 'upgrade.html'].forEach((f) => {
    const html = read(f);
    assert.ok(/src="catalog\.js"/.test(html), f + ' 에 catalog.js 가 없다');
    assert.ok(/src="inapp\.js"/.test(html), f + ' 에 inapp.js 가 없다');
    assert.ok(/applyLocks/.test(html), f + ' 이 메뉴 잠금을 적용하지 않는다');
  });
});

test('script 태그가 짝이 맞는다', () => {
  // 주석 안의 </script> 하나로 화면이 통째로 죽은 적이 있다 (오류도 안 난다)
  ['guide.html'].forEach((f) => {
    const html = read(f);
    const open = (html.match(/<script\b/g) || []).length;
    const close = (html.match(/<\/script>/g) || []).length;
    assert.strictEqual(open, close, f + ' 의 script 태그 짝이 안 맞는다');
  });
});
