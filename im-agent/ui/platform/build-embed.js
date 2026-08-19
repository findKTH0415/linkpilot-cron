'use strict';
/**
 * build-embed.js — **배포용 사본을 엔진이 직접 낸다** (2026-08-18 · 이관 ②).
 *
 *   node im-agent/ui/platform/build-embed.js [--out <경로>]
 *
 * ★★ 왜 만들었나: 본체가 사본을 만들면서 **원본 글자를 찾아 끼워 넣고** 있었다
 *   (설정 병합·세션·토큰 래퍼 셋). 앵커가 되는 줄이 한 글자만 바뀌어도 치환이
 *   빗나가 **앱 배포가 멈추거나 설정이 안 들어간 사본이 나간다.** 그리고 새 화면
 *   (`files.html`)은 그 목록에 없어서 **화면은 뜨는데 목록이 비었다.**
 *
 * ★ 그래서 **치환을 없앴다.** 화면들이 `embed-bridge.js` 를 스스로 달고 있고,
 *   브리지가 부모(앱)의 `window.LINKPILOT_EMBED` 를 **같은 출처로 읽어** 병합한다.
 *   이 빌더가 하는 일은 **고르고, 확인하고, 지문을 남기는 것**뿐이다.
 *
 * ★ 목록을 손으로 적지 않는다 — 탭 셋과 4단계가 **실제로 참조하는 것**을 훑는다.
 *   화면이 늘거나 의존이 바뀌면 목록이 저절로 따라온다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const FLOW = require('./flow-core.js');

/** 화면마다 어느 전역을 쓰는지 — 브리지 태그가 맞는지 확인하는 데 쓴다 */
const GLOBALS = {
  'report-flow.html': 'LINKPILOT_REPORT_FLOW',
  'outputs.html': 'LINKPILOT_OUTPUTS',
  'files.html': 'LINKPILOT_FILES',
  'intake.html': 'LINKPILOT_INTAKE',
  'fields.html': 'LINKPILOT_FIELDS_CFG',
  'reports.html': 'LINKPILOT_REPORTS',
};

/** 브리지 자체는 어떤 화면도 `<script src=>` 로만 부르므로 훑기에 걸린다 */
function required() {
  const seen = new Set();
  const scan = (f) => {
    if (seen.has(f)) return;
    const full = path.join(HERE, f);
    if (!fs.existsSync(full)) throw new Error(`화면이 참조하는 파일이 없다: ${f}`);
    seen.add(f);
    const s = fs.readFileSync(full, 'utf8');
    [...s.matchAll(/<script src="([^"]+)"|<link rel="stylesheet" href="([^"]+)"/g)]
      .map(m => m[1] || m[2]).forEach(scan);
  };
  FLOW.TABS.forEach(t => scan(t.file));
  FLOW.STEPS.forEach(s => scan(s.file));
  return [...seen].sort();
}

/**
 * 화면이 브리지를 **제대로** 달았는가.
 *
 * ★ 있는지만 보지 않는다. **설정 대입보다 뒤**(또는 병합 패턴이면 앞)에 있어야
 *   한다 — 순서가 틀리면 대입이 병합을 덮어써서 **설정이 조용히 사라진다.**
 *   실제로 그렇게 한 번 만들었고, 화면은 멀쩡히 뜨는데 값만 기본값이었다.
 */
function checkBridge(file) {
  const s = fs.readFileSync(path.join(HERE, file), 'utf8');
  const g = GLOBALS[file];
  if (!g) return { ok: true, why: '설정 전역이 없는 화면' };

  const tag = `<script src="embed-bridge.js" data-lp-global="${g}"></script>`;
  const at = s.indexOf(tag);
  if (at < 0) return { ok: false, why: `브리지 태그가 없다 (${g})` };

  const m = new RegExp('^window\\.' + g + '\\s*=\\s*', 'm').exec(s);
  if (!m) return { ok: false, why: `${g} 대입을 못 찾았다` };
  const merges = s.slice(m.index, m.index + 120).includes('Object.assign');

  if (merges) {
    if (at > m.index) return { ok: false, why: '병합 패턴인데 브리지가 뒤에 있다 — 전역이 늦게 생겨 반영이 안 된다' };
  } else if (at < m.index) {
    return { ok: false, why: '대입 패턴인데 브리지가 앞에 있다 — 대입이 병합을 덮어쓴다' };
  }
  return { ok: true, why: merges ? '병합 패턴 · 브리지 앞' : '대입 패턴 · 브리지 뒤' };
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function build(outDir) {
  const files = required();
  const problems = [];
  Object.keys(GLOBALS).forEach((f) => {
    if (!files.includes(f)) return;          // 이번 목록에 없는 화면은 볼 것도 없다
    const r = checkBridge(f);
    if (!r.ok) problems.push(`${f}: ${r.why}`);
  });
  // ★ 확인에 걸리면 **만들지 않는다.** 설정이 안 들어간 사본이 나가는 것이
  //   「빌드 실패」보다 훨씬 나쁘다 — 앱은 멀쩡히 뜨고 값만 비어 있다
  if (problems.length) {
    const e = new Error('브리지 확인 실패:\n  ' + problems.join('\n  '));
    e.problems = problems;
    throw e;
  }

  const manifest = { at: null, files: {} };
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  files.forEach((f) => {
    const buf = fs.readFileSync(path.join(HERE, f));
    manifest.files[f] = { bytes: buf.length, sha256: sha256(buf) };
    if (outDir) fs.writeFileSync(path.join(outDir, f), buf);
  });
  return { files, manifest, outDir: outDir || null };
}

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const out = i > -1 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null;
  let r;
  try {
    r = build(out);
  } catch (e) {
    console.error('배포용 사본을 만들지 못했다.\n' + e.message);
    process.exit(2);
  }
  // 지문을 남긴다 — NAS 에 올라간 것이 이것인지 `verify:nas` 가 대조한다
  const { kstStamp } = require(path.join(HERE, '..', '..', 'core', 'kst'));
  r.manifest.at = kstStamp();
  if (out) fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(r.manifest, null, 2));
  console.log(`배포용 사본 ${r.files.length}개` + (out ? ` → ${out}` : ' (확인만, --out 없음)'));
  r.files.forEach(f => console.log('  ' + f.padEnd(20) + r.manifest.files[f].sha256.slice(0, 12)));
}

module.exports = { build, required, checkBridge, GLOBALS };
