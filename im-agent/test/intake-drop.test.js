'use strict';
/**
 * intake-drop.test.js — 보고서 생성 «관련자료 업로드» 칸 〈2026-10-28 사장님 화면:
 *   「자료 업로드 카테고리에서 → 프로젝트 지정 삭제해줘 · 업로드 UI필드가 안보임 교차검증 재구성해줘」 · 「무엇을 만들까요 삭제해줘」〉
 *
 * [무엇이 났나] 앞 판은 이 칸에 files.html 틀(① 프로젝트 지정 → ② 자료 넣는 방법)을 실어,
 *   프로젝트를 고르기 전에는 «위 ① 에서 프로젝트를 먼저 지정해 주십시오»만 서고 올리는 칸이 없었다.
 *   그리고 [자료올리기 완료] 는 걷은 «무엇을 만들까요»의 요청문을 기다렸다.
 * [잰다] 그려서 — part=files 로 열면 ① 끌어 놓기 칸이 바로 선다 · files.html 틀이 없다 · 파일이 없으면 «자료를 하나 이상 골라 주세요»
 *   ② 파일을 고르면 목록에 서고 [자료올리기 완료] 가 열린다(요청문 없이) ③ 누르면 POST /projects 에 파일 이름으로 만든 요청문이 간다
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (_) { /* 없으면 못 잰다 */ }

test('자료 업로드 칸 — 프로젝트 지정 없이 올리는 칸이 바로 서고, 요청문 없이 시작한다', async (t) => {
  if (!chromium) { t.skip('playwright 가 없다 — 못 쟀다'); return; }
  let b;
  try { b = await chromium.launch(); } catch (e) { t.skip('크로미움을 못 띄웠다 — 못 쟀다'); return; }
  try {
    const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
    const posts = [];
    await p.route('**/api/**', (r) => {
      const req = r.request();
      if (req.method() === 'POST' && /\/projects$/.test(req.url())) {
        posts.push(JSON.parse(req.postData() || '{}'));
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projectId: 'LP-T-1', name: 't', templateId: 'x', at: 'now' }) });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assetTypes: [], maxBytesPerFile: 5e7 }) });
    });
    const file = path.join(__dirname, '..', 'ui', 'platform', 'intake.html');
    await p.goto('file://' + file + '?part=files&api=http://x.test/api');
    await p.waitForTimeout(1200);
    const a = await p.evaluate(() => ({
      drop: !!document.querySelector('[data-lp-intake-drop] .drop input[type=file]'),
      frame: !!document.querySelector('iframe.sub-frame__f'),
      text: document.body.innerText,
      go: (document.getElementById('go') || {}).disabled,
    }));
    assert.ok(a.drop, '올리는 칸(끌어 놓기·고르기)이 안 선다');
    assert.ok(!a.frame, '프로젝트 지정 틀(files.html)이 아직 실린다');
    assert.ok(!/프로젝트를 먼저 지정/.test(a.text), '«프로젝트를 먼저 지정» 안내가 남았다');
    assert.ok(/자료를 하나 이상 골라 주세요/.test(a.text) && a.go === true, '파일이 없을 때 막고 까닭을 적지 않는다');
    assert.ok(!/요청문을 한 줄 적어 주세요/.test(a.text), '걷은 요청문을 아직 기다린다');

    await p.setInputFiles('[data-lp-intake-drop] input[type=file]', { name: '사업계획서.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
    await p.waitForTimeout(600);
    const c = await p.evaluate(() => ({ files: [...document.querySelectorAll('.file__n')].map((e) => e.textContent), go: document.getElementById('go').disabled }));
    assert.deepStrictEqual(c.files, ['사업계획서.pdf']);
    assert.strictEqual(c.go, false, '파일을 골랐는데 [자료올리기 완료] 가 안 열린다');

    await p.click('#go');
    await p.waitForTimeout(600);
    assert.strictEqual(posts.length, 1, '[자료올리기 완료] 가 프로젝트를 안 만든다');
    assert.match(posts[0].request, /^올린 자료로 보고서 작성 — 사업계획서\.pdf$/, '요청문을 파일 이름으로 만들지 않았다: ' + posts[0].request);
  } finally { await b.close(); }
});

/* 2026-10-28 (Codex P2 #326) — 0바이트 파일이 섞이면 [자료올리기 완료] 가 «읽는 중»으로 영영 막혔다 */
test('빈 파일(0바이트)은 빼고 나머지 자료로 [자료올리기 완료] 가 열린다', async (t) => {
  if (!chromium) { t.skip('playwright 가 없다 — 못 쟀다'); return; }
  let b;
  try { b = await chromium.launch(); } catch (e) { t.skip('크로미움을 못 띄웠다 — 못 쟀다'); return; }
  try {
    const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
    await p.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assetTypes: [], maxBytesPerFile: 5e7 }) }));
    await p.goto('file://' + path.join(__dirname, '..', 'ui', 'platform', 'intake.html') + '?part=files&api=http://x.test/api');
    await p.waitForTimeout(1000);
    await p.setInputFiles('[data-lp-intake-drop] input[type=file]', [
      { name: '사업계획서.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') },
      { name: '빈파일.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
    ]);
    await p.waitForTimeout(800);
    const c = await p.evaluate(() => ({ go: document.getElementById('go').disabled, text: document.body.innerText }));
    assert.strictEqual(c.go, false, '빈 파일 하나 때문에 [자료올리기 완료] 가 막혔다');
    assert.match(c.text, /빈 파일\(0바이트\)이라 올리지 않습니다/, '빈 파일을 뺀 까닭을 적지 않는다');
    assert.ok(!/고른 자료를 읽는 중입니다/.test(c.text), '다 읽었는데 «읽는 중»으로 남았다');
  } finally { await b.close(); }
});
