/**
 * 보고서 종류가 화면·문지기·사양 **세 곳에서 같은가.**
 *
 * ★★ 2026-08-23 실제 사고. 화면(`reports.html` 의 `kinds`)과 문지기
 *   (`report-api.cjs` 의 `DOC_PLANS`)는 넷을 알았는데 `outputspec.js` 의
 *   `PRESETS` 에는 `im`·`teaser` 둘뿐이었다. 나머지 둘은 `|| PRESETS.im` 으로
 *   **조용히 IM 사양이 얹혔고**, 화면이 보낸 10페이지가 IM 의 `minPages: 30` 에
 *   걸려 「사양 확정 실패 — 목표 페이지가 최소값보다 작다」로 끝났다.
 *
 * ★ 막힌 것이 그나마 다행이었다. 통과했으면 요약 보고서가 **Investment
 *   Memorandum 표지·파일이름·기밀등급**으로 나갔고, 문서만 봐서는 안 잡힌다.
 *
 * ★ 그래서 세 목록을 **서로 대 본다.** 한 곳에 종류를 더하고 다른 곳을
 *   잊으면 여기가 먼저 빨개진다.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const spec = require('../core/outputspec.js');
const api = require('../ui/report-api.cjs');

/** 화면의 `kinds` 를 읽는다 — 주석을 떼고 본다 (CLAUDE.md §8) */
function screenKinds() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'ui', 'platform', 'reports.html'), 'utf8');
  const body = src.split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n');
  const block = body.slice(body.indexOf('kinds: ['));
  const rows = [...block.slice(0, block.indexOf('],')).matchAll(
    /\{\s*id:\s*'([^']+)'[\s\S]*?pages:\s*(\d+)\s*\}/g)];
  return rows.map((m) => ({ id: m[1], pages: Number(m[2]) }));
}

test('★★★ 화면이 고를 수 있는 보고서 종류는 전부 서버에 사양이 있다', () => {
  const kinds = screenKinds();
  assert.ok(kinds.length >= 4, `화면에서 종류를 못 읽었다 (${kinds.length}개)`);

  const missing = kinds.filter((k) => !spec.PRESETS[k.id]).map((k) => k.id);
  assert.deepStrictEqual(missing, [],
    `화면에는 있는데 PRESETS 에 없다: ${missing.join(', ')} — 조용히 im 으로 떨어진다`);
});

test('★★★ 화면 기본 페이지 수가 그 종류의 min~max 안에 든다', () => {
  screenKinds().forEach((k) => {
    const p = spec.PRESETS[k.id];
    assert.ok(p, `${k.id} 사양 없음`);
    assert.ok(k.pages >= p.minPages,
      `${k.id}: 화면 기본 ${k.pages} 페이지가 최소 ${p.minPages} 보다 작다 — 확정이 막힌다`);
    assert.ok(k.pages <= p.maxPages,
      `${k.id}: 화면 기본 ${k.pages} 페이지가 최대 ${p.maxPages} 보다 크다`);
  });
});

test('★★ 화면 기본값 그대로 확정하면 사양 검사를 통과한다 (형식 문제만 남는다)', () => {
  screenKinds().forEach((k) => {
    const s = spec.propose('T', { docType: k.id, overrides: { targetPages: k.pages } });
    const v = spec.validateSpec({ ...s, fileName: 'f', version: 'v1.0' });
    const pages = v.problems.filter((p) => p.indexOf('페이지') !== -1);
    assert.deepStrictEqual(pages, [], `${k.id}: ${pages.join(' / ')}`);
    const swapped = v.problems.filter((p) => p.indexOf('대신 썼다') !== -1);
    assert.deepStrictEqual(swapped, [], `${k.id}: ${swapped.join(' / ')}`);
  });
});

test('★★ 문지기가 아는 종류와 사양이 있는 종류가 같다', () => {
  const gated = Object.keys(api.DOC_PLANS);
  const missing = gated.filter((d) => !spec.PRESETS[d]);
  assert.deepStrictEqual(missing, [],
    `DOC_PLANS 에는 있는데 PRESETS 에 없다: ${missing.join(', ')}`);
});

test('★★★ 모르는 종류는 조용히 바뀌지 않는다 — 대신 쓴 사실이 문제로 잡힌다', () => {
  const s = spec.propose('T', { docType: 'no_such_doc' });
  assert.strictEqual(s.presetFor, 'im', '대신 쓴 사양을 안 적었다');
  const v = spec.validateSpec({ ...s, fileName: 'f', version: 'v1.0' });
  assert.ok(v.problems.some((p) => p.indexOf('대신 썼다') !== -1),
    `대신 쓴 것을 문제로 안 잡았다: ${v.problems.join(' / ')}`);
});

test('★ 아는 종류에는 presetFor 가 자기 자신이라 문제로 잡히지 않는다', () => {
  Object.keys(spec.PRESETS).forEach((d) => {
    const s = spec.propose('T', { docType: d });
    assert.strictEqual(s.presetFor, d, `${d}: presetFor 가 다르다`);
  });
});

test('★★ 페이지 문제는 **몇 대 몇인지** 적는다 — 「작다」만으로는 못 고친다', () => {
  const v = spec.validateSpec({
    docType: 'summary', presetFor: 'summary',
    pageSize: 'A4', orientation: 'portrait',
    targetPages: 2, minPages: 5, maxPages: 20,
    formats: ['html'], language: 'ko', version: 'v1.0',
    fileName: 'f', confidentiality: 'Confidential',
  });
  const hit = v.problems.filter((p) => p.indexOf('최소값') !== -1);
  assert.strictEqual(hit.length, 1);
  assert.ok(/2 < 5/.test(hit[0]), `숫자가 안 적혔다: ${hit[0]}`);
});
