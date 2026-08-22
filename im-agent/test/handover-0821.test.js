'use strict';
/**
 * handover-0821.test.js — 2026-08-21 인계 지시서가 **코드와 같은 말을 하는가**.
 *
 * ★★ 인계 지시서는 받는 사람이 **그대로 따라 하는** 문서다. 여기 적힌 파일
 *   목록·라우트 수·이벤트 이름·설정 키가 코드와 갈리면, 갈린 줄 모르고 따라
 *   하다가 **빠뜨린 파일 하나 때문에 탭 옮기기가 통째로 죽는다.**
 *   그리고 그 원인은 문서를 의심하기 전까지 안 보인다.
 *
 * ★ 앞 판(2026-08-20)이 실제로 그렇게 갈렸다 — 갈래 제목에서 괄호를 뗐더니
 *   지시서만 옛 이름을 말하고 있었다. 그래서 **세어서 맞추는 검사**를 둔다.
 *
 * ★ 여기서 검사하는 것은 「문서가 예쁜가」가 아니라 **「따라 하면 되는가」**다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DOC = fs.readFileSync(path.join(ROOT, 'docs', '작업인계-지시서-2026-08-21.md'), 'utf8');
const PLATFORM = path.join(__dirname, '..', 'ui', 'platform');

const F = require('../ui/platform/flow-core.js');
const embed = require('../ui/platform/build-embed.js');
const W = require('../ui/report-api.cjs');
const R = require('../ui/api-router.cjs');

/* ═════════ ① 올릴 파일 목록이 실제와 같다 ═════════ */

test('★★ 인계서의 배포 파일 목록이 build-embed 가 내는 것과 **한 글자도 다르지 않다**', () => {
  // 하나만 빠져도 화면이 색 없이 뜨거나 탭 옮기기가 죽는데, **오류는 안 난다**
  const got = embed.build(null).files
    .map(f => (typeof f === 'string' ? f : (f.name || f.rel)))
    .filter(Boolean);

  assert.ok(DOC.includes(`**${got.length}개**`),
    `인계서의 파일 개수가 실제(${got.length}개)와 다르다`);

  got.forEach((name) => {
    assert.ok(DOC.includes(name), `인계서에 올릴 파일 '${name}' 이 없다 — 빠뜨리면 조용히 깨진다`);
  });

  // ★ 반대쪽도 본다. **목록 칸 안에만** 적용한다 — 본문에서 설명 삼아 부르는
  //   엔진 파일(`core/ocr.js` 같은 것)까지 잡으면 검사가 시끄러워지고,
  //   시끄러운 검사는 결국 아무도 안 본다
  const mark = '### 올라가야 하는';
  const at = DOC.indexOf(mark);
  assert.ok(at > -1, '올릴 파일 목록 칸이 없다');
  const fence = DOC.slice(DOC.indexOf('```', at) + 3);
  const listed = (fence.slice(0, fence.indexOf('```')).match(/[a-z-]+\.(?:js|html|css)\b/g) || []);
  assert.equal(listed.length, got.length,
    `목록 칸에 적힌 것이 ${listed.length}개, 실제는 ${got.length}개다`);
  const known = new Set(got);
  listed.forEach((name) => {
    assert.ok(known.has(name), `인계서가 배포 목록에 없는 '${name}' 를 올리라고 말한다`);
  });
});

/* ═════════ ② 라우트 수 ═════════ */

test('★ 인계서의 라우트 수가 코드와 같다', () => {
  const w = W.ROUTES.length;
  const r = R.ROUTES.length;
  assert.ok(DOC.includes(`라우트 28 → **${w + r}**`),
    `라우트 수가 다르다 — 실제 읽기 ${r} · 쓰기 ${w} = ${w + r}`);
});

/* ═════════ ③ 탭 옮기기 계약 — 이름·값을 손으로 적으면 갈린다 ═════════ */

test('★★ 인계서가 말하는 탭 옮기기 계약이 flow-core 와 같다', () => {
  assert.ok(DOC.includes('`' + F.OPEN_EVENT + '`'),
    `인계서에 알림 이름 '${F.OPEN_EVENT}' 이 없다`);
  // section 값은 앱이 그대로 비교하는 문자열이다 — 여기서 갈리면 탭이 안 열린다
  assert.ok(DOC.includes(`'${F.SECTION.id}'`),
    `인계서의 section 값이 flow-core 의 SECTION.id('${F.SECTION.id}') 와 다르다`);
  // ★ 「받았다」의 증거를 반드시 말해야 한다. 안 적으면 앱이 안 하고, 안 하면
  //   탭은 바뀌는데 「스스로 옮길 수 없습니다」가 같이 뜬다
  assert.ok(DOC.includes('preventDefault()'),
    '「받았다」를 어떻게 답하는지 안 적혀 있다');

  // 화면이 실제로 그 값을 쏘는가 (문서만 맞고 코드가 다르면 소용없다)
  const html = fs.readFileSync(path.join(PLATFORM, 'files.html'), 'utf8');
  assert.match(html, /section: F\.SECTION\.id/, '화면이 섹션 값을 flow-core 에서 안 가져온다');
  assert.match(html, /step: 'fields'/, '화면이 2단계로 넘긴다고 말하지 않는다');
});

/* ═════════ ④ 읽기 배선 이름 ═════════ */

test('★★ 인계서가 붙이라는 배선 이름을 엔진이 실제로 본다', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'ui', 'report-api.cjs'), 'utf8');
  ['extractFiles', 'extractOneshot'].forEach((k) => {
    assert.ok(DOC.includes(k), `인계서에 '${k}' 가 없다`);
    assert.ok(api.includes(`d.${k}`), `엔진이 '${k}' 를 안 본다 — 문서만 그렇게 말한다`);
  });
  // 새 길의 주소도 표와 같아야 한다
  const scan = W.ROUTES.filter(x => x.path === '/projects/:id/scan');
  assert.equal(scan.length, 1, '스캔 길이 라우트 표에 없다');
  assert.ok(DOC.includes('POST /projects/:id/scan'), '인계서에 스캔 길 주소가 없다');
});

/* ═════════ ④-2 응답 칸 이름 — 앱이 그대로 읽는 값이다 ═════════ */

/**
 * ★★ 인계서가 「이 칸을 보세요」라고 한 이름이 서버가 실제로 내는 이름과
 *   달라지면, 앱은 `undefined` 를 읽고 **아무 오류 없이 빈 화면**을 그린다.
 *   그래서 칸 이름을 코드에서 확인한다.
 *
 * ★ `readable`(읽을 작정) 과 `read`(실제로 읽힘) 는 **다른 값**이다.
 *   인계서가 그 차이를 말하지 않으면 앱이 엉뚱한 칸을 본다 — 실제로 처음 판이
 *   그 둘을 안 나눠서 같은 파일이 모순된 두 줄로 떴다.
 */
test('★★ 인계서가 보라는 응답 칸을 서버가 실제로 낸다', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'ui', 'report-api.cjs'), 'utf8');
  const at = api.indexOf('async scanSources(');
  assert.ok(at > -1, 'scanSources 가 없다');
  const block = api.slice(at, api.indexOf('async listOneshot(', at));

  ['read', 'why', 'ocr', 'readable', 'scanned', 'unread', 'empty'].forEach((k) => {
    assert.ok(block.includes(k), `서버가 '${k}' 칸을 안 낸다 — 문서만 그렇게 말한다`);
    assert.ok(DOC.includes('`' + k + '`') || DOC.includes('"' + k + '"'),
      `인계서에 '${k}' 칸 설명이 없다`);
  });

  // ★ 둘의 차이를 **말로** 설명해야 한다. 이름만 적어 두면 같은 것으로 읽는다
  assert.ok(DOC.includes('읽을 작정') && DOC.includes('실제로 읽혔나'),
    'readable 과 read 의 차이를 인계서가 설명하지 않는다');
});

/* ═════════ ④-3 OCR 은 키가 있어야 돈다 ═════════ */

test('★ 인계서가 OCR 키 이야기를 하고, 그 이름이 실제 이름이다', () => {
  const llm = fs.readFileSync(path.join(__dirname, '..', 'core', 'llm.js'), 'utf8');
  const m = llm.match(/process\.env\.([A-Z_]*API_KEY)/);
  assert.ok(m, 'llm.js 가 어떤 키를 쓰는지 못 찾았다');
  assert.ok(DOC.includes(m[1]),
    `인계서가 OCR 키 이름('${m[1]}')을 말하지 않는다 — 없으면 이미지만 조용히 빠진다`);
  // ★ 값이 아니라 **이름**만이다 (CLAUDE.md §2). 값이 실렸는지는 ⑦ 이 본다
  const http = fs.readFileSync(path.join(__dirname, '..', 'connectors', 'http.js'), 'utf8');
  assert.ok(http.includes(`'${m[1]}'`),
    `${m[1]} 가 SECRET_ENV 에 없다 — 로그에 값이 평문으로 남을 수 있다`);
});

/* ═════════ ⑤ 갈래 이름 — 앞 판이 여기서 갈렸다 ═════════ */

test('★★ 인계서의 갈래 이름이 화면의 WAYS 와 같다', () => {
  const html = fs.readFileSync(path.join(PLATFORM, 'files.html'), 'utf8');
  // 화면에서 갈래 제목을 뽑아 온다 — 손으로 적지 않는다
  const block = html.slice(html.indexOf('var WAYS = ['), html.indexOf('function wayOf'));
  const names = (block.match(/t: '([^']+)'/g) || []).map(x => x.slice(4, -1));
  assert.equal(names.length, 3, `갈래가 셋이 아니다: ${names.join(' · ')}`);

  // ★★ `includes` 로만 재면 **못 잡는다** 〈2026-08-21 실측〉. 문서가
  //   「파일업로드(1회성)」이라고 옛 이름을 말해도 「파일업로드」를 품고 있어
  //   통과한다. 그래서 인계서의 **표 칸을 뽑아 글자 그대로** 맞춘다.
  const at = DOC.indexOf('| 갈래 | 무엇 | 플랜 |');
  assert.ok(at > -1, '인계서에 갈래 표가 없다');
  const table = DOC.slice(at, DOC.indexOf('\n\n', at));
  const cells = (table.match(/^\| \*\*(.+?)\*\* \|/gm) || [])
    .map(x => x.replace(/^\| \*\*/, '').replace(/\*\* \|$/, ''));
  assert.deepStrictEqual(cells, names,
    `인계서의 갈래 이름이 화면과 다르다 — 문서: ${cells.join(' · ')} / 화면: ${names.join(' · ')}`);
});

/* ═════════ ⑥ 「왜」가 적혀 있는가 ═════════ */

/**
 * ★ 「이렇게 하세요」만 있으면 빠뜨렸을 때 무슨 일이 나는지 몰라서, 급할 때
 *   제일 먼저 건너뛴다. 실제로 그렇게 잃은 하루가 있다.
 */
test('★ 조용히 무너지는 것들이 인계서에 적혀 있다', () => {
  ['flow-core.js', 'tokens.css', 'preventDefault', '501'].forEach((k) => {
    assert.ok(DOC.includes(k), `인계서에 ${k} 이야기가 없다`);
  });
  assert.ok(DOC.includes('조용히 무너지는'), '무엇이 조용히 깨지는지 모아 놓은 곳이 없다');
  // ★★ **못 한 것을 숨기지 않는다** — 인계서가 「다 됐다」로만 보이면 받는 쪽이
  //   확인을 건너뛴다
  assert.ok(DOC.includes('확인하지 못한 것'), '확인 못 한 것을 적은 곳이 없다');
});

/* ═════════ ⑦ 저장소는 public 이다 (D-10) ═════════ */

test('★★ 인계서에 접속정보·키·아티팩트 주소가 없다', () => {
  // 실제 사고로 만든 검사다. 지시서는 사람이 급히 쓰는 문서라 여기서 샌다
  assert.ok(!/claude\.ai\/code\/artifact/.test(DOC), '아티팩트 주소가 적혔다 (D-10)');
  assert.ok(!/\b\d+\.\d+\.\d+\.\d+\b/.test(DOC), 'IP 주소로 보이는 것이 있다');
  assert.ok(!/ts\.net|tailnet\.|\.synology\.me/i.test(DOC), 'NAS 주소가 적혔다');
  // 환경변수 **이름**은 적어도 된다. 값처럼 보이는 것이 있으면 잡는다
  assert.ok(!/(KEY|TOKEN|SECRET)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{12,}/.test(DOC),
    '키 값처럼 보이는 것이 적혔다 (CLAUDE.md §2)');
});
