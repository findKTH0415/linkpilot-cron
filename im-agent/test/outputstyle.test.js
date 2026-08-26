/**
 * 출력 성격 네 축 〈2026-08-23 사장님 지시〉.
 *
 *   「전문 금융권 IM 레이아웃(세로형), PPT(가로형) / 텍스트 중심, 디자인 그래픽
 *    중심, 혼합형 중심 / 정부, 공기업, 대기업, 연구실, 전문기업 스타일 /
 *    전문형, 일반형 (용어, 단어선택, 설명기조) 다름」
 *
 * ★★ 여기서 지키는 것 셋:
 *   ① 화면 표와 서버 표가 **글자로 같다.** 갈리면 「미리보기와 다른 문서」가
 *     나오고, 그러면 교정 미리보기는 없느니만 못하다.
 *   ② **판형이 용지를 끌고 간다.** 둘을 따로 두면 「가로형인데 A4 세로」가
 *     만들어지고, 그때 나오는 문서는 어느 쪽도 아니다.
 *   ③ 모르는 값을 **조용히 기본값으로 바꾸지 않는다** (CLAUDE.md §4.9).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const spec = require('../core/outputspec.js');
const SCREEN = path.join(__dirname, '..', 'ui', 'platform', 'reports.html');

/** 화면이 들고 있는 사본을 읽는다 — 주석은 떼고 본다 (CLAUDE.md §8) */
function screenStyle() {
  const src = fs.readFileSync(SCREEN, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const at = src.indexOf('style: {');
  assert.ok(at > -1, '화면에 style 표가 없다');
  const block = src.slice(at, src.indexOf('sizes:', at));
  const grab = (key) => {
    const k = src.indexOf(key + ': [', at);
    const seg = src.slice(k, src.indexOf('\n    ],', k));
    return [...seg.matchAll(/\{ id: '([^']+)', name: '([^']+)'/g)]
      .map((m) => ({ id: m[1], name: m[2] }));
  };
  return {
    block,
    layout: grab('layout'), density: grab('density'),
    house: grab('house'), register: grab('register'),
  };
}

const AXES = [
  ['layout', 'LAYOUTS'], ['density', 'DENSITY'],
  ['house', 'HOUSES'], ['register', 'REGISTER'],
];

/* ── ① 화면 ↔ 서버 ────────────────────────────────────── */

test('★★★ 네 축의 값이 화면과 서버에서 같다', () => {
  const S = screenStyle();
  AXES.forEach(([key, mod]) => {
    assert.deepStrictEqual(S[key].map((o) => o.id), Object.keys(spec[mod]),
      `${key}: 화면과 서버의 값이 다르다 — 미리보기와 다른 문서가 나온다`);
  });
});

test('★★★ 네 축의 **이름**도 글자 그대로 같다', () => {
  const S = screenStyle();
  AXES.forEach(([key, mod]) => {
    S[key].forEach((o) => {
      assert.strictEqual(o.name, spec[mod][o.id].label,
        `${key}.${o.id}: 화면 '${o.name}' ≠ 서버 '${spec[mod][o.id].label}'`);
    });
  });
});

test('★★★ 어조 견본 문구가 화면과 서버에서 같다 — 이것이 교정의 대상이다', () => {
  const S = screenStyle();
  Object.keys(spec.REGISTER).forEach((id) => {
    const want = spec.REGISTER[id].sample;
    assert.ok(S.block.indexOf(want) !== -1,
      `${id}: 화면의 견본 문구가 서버와 다르다 — 미리보기로 교정한 말이 문서에 안 나온다`);
  });
});

test('★★ 기관 스타일 색이 화면과 서버에서 같다', () => {
  const src = fs.readFileSync(SCREEN, 'utf8');
  Object.keys(spec.HOUSES).forEach((id) => {
    assert.ok(src.indexOf(spec.HOUSES[id].accent) !== -1,
      `${id}: 색 ${spec.HOUSES[id].accent} 이 화면에 없다`);
  });
});

test('★★ 화면 기본값이 서버 기본값과 같다', () => {
  const src = fs.readFileSync(SCREEN, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  Object.keys(spec.STYLE_DEFAULT).forEach((k) => {
    assert.ok(new RegExp(k + ": '" + spec.STYLE_DEFAULT[k] + "'").test(src),
      `기본값이 다르다: ${k} 는 서버에서 '${spec.STYLE_DEFAULT[k]}' 다`);
  });
});

/* ── ② 판형이 용지를 끌고 간다 ─────────────────────────── */

test('★★★ 판형을 고르면 용지·방향이 따라온다', () => {
  const a = spec.propose('T', { docType: 'im' });
  assert.strictEqual(a.pageSize, 'A4');
  assert.strictEqual(a.orientation, 'portrait');

  const b = spec.propose('T', { docType: 'im', overrides: { layout: 'ppt_landscape' } });
  assert.strictEqual(b.pageSize, '16:9', '가로형인데 A4 로 나왔다');
  assert.strictEqual(b.orientation, 'landscape');
});

test('★★★ 판형과 용지가 어긋나면 확정이 막힌다', () => {
  const bad = {
    docType: 'im', presetFor: 'im', layout: 'ppt_landscape',
    pageSize: 'A4', orientation: 'portrait',
    targetPages: 40, minPages: 30, maxPages: 100,
    formats: ['html'], language: 'ko', version: 'v1.0',
    fileName: 'f', confidentiality: 'Confidential',
  };
  const v = spec.validateSpec(bad);
  assert.ok(v.problems.some((p) => p.indexOf('어긋난다') !== -1),
    `어긋난 사양이 통과했다: ${v.problems.join(' / ')}`);
});

test('★★ 용지를 직접 준 경우는 그것을 존중한다 (판형이 덮지 않는다)', () => {
  const s = spec.propose('T', {
    docType: 'im', overrides: { layout: 'ppt_landscape', pageSize: 'A3' },
  });
  assert.strictEqual(s.pageSize, 'A3', '사람이 직접 준 값을 판형이 덮었다');
});

/* ── ③ 모르는 값을 조용히 바꾸지 않는다 ────────────────── */

test('★★★ 모르는 축 값은 문제로 잡힌다 — 조용히 기본값으로 그리지 않는다', () => {
  const st = spec.styleOf({ house: '없는것', register: 'plain' });
  assert.deepStrictEqual(st.unknown, ['house=없는것']);
  assert.strictEqual(st.register, 'plain', '아는 값까지 버리면 안 된다');

  const v = spec.validateSpec({
    docType: 'im', presetFor: 'im', house: '없는것',
    layout: 'im_portrait', pageSize: 'A4', orientation: 'portrait',
    targetPages: 40, minPages: 30, maxPages: 100,
    formats: ['html'], language: 'ko', version: 'v1.0',
    fileName: 'f', confidentiality: 'Confidential',
  });
  assert.ok(v.problems.some((p) => p.indexOf('알 수 없는 출력 성격') !== -1),
    `모르는 값이 조용히 지나갔다: ${v.problems.join(' / ')}`);
});

test('★★ 안 적힌 것과 모르는 것을 가른다 — 빈 값은 문제가 아니다', () => {
  const st = spec.styleOf({});
  assert.deepStrictEqual(st.unknown, []);
  assert.strictEqual(st.layout, spec.STYLE_DEFAULT.layout);
});

test('★★★ 네 축은 중대 변경이다 — 바꾸면 확정이 풀린다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'outputspec.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const m = src.match(/const MATERIAL = \[([\s\S]*?)\];/);
  assert.ok(m, 'MATERIAL 목록을 못 찾았다');
  ['layout', 'density', 'house', 'register'].forEach((k) => {
    assert.ok(m[1].indexOf(`'${k}'`) !== -1,
      `${k} 가 중대 변경에 없다 — 판형·어조를 바꿔도 확정이 그대로 남는다`);
  });
});

/* ── ④ 화면이 팝업을 실제로 그리는가 ──────────────────── */

test('★★★ 출력조건에 교정 미리보기 팝업이 있다', () => {
  const code = fs.readFileSync(SCREEN, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(code.indexOf('function proofModal') !== -1, '팝업을 그리는 곳이 없다');
  assert.ok(code.indexOf('교정 미리보기') !== -1, '여는 단추가 없다');
  assert.ok(/if \(state\.proof\) view\.appendChild\(proofModal\(\)\)/.test(code),
    '팝업이 화면에 안 붙는다');
});

test('★★★ 견본 지면이 판형 비율을 실제로 지킨다', () => {
  const css = fs.readFileSync(SCREEN, 'utf8');
  assert.ok(/\.sheet \{[^}]*aspect-ratio: 1 \/ 1\.414/.test(css),
    '세로형 견본이 A4 비율이 아니다 — 비율이 틀리면 볼 이유가 없다');
  assert.ok(/\.sheet--land \{[^}]*aspect-ratio: 16 \/ 9/.test(css),
    '가로형 견본이 16:9 가 아니다');
});

test('★★★ 무게중심이 **그림 자리 크기**를 실제로 바꾼다 (말만 다르지 않다)', () => {
  const code = fs.readFileSync(SCREEN, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/share = D\.id === 'text' \? 15 : D\.id === 'graphic' \? 60 : 35/.test(code),
    '무게중심이 그림 자리 크기를 안 바꾼다 — 고를 이유가 없어진다');
  assert.ok(/if \(D\.id === 'graphic'\) \{ body\.appendChild\(fig\)/.test(code),
    '그래픽 중심인데 그림이 먼저 오지 않는다 — 차례 자체가 무게중심이다');
});

test('★★★ 팝업이 **견본임을 화면에 박는다** (§8)', () => {
  const code = fs.readFileSync(SCREEN, 'utf8');
  assert.ok(code.indexOf('숫자는 딜의 값이 아닙니다') !== -1,
    '견본 숫자를 실제 값으로 오해하면 그것으로 판단한다');
});

test('★★ 확정한 사양이 네 축을 싣고 간다', () => {
  const code = fs.readFileSync(SCREEN, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/layout: state\.layout, density: state\.density/.test(code),
    '확정할 때 네 축을 안 보낸다 — 골라도 문서에 반영되지 않는다');
  assert.ok(/\['layout', 'density', 'house', 'register'\]\.forEach/.test(code),
    '서버가 준 사양을 화면이 안 받는다 — 다시 열면 기본값으로 돌아간다');
});
