/* AI 건축설계·법규·인허가 통합엔진 (시범) — im-agent/core/arch-engine.js · CLAUDE.md §28
 * 사례(첨부 이미지 다섯 장의 추출값)를 돌려 판정을 잰다: 맞는 것은 적합, 어긋난 것은 부적합, 자료가 없는 것은 미확인.
 * ★ 미확인을 적합으로 칠하거나, 없는 대지면적으로 용적률을 지어내면 빨개진다 (지침 §2-5 · §5). */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const eng = require('../core/arch-engine');
const CASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'arch', 'case-2026-10-27.json'), 'utf8'));
const byId = (r, id) => r.checks.find((c) => c.id === id);

test('사례: 동·층 구성과 세대 합은 적합 · 층×세대·용적률·주차는 미확인 (값을 짓지 않는다)', () => {
  const r = eng.report(CASE, 'T');
  assert.strictEqual(byId(r, 'A1').status, 'PASS');
  assert.strictEqual(byId(r, 'A2').status, 'PASS');
  for (const id of ['A3', 'A4', 'A5']) assert.strictEqual(byId(r, id).status, 'UNVERIFIED', id);
  assert.match(byId(r, 'A3').why, /244개 층/);
  assert.match(byId(r, 'A3').why, /976세대/);
  assert.match(byId(r, 'A5').value, /세대당 1\.20대/);
  assert.strictEqual(r.model.site_area, null);
  assert.ok(!/용적률 \d+(\.\d+)?% 계산/.test(JSON.stringify(r)), '대지면적 없이 용적률을 계산했다');
});

test('사례: 조감도 라벨은 101 두 번 · 102·104 빠짐 → 부적합 · 배치도 라벨은 적합', () => {
  const r = eng.report(CASE, 'T');
  const b = byId(r, 'B-img4-49');
  assert.strictEqual(b.status, 'FAIL');
  assert.match(b.why, /두 번 적힌 동 101/);
  assert.match(b.why, /빠진 동 102 · 104/);
  assert.strictEqual(byId(r, 'B-img4-50').status, 'PASS');
});

test('사례: 평면도 46·79㎡ 는 세대 구성(84·59㎡)에 없는 유형 · 번호 붙은 실명만 중복으로 센다 · 타사 상표', () => {
  const r = eng.report(CASE, 'T');
  const p53 = byId(r, 'C-img3-53'), p54 = byId(r, 'C-img3-54');
  assert.strictEqual(p53.status, 'FAIL'); assert.strictEqual(p54.status, 'FAIL');
  assert.match(p54.why, /침실1 ×2/);
  assert.ok(!/발코니 ×/.test(p53.why + p54.why), '발코니 둘을 실명 중복으로 셌다');
  assert.match(p53.why, /타사 상표/);
});

test('조감도 대조는 기준과 같으면 적합 — 층수가 다르면 부적합 (거꾸로도 잰다)', () => {
  const base = [{ id: '1', floors: 10 }, { id: '2', floors: 12 }];
  assert.deepStrictEqual(eng.compareViews(base, { id: 'v', labels: [{ id: '1', floors: 10 }, { id: '2', floors: 12 }] }), { view: 'v', missing: [], extra: [], dup: [], floorDiff: [], floorUnknown: [] });
  assert.deepStrictEqual(eng.compareViews(base, { id: 'v', labels: [{ id: '1', floors: 10 }, { id: '2', floors: 9 }, { id: '3', floors: 5 }] }).floorDiff, ['2 12F↔9F']);
});

test('시나리오 A(현행)와 B(변경 전제)를 가른다 — B 의 용적률은 «미확인»이고 확정값으로 안 쓴다', () => {
  const s = eng.scenarios(CASE);
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].far, null);
  assert.strictEqual(s[1].far, 200); assert.strictEqual(s[1].status, 'UNVERIFIED');
});

test('인허가는 자료가 가리키는 것만 «판정 필요»로 — 법정 처리기간을 지어내지 않는다', () => {
  const p = eng.permits(CASE);
  assert.ok(p.some((x) => /산지전용/.test(x.step)));
  assert.ok(p.some((x) => /주택건설사업계획승인/.test(x.step)));
  assert.ok(p.every((x) => x.applies === '판정 필요' && x.statutory === null && x.expected === null));
  const none = eng.permits({ plan: { households: 10 }, site: { flags: {} } });
  assert.ok(!none.some((x) => /산지|농지|주택건설/.test(x.step)), '자료에 없는 절차를 올렸다');
});

test('도구 점검: 열쇠가 없으면 «열쇠 없음», 자동배치·도면·일조는 «미연결» — 프로그램 이름만 보고 연결로 안 친다', () => {
  const t = eng.toolCheck({});
  const s = Object.fromEntries(t.map((x) => [x.id, x.state]));
  assert.strictEqual(s.layout, '미연결'); assert.strictEqual(s.cad, '미연결'); assert.strictEqual(s.sun, '미연결');
  assert.match(s.render, /열쇠 없음/);
  assert.match(Object.fromEntries(eng.toolCheck({ GEMINI_API_KEY: 'x' }).map((x) => [x.id, x.state])).render, /연결/);
});

test('조감도 지시문: 12개 동 목록·형상 유지·글자 금지를 싣고, 보고서는 «허가 보장» 같은 말을 안 쓴다', () => {
  const b = eng.renderBrief(CASE);
  assert.match(b, /12개 동/); assert.match(b, /101 25층/); assert.match(b, /112 17층/);
  assert.match(b, /추가하거나 건물을 삭제·이동하지 않는다/);
  assert.match(b, /동번호를 그림 안에 생성하지 않는다/);
  const md = eng.toMarkdown(eng.report(CASE, 'T'), CASE);
  assert.ok(!/100% 법규|허가 보장|완벽한 설계/.test(md.replace(/보장하지 않으며/g, '')));
  assert.match(md, /## 1\. 결론[\s\S]*## 2\. 근거[\s\S]*## 3\. 설계[\s\S]*## 4\. 실행[\s\S]*## 6\. 결정/);
});

test('Codex #320: 층수를 못 읽은 라벨 · 세대수 모르는 유형은 적합이 아니라 미확인', () => {
  const c = JSON.parse(JSON.stringify(CASE));
  c.views.find((v) => v.id === 'img4-50').labels.forEach((l) => { l.floors = null; });
  c.plan.unit_mix[1].count = null;
  const r = eng.report(c, null);
  assert.strictEqual(byId(r, 'B-img4-50').status, 'UNVERIFIED');
  assert.strictEqual(byId(r, 'A2').status, 'UNVERIFIED');
  const r0 = eng.report(JSON.parse(JSON.stringify(CASE)), null);
  assert.strictEqual(byId(r0, 'B-img4-50').status, 'PASS');
  assert.strictEqual(byId(r0, 'A2').status, 'PASS');
});
