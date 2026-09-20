/**
 * **넣은 열쇠가 죽는 것을 막는다** — 지침서와 저장소가 부르는 이름이 같은지 잰다.
 *
 * ★★★ 2026-09-01. 사장님이 「공공 API 활용 지침서」를 주셨다. 그 §9 점검목록의
 *   **첫 줄**이 「Secret 이름이 워크플로의 `env:` 와 정확히 일치하는가」다.
 *   그것을 사람이 눈으로 세게 두지 않고 여기서 센다.
 *
 * ★ 왜 이 사고가 비싼가 — 이름이 어긋나면 **아무 오류도 안 난다.**
 *   넣은 사람은 넣었다고 알고, 스모크는 「미설정」이라 말하고, 배포는 초록이다.
 *   커넥터는 §4.6 대로 조용히 `unavailable` 을 돌려주고 그 절을 비운다.
 *   실제로 두 번 났다 — `ECOS_API_KEY`/`ECOS_BOK_KEY` 와 `LAW_OC`/`LAW_OPEN_DATA`.
 *   그때 정한 답이 「다시 넣으시라 하지 않고 **둘 다 읽는다**」였다.
 *
 * ★★ 여기서 재는 것 넷:
 *   A. 지침서가 저장소에 있고 CLAUDE.md 가 **그것을 가리킨다** (두 벌이면 한쪽이 옛말을 한다)
 *   B. 지침서 표의 이름을 **저장소가 알아본다** — 모르는 이름이면 넣어도 죽는다
 *   C. 저장소가 읽는 공공 API 열쇠가 **지침서 표에 있다** — 반대 방향(문서가 뒤처지는 것)
 *   D. 지침서 표의 이름이 **`SECRET_ENV` 에 있다** — 없으면 값이 로그에 평문으로 남는다 (§2)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const GUIDE = path.join(ROOT, 'docs', '운영지침-공공API-활용.md');

const read = (p) => fs.readFileSync(p, 'utf8');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
};

/**
 * 지침서 인벤토리의 Secret 이름. **절 번호로 찾지 않는다** — 판이 바뀌면 번호가 움직인다
 * (v1.2 는 §1, v1.3 은 §4 였다. 번호로 찾던 앞 판은 그 자리에서 네 칸이 통째로 빨개졌다).
 * 제목의 **낱말**로 찾고, 표 첫 칸만 읽는다.
 */
function inventorySection() {
  const s = read(GUIDE);
  const heads = [...s.matchAll(/^##+ .*$/gm)];
  const i = heads.findIndex((h) => /인벤토리|등록된 키 목록/.test(h[0]));
  assert.ok(i >= 0, '지침서에서 키 인벤토리 절을 못 찾았습니다 (제목에 「인벤토리」 또는 「등록된 키 목록」)');
  const from = heads[i].index;
  /* 다음 **같은 깊이 이상**의 제목까지 — 4-A·4-B 같은 하위 절은 안에 품는다 */
  const depth = heads[i][0].match(/^#+/)[0].length;
  const nxt = heads.slice(i + 1).find((h) => h[0].match(/^#+/)[0].length <= depth);
  return s.slice(from, nxt ? nxt.index : s.length);
}

/** 표 첫 칸의 `NAME` 만 — 설명 문단의 코드 이름을 Secret 으로 오인하지 않는다 */
function namesIn(text) {
  return [...new Set(text.split('\n').filter((l) => /^\s*\|/.test(l)).flatMap((l) => {
    const first = l.split('|')[1] || '';
    return [...first.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((m) => m[1]);
  }))];
}

/** 열쇠인 군(데이터 API · AI/미디어)과 **열쇠가 아닌 군**(인프라·설정값)을 갈라 읽는다 */
function groups() {
  const sec = inventorySection();
  const subs = [...sec.matchAll(/^###+ .*$/gm)];
  const cut = (k) => {
    const i = subs.findIndex((h) => k.test(h[0]));
    if (i < 0) return '';
    return sec.slice(subs[i].index, subs[i + 1] ? subs[i + 1].index : sec.length);
  };
  const infra = cut(/인프라|키가 아님/);
  /* ★ **변경 이력 절은 인벤토리가 아니다.** 거기엔 **지운 이름**(LOCALDATA_KEY)과
     이름이 바뀐 옛 이름(WORLD_NEWS_KEY), 그리고 다른 군으로 옮긴 것(TS_AUTHKEY)이 적힌다.
     그것까지 세면 「저장소가 모르는 이름」·「마스킹 안 됨」이 무더기로 뜬다(실측 5건). */
  const log = cut(/대조 결과|변경 이력|v[0-9.]+ 대비/);
  let keyText = sec;
  for (const t of [infra, log]) if (t) keyText = keyText.replace(t, '');
  const infraOnly = log && infra ? infra.replace(log, '') : infra;
  return { keys: namesIn(keyText), infra: namesIn(infraOnly), all: namesIn(keyText) };
}

const guideKeys = () => groups().keys;

/* ── A. 원문은 한 곳에 ─────────────────────────────────────────── */
test('A. 지침서가 저장소에 있고 CLAUDE.md 가 그것을 가리킨다', () => {
  assert.ok(fs.existsSync(GUIDE), '지침서가 docs/ 에 없습니다 — 대화에만 있으면 세션이 끝나면 사라집니다');
  const md = read(path.join(ROOT, 'CLAUDE.md'));
  assert.ok(md.includes('운영지침-공공API-활용.md'),
    'CLAUDE.md 가 지침서를 안 가리킵니다 — 규칙을 찾을 길이 없으면 없는 규칙입니다');
  /* 두 벌 금지: CLAUDE.md 가 지침서의 표를 그대로 옮겨 적고 있지 않은가 */
  const keys = guideKeys();
  const copied = keys.filter((k) => md.includes('`' + k + '`'));
  assert.ok(copied.length < keys.length,
    '지침서 표가 CLAUDE.md 에 통째로 옮겨졌습니다 — 두 벌이 되면 한쪽이 옛말을 합니다 (§8-1)');
});

/* ── B. 지침서 이름을 저장소가 알아보는가 ──────────────────────── */
test('B. 지침서 표의 열쇠 이름을 저장소가 알아본다 (모르는 이름이면 넣어도 죽는다)', () => {
  const files = walk(path.join(ROOT, 'im-agent'));
  const src = files.map(read).join('\n');
  const env = fs.existsSync(path.join(ROOT, '.env.example')) ? read(path.join(ROOT, '.env.example')) : '';
  const wfDir = path.join(ROOT, '.github', 'workflows');
  const wf = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).map((f) => read(path.join(wfDir, f))).join('\n');

  const unknown = guideKeys().filter((k) => {
    if (new RegExp('process\\.env\\.' + k + '\\b').test(src)) return false;   // 코드가 직접 읽는다
    if (new RegExp("['\"]" + k + "['\"]").test(src)) return false;            // KEY_NAMES·SECRET_ENV 등 목록에 있다
    if (new RegExp('^\\s*#?\\s*' + k + '=', 'm').test(env)) return false;     // .env.example 에 있다
    if (new RegExp('secrets\\.' + k + '\\b').test(wf)) return false;          // 워크플로가 넘긴다
    return true;
  });
  assert.deepStrictEqual(unknown, [],
    '지침서에는 있는데 저장소 어디서도 안 부르는 이름입니다 — 넣으셔도 아무 오류 없이 죽습니다: ' + unknown.join(', '));
});

/* ── C. 문서가 뒤처지지 않는가 ─────────────────────────────────── */
test('C. 커넥터가 읽는 공공 API 열쇠가 지침서 표에 있다', () => {
  const conn = path.join(ROOT, 'im-agent', 'connectors');
  const src = walk(conn).map(read).join('\n');
  const used = [...new Set([...src.matchAll(/process\.env\.([A-Z][A-Z0-9_]{3,})/g)].map((m) => m[1])
    .concat([...src.matchAll(/KEY_NAMES\s*=\s*\[([^\]]*)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/'([A-Z][A-Z0-9_]{3,})'/g)].map((x) => x[1]))))]
    /* 공공 API 열쇠만 본다 — RHINO_COMPUTE 는 3D 연산 서비스라 이 지침서의 대상이 아니다 */
    .filter((k) => /_(KEY|OC|DOMAIN|DATA)$/.test(k)
      && !/^IM_|^LP_|^GITHUB_|^GH_|^RHINO_|^ANTHROPIC_|^BOX_|^DROPBOX_|^MS_|^GOOGLE_/.test(k));
  /* ★ **C 가 묻는 것은 「지침서에 적혀 있는가」다** — 어느 군인지가 아니다.
     `VWORLD_DOMAIN` 은 4-C(설정값)에 있지만 커넥터가 읽는 값이고 지침서에도 있다.
     열쇠 군만 보면 「문서에 없다」고 잘못 말한다 (실측 1건). 인벤토리 전체로 본다. */
  const g = groups();
  const inGuide = new Set(g.keys.concat(g.infra));
  const missing = used.filter((k) => !inGuide.has(k));
  assert.deepStrictEqual(missing, [],
    '커넥터는 읽는데 지침서 표에 없는 열쇠입니다 — 새 저장소에 옮길 때 빠뜨립니다: ' + missing.join(', '));
});

/* ── D. 값이 로그에 새지 않는가 ────────────────────────────────── */
test('D. 지침서 표의 열쇠가 SECRET_ENV 에 있다 (없으면 로그에 평문으로 남는다 · §2)', () => {
  const http = read(path.join(ROOT, 'im-agent', 'connectors', 'http.js'));
  const i = http.indexOf('SECRET_ENV');
  assert.ok(i >= 0, 'http.js 에서 SECRET_ENV 를 못 찾았습니다');
  const block = http.slice(i, http.indexOf('];', i));
  /* ★ 주석을 떼고 본다 — 이 저장소는 경위 주석이 길어 검사가 눈이 먼다 (§8) */
  const bare = block.split('\n').map((l) => l.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
  /* 생성형 AI·이미지 열쇠는 공공 API 가 아니라 이 목록의 대상이 아니다 */
  const skip = new Set(['GEMINI_API_KEY', 'PEXELS_API_KEY', 'KRX_API_KEY']);
  const leaky = guideKeys().filter((k) => !skip.has(k) && !new RegExp("'" + k + "'").test(bare));
  assert.deepStrictEqual(leaky, [],
    'SECRET_ENV 에 없어 값이 로그·오류 본문에 평문으로 남을 수 있습니다: ' + leaky.join(', '));
});

/* ── E. CLAUDE.md 가 「지금 쓴다」고 적은 이름을 저장소가 알아보는가 ── */
/**
 * ★★★ 2026-09-14 신설. **「들었다」와 「들어 있다」는 다른 사실이다** 〈실측〉.
 *   CLAUDE.md 가 말씀으로 들은 이름(`WORLD_NES_KEY`)을 그대로 박아 두고 있었다.
 *   비밀 목록에 그 이름은 **없었다.** 다른 세 곳은 이미 맞았고 **이 파일만 옛말을 했는데**,
 *   이 파일이 **가장 먼저 읽히는 파일**이다 — 다음 사람이 없는 이름을 배선하고,
 *   그 값은 가려지지도 않아 로그에 평문으로 샐 수 있었다 (§2).
 *
 * ★ **B 가 이것을 못 잡는다.** B 는 «지침서 → 저장소» 방향이고, 이 이름들은
 *   지침서가 아니라 **CLAUDE.md 에만** 적혀 있었다. 방향이 하나 비어 있었다.
 *
 * ★★ **경위 문장은 안 본다.** 이 저장소는 「앞 판은 `WORLD_NES_KEY` 라고 적었다」처럼
 *   **틀린 이름을 일부러 인용**한다. 그것까지 세면 경위를 잘 적을수록 빨개진다
 *   (§8 「경위를 잘 적어 둘수록 검사가 눈이 먼다」). 그래서 **「지금 쓴다」고 말하는
 *   두 자리만** 읽는다 — §4.1 의 기관·키 표와 「지금 읽는 이름」 블록.
 *
 * ★★★ **못 잰 것을 통과로 적지 않는다** (§8). 두 자리에서 이름이 하나도 안 나오면
 *   글이 바뀌어 검사가 눈이 먼 것이므로 **빨갛게 끝난다** — 조용히 0개를 세지 않는다.
 */
function claudeLiveNames() {
  const md = read(path.join(ROOT, 'CLAUDE.md')).split('\n');
  const tbl = [];
  const blk = [];

  /* ① 기관·키 표 — 머리글이 「키」인 칸만 읽는다. 칸 차례가 바뀌어도 따라간다 */
  for (let i = 0; i < md.length; i++) {
    const cells = md[i].split('|').map((c) => c.trim());
    if (cells[1] !== '기관' || !cells.includes('키')) continue;
    const col = cells.indexOf('키');
    for (let j = i + 2; j < md.length && /^\s*\|/.test(md[j]); j++) {
      const row = md[j].split('|').map((c) => c.trim());
      for (const m of (row[col] || '').matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)) tbl.push(m[1]);
    }
  }

  /* ② 「지금 읽는 이름」 블록 — 그 줄과, 그보다 **더 들여쓴** 이어지는 줄까지.
     ★ 다음 ★ 로 끊지 않는다: 블록 안에 ★ 를 넣는 순간 조용히 짧아진다 (M-84 와 같은 결) */
  for (let i = 0; i < md.length; i++) {
    if (!/지금 읽는 이름/.test(md[i])) continue;
    const base = md[i].match(/^\s*/)[0].length;
    let j = i;
    do {
      for (const m of md[j].matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)) blk.push(m[1]);
      j++;
    } while (j < md.length && md[j].trim() && md[j].match(/^\s*/)[0].length > base);
  }
  return { table: [...new Set(tbl)], block: [...new Set(blk)], all: [...new Set(tbl.concat(blk))] };
}

test('E. CLAUDE.md 가 「지금 쓴다」고 적은 열쇠를 저장소가 알아본다 (들었다 ≠ 들어 있다)', () => {
  const src2 = claudeLiveNames();
  /* ★★★ **두 자리를 «각각» 센다.** 합쳐서 세면 한쪽이 통째로 사라져도 다른 쪽 수로 덮여
     초록으로 끝난다 — 「그 숫자를 재는 법이 재려는 것을 다 덮는가」 (§6-2-6 · §8 과 같은 규칙).
     실측: 표 8개 · 「지금 읽는 이름」 5개. 어느 한쪽이 0 이면 그 자리는 못 잰 것이다. */
  assert.ok(src2.table.length >= 5,
    '§4.1 의 기관·키 표에서 열쇠를 ' + src2.table.length + '개밖에 못 읽었습니다 — '
    + '표가 사라졌거나 머리글(「기관」·「키」)이 바뀐 것입니다 (못 잰 것은 통과가 아닙니다 · §8)');
  assert.ok(src2.block.length >= 3,
    '「지금 읽는 이름」 줄에서 열쇠를 ' + src2.block.length + '개밖에 못 읽었습니다 — '
    + '그 낱말이 사라졌거나 들여쓰기가 바뀐 것입니다 (못 잰 것은 통과가 아닙니다 · §8)');
  const live = src2.all;

  const files = walk(path.join(ROOT, 'im-agent'));
  const src = files.map(read).join('\n');
  const env = fs.existsSync(path.join(ROOT, '.env.example')) ? read(path.join(ROOT, '.env.example')) : '';
  const wfDir = path.join(ROOT, '.github', 'workflows');
  const wf = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).map((f) => read(path.join(wfDir, f))).join('\n');

  /* ★★★ **`SECRET_ENV` 에 있는 것을 「안다」로 세지 않는다** 〈2026-09-14 · 되돌려서 잡았다〉.
     그 목록은 **가리는 목록**이라 지운 이름·오타 이름까지 일부러 품는다 — `WORLD_NES_KEY`
     가 실제로 거기 있다. 그래서 B 와 같은 잣대(문자열 어디든)를 쓰면 **어제 난 그 고장이
     그대로 통과한다**(실측: 심어 봤더니 초록). **가리는 것과 쓰는 것은 다른 사실이다.**
     ★ 그러니 근거는 둘뿐이다 — **코드가 읽거나**(`process.env.X`) **워크플로가 나르거나**
       (`secrets.X`). 사장님이 실제로 넣으신 이름은 나르는 자리에 반드시 있다. */
  const unknown = live.filter((k) => {
    if (new RegExp('process\\.env\\.' + k + '\\b').test(src)) return false;   // 코드가 읽는다
    if (new RegExp('secrets\\.' + k + '\\b').test(wf)) return false;            // 워크플로가 나른다
    if (new RegExp('^\\s*#?\\s*' + k + '=', 'm').test(env)) return false;       // .env.example 에 있다
    return true;
  });
  assert.deepStrictEqual(unknown, [],
    'CLAUDE.md 는 지금 쓴다고 적는데 저장소 어디서도 안 부르는 이름입니다 — '
    + '다음 사람이 이 이름을 배선하면 아무 오류 없이 죽고, 가려지지도 않습니다 (§2): ' + unknown.join(', '));
});

/* ★★★ F. **진단 요약의 이름 차례가 엔진의 차례와 같다** 〈2026-09-20 · 실측 · D-247〉.
   [무엇이 났나] `api-report.js` 가 브이월드 이름을 **손으로** 적어 두어 차례가 엔진과
   달랐다 — 엔진은 D-221 의 콘솔 실측대로 `WEB` 이 앞인데 표는 `REPORT` 가 앞이었다.
   그래서 2026-09-20 요약이 **「✅ LINKPILOT_VWORLD_REPORT_KEY」**라고 적었는데
   **엔진이 실제로 쓰는 것은 WEB** 이었다. 브이월드가 막히는 날 그 줄이 **엉뚱한 열쇠를
   가리키고**, 사장님은 고칠 것이 없는 콘솔을 보러 가신다 (§4.6 · M-86).
   ★ A~E 는 지침서·커넥터·`SECRET_ENV` 셋을 대 보는데 **이 표는 그 셋 중 어디에도 없어
     아무도 안 세고 있었다.** 잣대는 하나다 — 「그 숫자를 재는 법이 재려는 것을
     다 덮는가」 (§6-2-6 의 46 → 105). */
test('F. 진단 요약의 열쇠 이름 차례가 커넥터와 같다 (두 벌이면 한쪽이 옛말을 한다 · §8-1)', () => {
  const REPORT = path.join(ROOT, 'im-agent', 'tools', 'api-report.js');
  /* ★★ **주석을 떼고 본다** — 이 고침의 경위를 `api-report.js` 주석에 그대로 적었고,
     안 떼면 그 글자가 「손으로 적었다」로 읽혀 **고침이 옳은데 빨개진다** (§8 의 그 함정). */
  const src = read(REPORT).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  const { KEYS } = require(REPORT);
  assert.ok(Array.isArray(KEYS) && KEYS.length >= 10,
    '진단 표(KEYS)를 못 읽었습니다 — 이 칸이 아무것도 안 잽니다 (§8)');

  for (const [file, label] of [['vworldkey', '브이월드'], ['datakey', '공공데이터포털']]) {
    const { KEY_NAMES } = require(path.join(ROOT, 'im-agent', 'connectors', `${file}.js`));
    assert.ok(Array.isArray(KEY_NAMES) && KEY_NAMES.length >= 2,
      `${file}.js 의 KEY_NAMES 를 못 읽었습니다 — 이 칸이 아무것도 안 잽니다`);
    const row = KEYS.find((r) => r[1] === label);
    assert.ok(row, `진단 표에서 ${label} 줄을 못 찾았습니다`);
    assert.strictEqual(row[0], KEY_NAMES.join('|'),
      `${label} 이름 차례가 커넥터와 다릅니다 — 요약이 «엔진이 안 쓰는 열쇠»를 가리킵니다.\n`
      + `  진단 표: ${row[0]}\n  커넥터 : ${KEY_NAMES.join('|')}`);
  }

  /* ★ 반대로도 막는다 — 소스에 이름이 **통째로 박혀** 있으면 그것이 곧 두 벌이다 */
  for (const n of ['LINKPILOT_VWORLD_REPORT_KEY', 'LINKPILOT_VWORLD_WEB_KEY', 'SPECIAL_DAY_INFO']) {
    assert.ok(!new RegExp(`'[^']*${n}[^']*\\|`).test(src) && !new RegExp(`\\|[^']*${n}`).test(src),
      `${n} 을 진단 표에 손으로 적었습니다 — 커넥터에서 읽어야 차례가 안 갈립니다 (§8-1).`);
  }
});
