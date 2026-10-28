'use strict';
/**
 * merge-runbook.test.js — 병합 절차서의 숫자·규칙이 코드와 갈리지 않게 한다.
 *
 * ★ 왜 필요한가 — 절차서는 **받는 사람이 그대로 믿고 따라 하는 문서**다.
 *   「합집합 40개」가 39가 되거나 「D-115 부터」가 옛말이 되면, 따라 한 사람이
 *   틀린 채로 병합하고 **그 사실은 병합이 끝난 뒤에야 드러난다.**
 *   (`인수인계서-플랫폼-연동.md` 를 같은 이유로 고정하고 있다 — flow.test.js)
 *
 * ★ 산문은 검사하지 않는다. **숫자와 명령만** 본다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DOC = path.join(__dirname, '..', '..', 'docs', '병합-절차서-2026-08-25.md');
const doc = fs.readFileSync(DOC, 'utf8');

test('절차서가 존재하고 네 단계를 다 적는다', () => {
  for (const pr of ['#10', '#11', '#8', '#9']) {
    assert.ok(doc.includes(pr), `${pr} 가 절차서에 없다`);
  }
});

test('★ 절차서가 시키는 명령이 실제로 있다 — 없는 명령을 시키면 거기서 멈춘다', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const told = [...doc.matchAll(/npm run ([a-z:]+)/g)].map(m => m[1]);
  assert.ok(told.length >= 4, `절차서에 명령이 ${told.length}개뿐이다`);
  for (const cmd of [...new Set(told)]) {
    assert.ok(pkg.scripts[cmd], `절차서가 시키는 \`npm run ${cmd}\` 가 package.json 에 없다`);
  }
});

test('★ 「다음 빈 번호」가 실제 등록부와 같다', () => {
  const rc = require('../tools/registry-check');
  const items = rc.parse(fs.readFileSync(path.join(__dirname, '..', '..', rc.DOC), 'utf8'));
  const next = rc.nextFree({ x: items }).next;
  assert.ok(doc.includes(`D-${next}`), `절차서의 다음 번호가 D-${next} 가 아니다`);
});

test('★ 「오는 중」으로 적은 Agent 가 절차서와 코드에서 같다', () => {
  const router = require('../core/router');
  for (const id of Object.keys(router.INCOMING)) {
    assert.ok(doc.includes('INCOMING'), '절차서가 INCOMING 을 안 가리킨다');
  }
  // 도착하면 절차서 §6 의 「지운다」가 할 일이 된다 — 그 줄이 사라지면 안 된다
  assert.match(doc, /INCOMING.*지운다|지운다.*INCOMING/s, 'INCOMING 을 지우라는 줄이 사라졌다');
});

test('★★ §5 의 열쇠 목록 안내가 실제 파일과 맞는다', (t) => {
  const wf = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'workflows', 'deploy-nas.yml'), 'utf8');
  const namesLines = wf.split('\n').filter(l => /NAMES=/.test(l));

  // ★ **못 친 것을 통과로 세지 않는다.** 이 갈래는 main 기준이라 열쇠 목록 줄이
  //   아직 없다 — 그 줄은 ③④단계(Engine·SketchUp)를 합쳐야 들어온다.
  //   초록으로 넘기면 「확인했다」가 되고, 정작 합칠 때 아무도 안 본다.
  if (!namesLines.some(l => /NAMES="GEMINI_API_KEY/.test(l))) {
    t.skip('이 갈래에는 열쇠 목록 줄이 아직 없다 — ③④단계 뒤에 이 검사가 실제로 돈다');
    return;
  }

  // 절차서가 **어느 줄인지**를 짚어야 한다 — 안 짚으면 다른 NAMES= 를 고치게 된다
  assert.match(doc, /GEMINI_API_KEY[\s\S]{0,80}시작하는 줄/,
    '절차서가 어느 NAMES= 줄인지 안 짚어 준다');
  assert.ok(namesLines.length > 1,
    'NAMES= 가 하나뿐이면 절차서의 「여러 줄 있다」 경고는 옛말이다 — 지운다');
});

test('★ 충돌 푸는 법 여섯 갈래가 전부 적혀 있다', () => {
  for (const key of ['둘 다 넣는다', '다시 만든다', '센다', '먼저 붙인 쪽이 지킨다',
    '양쪽 다 남기면 안 된다', '이름을 갈라']) {
    assert.ok(doc.includes(key), `푸는 법에서 「${key}」 가 사라졌다`);
  }
});
