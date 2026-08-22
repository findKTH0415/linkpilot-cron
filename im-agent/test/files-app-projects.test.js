'use strict';
/**
 * files-app-projects.test.js — 자료 업로드에서 **앱 프로젝트를 불러와 잇는** 계약 (2026-08-20 요청).
 *
 * 앱에 등록된 프로젝트(예: 54건)에서 골라 엔진 프로젝트로 잇는다. 이 화면은 앱 데이터를
 * 못 읽으므로 목록은 부모가 내려주고(appProjects/appLinks), **짝의 저장은 앱이 한다**
 * (postMessage lp-app-project-linked). 여기 저장하면 앱 데이터의 정본이 둘이 된다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'platform', 'files.html'), 'utf8');

test('계약 필드가 기본값 블록에 있다 — 부모가 채울 자리가 없으면 계약이 아니다', () => {
  for (const k of ['appProjects: null', 'appLinks: null']) assert.ok(src.includes(k), k);
});

test('셀렉트가 앱 프로젝트 그룹을 노출하고 app: 값으로 갈래를 나눈다', () => {
  assert.ok(src.includes("gApp.label = '앱 프로젝트에서 가져오기'"), 'optgroup 라벨');
  assert.ok(src.includes("o.value = 'app:' + a.id"), '앱 항목 value 접두');
  assert.ok(src.includes("if (v && v.indexOf('app:') === 0) pickAppProject(v.slice(4))"), 'change 분기');
  // 단독 실행(부모 없음)에서는 그룹이 없어야 한다 — 있는 척 금지
  assert.ok(src.includes('Array.isArray(C.appProjects) ? C.appProjects : []'), '부모 미제공 시 빈 목록');
});

test('처음 잇는 순간 부모에게 알린다 — 짝 저장은 앱 몫', () => {
  assert.ok(src.includes("type: 'lp-app-project-linked'"), 'postMessage 타입');
  assert.ok(src.includes('window.location.origin'), '같은 출처로만');
  assert.ok(src.includes("new CustomEvent('lp-app-project-linked'"), 'iframe 없이 얹힌 경우의 문서 이벤트');
});

test('이미 이어진 앱 프로젝트는 그 엔진 프로젝트를 연다 · 엔진에서 사라졌으면 말하고 새로 만든다', () => {
  assert.ok(src.includes("(C.appLinks || {})[String(appId)]"), '짝 조회');
  assert.ok(src.includes('엔진에 없어 새로 만듭니다'), '사라진 짝을 조용히 재생성하지 않는다');
});

test('실패는 조용히 두지 않는다 — 사유가 셀렉트 아래 한 줄로 선다', () => {
  assert.ok(src.includes('보고서 프로젝트를 만들지 못했습니다'), '실패 문구');
  assert.ok(src.includes('state.appMsg'), '전용 상태');
});
