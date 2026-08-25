'use strict';
/**
 * env.js — 저장소 루트의 `.env` 를 읽어 환경변수로 올린다.
 *
 * 왜 필요한가: 키를 프로세스에 넣는 방법이 `export` 뿐이면, 도구가 셸을 새로
 * 띄울 때마다 값이 사라진다. 그래서 같은 사람이 같은 키를 하루에 몇 번씩 다시
 * 넣고, 그러다 안내문의 자리표시자를 그대로 붙여넣는 사고가 난다 (실제로 났다).
 *
 * ★ 새 의존성을 쓰지 않는다 (CLAUDE.md §5). dotenv 없이 30줄이면 된다.
 *
 * ★ **이미 설정된 값은 덮지 않는다.** GitHub Actions 의 Secret 이나 셸에서 직접
 *   준 값이 파일보다 세다. 반대로 두면 CI 에서 남의 `.env` 가 Secret 을 이긴다.
 *
 * ★ `.env` 는 `.gitignore` 에 있다 (`env.test.js` 가 그것을 검사한다).
 *   키는 코드·커밋에 남지 않는다 — CLAUDE.md §2.
 */

const fs = require('fs');
const path = require('path');

/** 저장소 루트 (이 파일 기준 im-agent/core → im-agent → 루트) */
function repoRoot() {
  return path.join(__dirname, '..', '..');
}

/**
 * `KEY=value` 한 줄을 판다.
 * 따옴표로 감싼 값은 벗겨 낸다 — 사람이 습관적으로 감싸고, 그 따옴표가 값에
 * 섞여 들어가면 인증만 실패하고 원인이 안 보인다.
 */
function parseLine(line) {
  const t = line.trim();
  if (!t || t.startsWith('#')) return null;
  const eq = t.indexOf('=');
  if (eq <= 0) return null;

  const key = t.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = t.slice(eq + 1).trim();
  const quoted = (value.startsWith("'") && value.endsWith("'"))
    || (value.startsWith('"') && value.endsWith('"'));
  if (quoted && value.length >= 2) value = value.slice(1, -1);
  return { key, value };
}

/**
 * @param {string} [file] 기본값: 저장소 루트의 `.env`
 * @returns {{loaded:string[], skipped:string[], file:string, exists:boolean}}
 *   loaded  이번에 올린 변수 이름 (값은 담지 않는다 — 로그에 찍히면 안 된다)
 *   skipped 이미 설정돼 있어 건드리지 않은 이름
 */
/**
 * ★★★ **점 없는 이름도 받는다** 〈2026-08-23 · 실제로 막혔다〉.
 *
 *   사장님께 「File Station 에서 `.env` 를 만드십시오」라고 안내했는데
 *   **File Station 의 [생성] 에는 「폴더」밖에 없다.** 파일을 만드는 메뉴가
 *   아예 없어서 `env` 라는 **폴더**가 만들어졌다.
 *
 *   ★ 점으로 시작하는 이름은 NAS 화면에서 **기본으로 숨겨지고, 만들기도
 *     어렵다.** 사람을 탓할 자리가 아니라 우리가 받아 주어야 하는 자리다.
 *   ★ 그래서 **`linkpilot.env` 도 읽는다.** 점이 없어 화면에 그냥 보이고,
 *     맥에서 만들어 올리기만 하면 된다.
 *   ★ 둘 다 있으면 **`.env` 가 이긴다** — 앞서 쓰던 사람이 놀라지 않게.
 */
const NAMES = ['.env', 'linkpilot.env'];

/** 실제로 있는 첫 번째 파일. 없으면 첫 이름을 돌려준다(있었으면 하는 자리) */
function pick(dir) {
  for (const n of NAMES) {
    const p = path.join(dir, n);
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (_) { /* 폴더일 수 있다 */ }
  }
  return path.join(dir, NAMES[0]);
}

function load(file) {
  const target = file || pick(repoRoot());
  const out = { loaded: [], skipped: [], file: target, exists: false };

  let text;
  try {
    text = fs.readFileSync(target, 'utf8');
    out.exists = true;
  } catch (_) {
    return out;   // 없는 것은 오류가 아니다 — Secrets 로만 돌리는 환경이 정상이다
  }

  text.split(/\r?\n/).forEach((line) => {
    const kv = parseLine(line);
    if (!kv) return;
    if (process.env[kv.key] !== undefined && process.env[kv.key] !== '') {
      out.skipped.push(kv.key);
      return;
    }
    process.env[kv.key] = kv.value;
    out.loaded.push(kv.key);
  });
  return out;
}

/**
 * ★★★ **한 번만 올린다** 〈2026-08-23 · 실제로 안 읽히고 있었다〉.
 *
 *   `.env` 를 올리는 곳이 `cli.js` 와 스모크 도구 **둘뿐**이었다. 그런데 실제
 *   서비스를 도는 것은 NAS 의 엔진 서버이고, 그쪽은 이 함수를 안 불렀다.
 *   그래서 **NAS 에 `.env` 를 놓아도 아무 일도 일어나지 않았다** —
 *   「키를 넣었는데 여전히 꺼져 있다」가 되고, 그 이유는 어디에도 안 보인다.
 *
 * ★ 그래서 키를 **읽는 쪽**(`core/llm.js` · `connectors/http.js`)이 스스로
 *   부른다. 어느 입구로 들어오든 같은 파일을 읽게 된다.
 * ★ 여러 번 불려도 한 번만 읽는다 — 부르는 곳이 늘어도 안전하다.
 * ★ 이미 설정된 값은 여전히 안 덮는다 (Secrets 가 파일보다 세다).
 */
let once = null;
function ensure() {
  if (!once) once = load();
  return once;
}

module.exports = { load, ensure, parseLine, repoRoot, pick, NAMES };
