// 쇼츠 제작 엔진 시험판 — 판 고정 · 열쇠 없음 · 운영 길과 분리 · 사용권 표기
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('엔진 판은 «정확한 판»으로 고정한다 (^·~·latest 없음) — lock 도 같다', () => {
  const pkg = JSON.parse(read('engines/package.json'));
  const lock = JSON.parse(read('engines/package-lock.json'));
  for (const [name, v] of Object.entries(pkg.dependencies)) {
    assert.match(v, /^\d+\.\d+\.\d+$/, `${name} 판이 고정되지 않았다: ${v}`);
    assert.strictEqual(lock.packages[`node_modules/${name}`]?.version, v, `${name} lock 판이 다르다`);
  }
  for (const n of ['remotion', 'hyperframes', '@remotion/cli']) assert.ok(pkg.dependencies[n], `${n} 없음`);
});

test('엔진 워크플로는 열쇠를 하나도 안 쓰고, 운영 쇼츠 길을 건드리지 않는다', () => {
  const wf = read('.github/workflows/shorts-engines.yml');
  assert.doesNotMatch(wf, /secrets\./, '엔진 시험에 비밀이 들어갔다');
  assert.match(wf, /workflow_dispatch/);
  assert.doesNotMatch(wf, /^\s+(push|schedule):/m, '엔진 시험이 저절로 돌면 안 된다');
  assert.match(wf, /D-460/, '사용권 결정(D-460)을 가리켜야 한다');
  assert.doesNotMatch(read('.github/workflows/shorts-make.yml'), /engines\//, '운영 쇼츠가 시험 엔진을 쓰면 안 된다');
});

test('HyperFrames 판은 CDN 을 안 부르고, Remotion 판은 9:16·30fps 다', () => {
  const hf = read('engines/hyperframes/index.html');
  assert.doesNotMatch(hf, /<script[^>]+src="https?:/i, 'CDN 스크립트가 남았다');
  assert.match(hf, /data-width="1080"/); assert.match(hf, /data-height="1920"/);
  const rm = read('engines/remotion/index.jsx');
  assert.match(rm, /width=\{1080\}/); assert.match(rm, /height=\{1920\}/); assert.match(rm, /fps=\{30\}/);
});

test('요약은 단계 결과가 아니라 파일을 재서 판정한다 — 파일이 없으면 «못 그림»', async () => {
  const src = read('scripts/shorts-engines-report.mjs');
  assert.match(src, /ffprobe/); assert.match(src, /파일 없음/);
  assert.match(src, /1080 && s\.height === 1920/);
});
