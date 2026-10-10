'use strict';
/**
 * kita-scm.test.js — 소부장 공급망 인사이트 수집의 «다시 받기·목차 짝» 〈2026-10-10 · D-431 이음〉
 *
 * Codex 검토 넷을 재서 고쳤다(#195):
 *   ① 목차를 못 뽑은 호(빈 목록)를 매주 다시 내려받았다 → 세 번까지만(tries).
 *   ② PDF 받기에 상한이 없었다 → AbortSignal.timeout.
 *   ③ KITA_DIAG=1 로 돌리면 이번에 못 연 호의 앞 목차가 지워졌다 → 앞 결과를 그대로 싣는다.
 *   ④ 두 단 목차에서 [태그] 와 [제목] 이 다른 줄로 갈리면 짝을 잃었다 → 남은 태그를 다음 줄로.
 *
 * ★ 수집 고리는 스크립트 맨 위에서 바로 돈다 — 그래서 베끼지 않고 «진짜 스크립트»를 가짜 망으로 돌린다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'scripts', 'kita-scm-fetch.mjs');
const src = fs.readFileSync(SRC, 'utf8');

function headLines() {
  const a = src.indexOf('function headLines(');
  const b = src.indexOf('\nasync function readIssue', a);
  assert.ok(a > 0 && b > a, 'headLines 를 못 떼어 냈다 — 이 칸은 아무것도 안 잰다');
  return new Function(src.slice(a, b) + '\nreturn headLines;')();
}

test('④ 두 단 목차 — 한 줄 안의 짝과 줄을 넘긴 짝을 둘 다 잡는다', () => {
  const f = headLines();
  const page = [
    '주요 공급망 이슈',
    '미-중·통상       미국 반도체 수출통제 강화        EU·규제       배터리 여권 시행',
    '일본·소재',
    '                 갈륨 수출 허가제 확대',
    '공급망 이슈 포커스',
  ].join('\n');
  const got = f(page);
  assert.ok(got.includes('[미-중·통상] 미국 반도체 수출통제 강화'), JSON.stringify(got));
  assert.ok(got.includes('[EU·규제] 배터리 여권 시행'), JSON.stringify(got));
  assert.ok(got.includes('[일본·소재] 갈륨 수출 허가제 확대'), '줄을 넘긴 짝을 잃었다: ' + JSON.stringify(got));
});

test('② PDF 받기에 시간 상한이 있다', () => {
  const m = src.match(/const pr = await fetch\(url, \{([^}]*)/);
  assert.ok(m, 'PDF 받는 자리를 못 찾았다');
  assert.match(m[1], /signal:\s*AbortSignal\.timeout\(/);
});

// 가짜 망: 목록 → 상세(doDownloadFile) → PDF 아닌 응답(목차 못 뽑음). PDF 요청 수를 센다.
const PRE = `
const fs = require('fs');
const NOS = JSON.parse(process.env.K_NOS);
globalThis.fetch = async (u) => {
  u = String(u);
  const mk = (t) => ({ status: 200, ok: true, text: async () => t, arrayBuffer: async () => Buffer.from(t) });
  if (u.includes('globalSupplyChainList')) return mk(NOS.map((n) => '<a href="/x/globalSupplyChainDetail.do?no=' + n + '">공급망 인사이트 ' + n + '호</a> 2026.10.0' + (n % 9) ).join('\\n'));
  if (u.includes('globalSupplyChainDetail')) { const n = u.split('no=')[1]; return mk("<a onclick=\\"doDownloadFile('" + n + "','1')\\">f.pdf</a>"); }
  if (u.includes('downloadGlobalSupplyChainFile')) { fs.appendFileSync(process.env.K_LOG, u.split('no=')[1].split('&')[0] + '\\n'); return mk('not a pdf'); }
  throw new Error('unexpected ' + u);
};`;

function run(nos, prevItems, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kita-'));
  fs.mkdirSync(path.join(dir, 'data/kita-scm'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data/kita-scm/latest.json'), JSON.stringify({ items: prevItems }));
  const pre = path.join(dir, 'pre.cjs'); fs.writeFileSync(pre, PRE);
  const log = path.join(dir, 'pdf.log'); fs.writeFileSync(log, '');
  const r = spawnSync(process.execPath, ['--require', pre, SRC], {
    cwd: dir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, K_NOS: JSON.stringify(nos), K_LOG: log, KITA_DIAG: '', ...env },
  });
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'data/kita-scm/latest.json'), 'utf8'));
  const pdf = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(Number);
  fs.rmSync(dir, { recursive: true, force: true });
  return { r, out, pdf, by: new Map(out.items.map((x) => [x.no, x])) };
}

test('① 못 뽑은 호는 세 번까지만 다시 받고 · 뽑아 둔 호는 안 받는다', () => {
  const prev = [
    { no: 13, tv: 2, topics: ['[A·B] 있음'] },
    { no: 12, tv: 2, topics: [], tries: 3 },
    { no: 11, tv: 2, topics: [], tries: 1 },
  ];
  const { r, pdf, by } = run([13, 12, 11], prev);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(pdf, [11], '받은 PDF: ' + JSON.stringify(pdf));
  assert.deepStrictEqual(by.get(13).topics, ['[A·B] 있음']);
  assert.strictEqual(by.get(11).tries, 2);
  assert.strictEqual(by.get(12).tries, 3);
});

test('③ 옛 판 목차를 다시 뽑다 못 뽑으면 앞 목차를 지우지 않는다 · 진단으로 돌려도 지우지 않는다', () => {
  const prev = [13, 12, 11, 10, 9].map((no) => ({ no, tv: 2, topics: ['[A·B] 제목 ' + no] }));
  prev[4].tv = 1;
  const a = run([13, 12, 11, 10, 9], prev);
  assert.deepStrictEqual(a.pdf, [9]);
  assert.deepStrictEqual(a.by.get(9).topics, ['[A·B] 제목 9']);
  const d = run([13, 12, 11, 10, 9], prev, { KITA_DIAG: '1' });
  assert.strictEqual(d.pdf.length, 3, '진단은 셋까지 다시 연다');
  for (const no of [13, 12, 11, 10, 9]) assert.deepStrictEqual(d.by.get(no).topics, ['[A·B] 제목 ' + no], no + '호 목차가 지워졌다');
});
