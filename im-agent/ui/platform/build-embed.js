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

/**
 * 화면마다 어느 전역을 쓰는지 — 브리지 태그가 맞는지 확인하는 데 쓴다.
 *
 * ★★ 이 표는 **손으로 적는다.** 그래서 새 화면을 여기 안 적으면 `checkBridge` 가
 *   「설정 전역이 없는 화면」이라며 **그냥 넘어간다** — 확인을 건너뛴 것이
 *   확인을 통과한 것과 구분되지 않는다. `unlisted()` 가 그것을 막는다.
 */
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
    /* ★ 주소 뒤의 판 표시(`?v=…`)를 떼고 본다 〈2026-08-22〉. 캐시를 지나가려고
     *   붙인 것이라 **파일 이름이 아니다.** 안 떼면 「그런 파일이 없다」로 죽는다
     *   (`build-stamp.js` 참고) */
    [...s.matchAll(/<script src="([^"]+)"|<link rel="stylesheet" href="([^"]+)"/g)]
      .map(m => (m[1] || m[2]).split('?')[0]).forEach(scan);
  };
  FLOW.TABS.forEach(t => scan(t.file));
  FLOW.STEPS.forEach(s => scan(s.file));
  /* ★★★ **탭이 아니어도 쓰이는 화면이 있다** 〈2026-08-22〉.
   *   자료 업로드는 탭에서 빠지고 **1단계 안**으로 들어갔다(iframe). 그런데
   *   그 참조는 자바스크립트 안에 있어서 `<script src>` 훑기에 안 걸린다.
   *   그대로 두면 묶음에서 빠지고, **배포는 초록인데 1단계 안이 404** 가 된다
   *   (M-22 와 같은 결의 사고 — 짝이 깨진 배포는 오류를 안 낸다).
   *   ★ 그래서 「어디에 얹혔든 화면이면 싣는다」로 센다. */
  [FLOW.FILES_SECTION].forEach((sec) => { if (sec && sec.file) scan(sec.file); });
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

  /* ★ 주소에 판 표시(`?v=…`)가 붙는다 〈2026-08-23 · D-93〉 — 글자 그대로 찾으면
   *   **브리지가 있는데 없다고 말한다.** 여기서 막히면 배포가 통째로 멈춘다 */
  const re = new RegExp('<script src="embed-bridge\\.js(\\?v=[0-9a-f]*)?" data-lp-global="'
    + g + '"></script>');
  const at = s.search(re);
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

/**
 * 표에 없는데 **설정 전역을 쓰는** 화면을 찾는다.
 *
 * ★ 없는 것을 못 찾는 것이 이 종류 검사의 약점이다. `GLOBALS` 를 기준으로 돌면
 *   표에 없는 화면은 처음부터 순회에 안 들어와 영원히 안 걸린다. 그래서
 *   **화면 쪽에서** 전역 대입을 찾아 표와 대조한다 — 방향이 반대여야 한다.
 */
function unlisted(files) {
  const out = [];
  files.filter(f => f.endsWith('.html')).forEach((f) => {
    const s = fs.readFileSync(path.join(HERE, f), 'utf8');
    [...s.matchAll(/^window\.(LINKPILOT_[A-Z_0-9]+)\s*=/mg)].map(m => m[1]).forEach((g) => {
      if (GLOBALS[f] !== g) out.push(`${f}: ${g} 가 GLOBALS 에 없다 — 브리지 확인이 통째로 건너뛰어진다`);
    });
  });
  return out;
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function build(outDir) {
  const files = required();
  const problems = unlisted(files);
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

/**
 * 어디로 낼지 정한다 — **`--out` 이 없으면 `LP_APP_DIR` 을 본다** 〈2026-08-21〉.
 *
 * ★★ 실제로 사고가 났다. 안내문의 `<앱 폴더>` 를 **자리표시인 줄 모르고 그대로**
 *   붙여 넣은 것이다. 셸이 `앱 폴더` 를 찾다 죽었고, 그 뒤 두 줄도 줄줄이 죽었다.
 *   안내가 「여기에 당신의 경로를 넣으세요」를 **말하지 않은 것**이 원인이다.
 *
 * ★ 그래서 여기서 **사람이 알아볼 수 있게 막는다.** 자리표시처럼 보이는 값,
 *   없는 폴더, `im-flow` 가 아닌 곳 — 전부 **무엇이 잘못됐는지 이름으로** 말한다.
 *   조용히 엉뚱한 곳에 16개를 쏟아 놓으면 되찾기가 훨씬 비싸다.
 */
function resolveOut(argv, env) {
  const i = argv.indexOf('--out');
  const raw = (i > -1 && argv[i + 1]) ? argv[i + 1] : (env.LP_APP_DIR || null);
  if (!raw) return { out: null };

  // ★ 자리표시를 그대로 붙여 넣은 경우. 셸이 꺽쇠를 먹어 버려 「앱」만 남기도 한다
  // ★ 셸이 꺾쇠를 먹어 버리는 경우가 있다(zsh 리디렉션). 그때는 「앱 폴더」만
  //   남으므로, 꺾쇠뿐 아니라 **자리표시로 쓰는 말**도 함께 본다
  const PLACEHOLDER = /(^|[\/\s])(앱 ?폴더|앱저장소|경로|여기|your-?app|path-?to)([\/\s]|$)/i;
  if (/[<>]/.test(raw) || PLACEHOLDER.test(raw)) {
    return {
      error: '--out 에 자리표시가 그대로 들어왔습니다: ' + raw + '\n'
        + '  「<앱 폴더>」는 여기에 당신의 앱 저장소 경로를 넣으라는 뜻입니다.\n'
        + '  예)  npm run im:embed -- --out "$LP_APP_DIR/im-flow"\n'
        + '  경로에 빈칸이나 한글이 있으면 따옴표로 감쌉니다.',
    };
  }

  const out = path.resolve(raw);
  const parent = path.dirname(out);
  if (!fs.existsSync(parent)) {
    return {
      error: '낼 곳의 상위 폴더가 없습니다: ' + parent + '\n'
        + '  앱 저장소 경로가 맞는지 확인하십시오. 여기서 폴더를 만들지 않습니다 —\n'
        + '  경로를 잘못 적었을 때 엉뚱한 곳에 16개가 쏟아지기 때문입니다.',
    };
  }
  // ★ `im-flow` 로 끝나지 않으면 **묻지 않고 만들지 않는다.** 앱 웹루트에
  //   화면 파일이 흘어지면 무엇이 우리 것인지 구분이 안 된다
  if (path.basename(out) !== 'im-flow') {
    return {
      error: '낼 곳이 im-flow 가 아닙니다: ' + out + '\n'
        + '  화면 사본은 앱 웹루트의 im-flow 폴더로 갑니다.\n'
        + '  예)  --out "' + out + '/im-flow"',
    };
  }
  if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
  return { out };
}

if (require.main === module) {
  const picked = resolveOut(process.argv, process.env);
  if (picked.error) {
    console.error('배포용 사본을 만들지 못했다.\n' + picked.error);
    process.exit(2);
  }
  const out = picked.out;
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

module.exports = { resolveOut, build, required, checkBridge, unlisted, GLOBALS };
