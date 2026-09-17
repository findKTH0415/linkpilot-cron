'use strict';
/**
 * **「0/5 인데 초록」을 막는다** 〈2026-09-17 · D-213〉
 *
 * [무엇이 났나] 브이월드 수집이 **5필지 전부 실패한 실행을 초록으로 끝냈다**
 *   (실측: `fetch failed` 3 · `HTTP 502` 2). 스크립트가 걸린 것을 요약 §4 에
 *   **적기만** 하고 종료 코드가 늘 0 이었다. 초록이라 아무도 안 열어 보고,
 *   정작 하려던 수집은 **한 번도 안 됐다.**
 *
 * [왜 갈래가 넷인가] 할 일이 **갈래마다 정반대**다 —
 *   2(못 쟀다)는 **자리를 옮기는 일**이고 3(서버가 대답)은 **콘솔을 여는 일**이다.
 *   뭉뚱그리면 이미 하신 활용신청을 또 하시게 되거나, 될 자리를 안 된다고 접는다
 *   (§4 「못 닿음을 승인 안 됨으로 적지 않는다」와 같은 규칙).
 *
 * ★ **판정 함수를 떼어 내 돌려서 잰다.** 「그 낱말이 있는가」는 아무것도 안 재는 것이다 —
 *   실제 오류 문구를 먹여 **어느 값으로 끝나는지** 본다.
 * ★★ **주석을 떼고 본다** — 이 경위에 옛 글자를 그대로 적었으므로, 안 떼면
 *   되돌려도 주석 때문에 초록이 된다 (§8 그 함정이 거꾸로 온 경우).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'vworld-fetch.mjs');
const WF = path.join(ROOT, '.github', 'workflows', 'vworld.yml');

const read = (p) => fs.readFileSync(p, 'utf8');
/** 주석 줄을 떼고 본다 (`//` 와 `#`) */
const codeOf = (p, mark) =>
  read(p).split('\n').filter((l) => !new RegExp(`^\\s*${mark}`).test(l)).join('\n');

/**
 * 스크립트의 판정 규칙을 **소스에서 오려 내** 돌린다.
 * ★ 베끼면 한쪽이 옛말을 한다 — 정규식 둘과 갈래 판정을 그 파일에서 읽는다.
 */
/**
 * 스크립트의 판정을 **소스에서 오려 내 실제로 돌린다.**
 *
 * ★★★ **베끼면 한쪽이 옛말을 한다** 〈사보타주 둘이 빠져나가서 고쳤다〉.
 *   앞 판은 정규식만 소스에서 읽고 **갈래 순서는 검사 안에 베껴** 두었다. 그래서
 *   스크립트에서 5xx 갈래를 통째로 지워도, 순서를 뒤집어도 **검사는 초록이었다** —
 *   재려던 것(「스크립트가 어떻게 가르는가」)을 안 재고 **제 논리를 재고 있었다**
 *   (§8-1 「두 벌이면 한쪽이 옛말을 한다」 · §12-23 의 그 잣대와 같다).
 *
 * ★ 그래서 `let code = 0;` 부터 판정 끝까지를 **글자로 오려 내 `new Function` 으로
 *   돌린다.** 순서·조건·문구가 전부 그 파일에서 온다.
 * ★★ 오려 낼 자리를 **꼬리 글자로 찾지 않는다** — 중괄호 짝을 세어 블록 끝을 잡는다
 *   (§12-6 에서 세 번 겪은 자리).
 */
function verdictOf({ got, total, problems }) {
  const src = read(SCRIPT);

  const pick = (name) => {
    const m = src.match(new RegExp(`const ${name} = (\\/.*\\/i?);`));
    assert.ok(m, `판정 정규식 \`${name}\` 을 못 찾았습니다 — 이 칸은 아무것도 안 잽니다`);
    return m[1];
  };

  const at = src.indexOf('let code = 0;');
  assert.ok(at > -1, '판정 블록을 못 찾았습니다 — 이 칸은 아무것도 안 잽니다');
  /* 중괄호 짝으로 if/else 사슬의 끝을 잡는다 */
  const from = src.indexOf('if (', at);
  let depth = 0; let end = -1;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        /* 다음이 ` else` 면 사슬이 이어진다 */
        const rest = src.slice(i + 1, i + 8);
        if (!/^\s*else/.test(rest)) { end = i + 1; break; }
      }
    }
  }
  assert.ok(end > from, '판정 사슬의 끝을 못 잡았습니다 — 이 칸은 아무것도 안 잽니다');
  const chain = src.slice(at, end);
  assert.ok(/else if/.test(chain),
    '오려 낸 것에 갈래가 없습니다 — 엉뚱한 자리를 잡았습니다');

  const body = `
    const UNREACHED = ${pick('UNREACHED')};
    const ANSWERED  = ${pick('ANSWERED')};
    const SERVER5XX = ${pick('SERVER5XX')};
    const AUTHDENY  = ${pick('AUTHDENY')};
    const NOMATCH   = ${pick('NOMATCH')};
    const n = (re) => problems.filter((t) => re.test(t)).length;
    const unreached = n(UNREACHED), answered = n(ANSWERED);
    const s5xx = n(SERVER5XX), deny = n(AUTHDENY), nomatch = n(NOMATCH);
    ${chain}
    return { code, verdict, unreached, answered, s5xx, deny, nomatch };
  `;
  // eslint-disable-next-line no-new-func
  const run = new Function('parcels', 'LOTS', 'problems', body);
  return run({ length: got }, { length: total }, problems);
}

/* ── 갈래 넷을 실제 문구로 먹여 돌린다 ───────────────────── */

test('★★★ 전부 실패하면 **빨갛게 끝난다** — 「0/5 인데 초록」을 막는다 (D-213)', () => {
  /* 사장님 화면에 실제로 찍힌 문구다 (실측 2026-09-17) */
  const real = [
    '695-4 지오코딩: 지오코딩 실패 — fetch failed (주소: …)',
    '695-11 지오코딩: 지오코딩 실패 — HTTP 502 (주소: …)',
    '610-1 지오코딩: 지오코딩 실패 — HTTP 502 (주소: …)',
    '610-2 지오코딩: 지오코딩 실패 — fetch failed (주소: …)',
    '612-1 지오코딩: 지오코딩 실패 — fetch failed (주소: …)',
  ];
  const v = verdictOf({ got: 0, total: 5, problems: real });
  assert.notStrictEqual(v.code, 0,
    '5필지 전부 실패했는데 0(초록)으로 끝납니다 — 이것이 D-213 의 그 고장입니다.');
  /* ★★★ **실측에 인증 거부가 0건이었다.** 있는 것은 `fetch failed` 와 `HTTP 502` 뿐이다 —
     열쇠가 틀렸으면 VWorld 는 `INVALID_KEY` 를 준다. 502 는 **그쪽 게이트웨이**다.
     그러니 「콘솔을 보라」로 적으면 **거기에는 고칠 것이 없다** (§4.6 의 그 잣대). */
  assert.strictEqual(v.code, 3,
    `HTTP 5xx 만 왔으므로 3(그쪽 서버) 이어야 합니다 (받은 값 ${v.code}) — `
    + '4(인증 거부)로 적으면 사장님이 고칠 것이 없는 콘솔을 여십니다.');
  assert.strictEqual(v.deny, 0, '실측 문구에 인증 거부가 없는데 있다고 셉니다');
  assert.ok(v.s5xx >= 1, 'HTTP 502 를 5xx 로 안 셉니다');
});

test('★★★ 「대답이 왔다」 안에서 **할 일이 다른 셋**을 갈라 준다 (5xx · 인증 · 주소)', () => {
  const only5xx = verdictOf({ got: 0, total: 5, problems: ['695-4: HTTP 502 (4회 시도 실패)'] });
  assert.strictEqual(only5xx.code, 3,
    '5xx 만 왔는데 3(그쪽 서버)으로 안 갈립니다 — 우리 쪽에 고칠 것이 없는 갈래입니다.');

  const denied = verdictOf({ got: 0, total: 5, problems: ['695-4: VWorld INVALID_KEY: 인증 실패'] });
  assert.strictEqual(denied.code, 4,
    '인증 거부인데 4 로 안 갈립니다 — 그러면 콘솔을 보라고 말하지 않습니다.');

  const miss = verdictOf({ got: 0, total: 5, problems: ['695-4: 결과가 없습니다'] });
  assert.strictEqual(miss.code, 5,
    '주소 미매칭인데 5 로 안 갈립니다 — 열쇠를 보러 가시게 됩니다.');

  /* ★★ **섞이면 고칠 것이 있는 쪽을 먼저 가리킨다** — 5xx 를 먼저 말하면
     「기다리면 된다」로 읽혀 진짜 고칠 것(인증)이 묻힌다 */
  const mixed = verdictOf({ got: 0, total: 5, problems: [
    '695-4: HTTP 503', '695-11: VWorld INVALID_KEY: 권한 없음',
  ] });
  assert.strictEqual(mixed.code, 4,
    '5xx 와 인증 거부가 섞였는데 5xx(기다리면 된다)를 먼저 말합니다 — 고칠 것이 묻힙니다.');
});

test('★★★ 「못 쟀다」와 「서버가 대답했다」를 **갈라 준다** — 할 일이 정반대다', () => {
  const noAnswer = verdictOf({ got: 0, total: 5, problems: [
    '695-4 지오코딩: fetch failed', '695-11 지오코딩: ETIMEDOUT',
  ] });
  assert.strictEqual(noAnswer.code, 2,
    '응답이 한 번도 없었는데 「못 쟀다」(2) 로 안 갈립니다 — '
    + '그러면 열쇠·활용신청을 보러 가시게 됩니다 (§4 의 그 규칙).');

  const answered = verdictOf({ got: 0, total: 5, problems: [
    '695-4 지오코딩: VWorld INVALID_KEY: 인증 실패',
  ] });
  assert.notStrictEqual(answered.code, 2,
    '서버가 대답했는데 「못 쟀다」로 셉니다 — 그러면 될 자리를 안 된다고 접습니다.');
});

test('★★ 일부만 받은 것을 **전부 받은 것과 갈라** 센다', () => {
  assert.strictEqual(verdictOf({ got: 5, total: 5, problems: [] }).code, 0,
    '전부 받았는데 빨갛게 끝납니다');
  assert.strictEqual(verdictOf({ got: 2, total: 5, problems: ['610-1 필지: 해당 좌표에 필지 없음'] }).code, 1,
    '2/5 인데 초록으로 끝납니다 — 빠진 셋이 사라집니다');
  /* ★ 지도 일부 실패는 경고로만 — 필지를 다 받았으면 초록이다 */
  assert.strictEqual(verdictOf({ got: 5, total: 5, problems: ['지도 근접 위성 미수집'] }).code, 0,
    '필지는 다 받았는데 지도 하나 때문에 빨갛게 끝납니다 — 고칠 것이 없는 자리를 고치라고 말합니다');
});

test('★★★ 스크립트가 **그 값으로 실제로 끝낸다** (`process.exit`) · 판정을 요약 «맨 앞»에 넣는다', () => {
  const s = codeOf(SCRIPT, '//');
  assert.ok(/process\.exit\(code\)/.test(s),
    '판정 값으로 끝내지 않습니다 — 갈래를 갈라 놓고 종료 코드가 늘 0 이면 아무 뜻이 없습니다.');
  /* ★ §6-3 ① — 판정이 §4 맨 끝에 있으면 안 읽힌다. 앞 판이 실제로 그랬다 */
  assert.ok(/log\.splice\(\s*\d+\s*,\s*0\s*,/.test(s),
    '판정을 요약 맨 앞에 끼워 넣지 않습니다 — 끝에 적으면 안 읽힙니다 (§6-3 ①).');
  /* ★★ 나르는 자리가 집을 표지 */
  assert.ok(/LP_VWORLD verdict=/.test(s),
    '워크플로가 집어 갈 표지(`LP_VWORLD verdict=`)가 없습니다.');
});

test('★★★ 워크플로가 판정을 **나르고** 그 값으로 끝낸다 (D-212 계열 — 나르는 자리가 버리면 화면에 안 온다)', () => {
  const w = codeOf(WF, '#');
  assert.ok(/2>&1 \| tee/.test(w),
    'stderr 를 함께 받지 않습니다 — 판정이 그쪽으로 나오면 통째로 버려집니다 (§12-19 의 그 자리).');
  assert.ok(/GITHUB_STEP_SUMMARY/.test(w),
    '판정을 실행 요약에 안 싣습니다 — Actions 로그만 보고는 아무도 안 봅니다.');
  assert.ok(/PIPESTATUS\[0\]/.test(w),
    '`tee` 뒤에서 스크립트의 종료 코드를 안 집습니다 — tee 의 0 이 판정을 덮습니다.');
  /* ★ 갈래 넷 전부에 대응하는 자리가 있는가 — 그리고 0 말고는 다 빨갛게 */
  const step = w.match(/- name: 판정[\s\S]*?esac/);
  assert.ok(step, '판정으로 끝내는 단계가 없습니다.');
  /* ★ 갈래 이름을 정규식에 넣을 때 **이스케이프를 손으로 붙이지 않는다** — `1)` 를
     `\1)` 로 감쌌다가 **후방참조**가 되어 「정규식이 깨졌다」로 빨개졌다. 고침이 옳은데
     재는 자리가 틀린 것이다. 낱말을 그대로 쓰고 escape 를 한 곳에서 한다. */
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const c of ['1)', '2)', '3)', '4)', '5)', '*)']) {
    const seg = step[0].match(new RegExp(`^\\s*${esc(c)}[^\\n]*exit 1`, 'm'));
    assert.ok(seg, `갈래 \`${c}\` 가 빨갛게 끝나지 않습니다 — 「못 쟀다」도 통과가 아닙니다 (§8).`);
  }
  /* ★★ 결과를 다 남긴 뒤에 끝내야 빨간 실행에서도 받을 것이 있다 */
  assert.ok(w.indexOf('upload-artifact') < w.indexOf('- name: 판정'),
    '판정이 아티팩트 업로드보다 앞에 있습니다 — 빨갛게 끝나면 받을 것이 없어집니다.');
  assert.ok(/- name: 결과 커밋\n\s*if: always\(\)/.test(w),
    '결과 커밋이 `if: always()` 가 아닙니다 — 실패한 실행의 진단이 저장소에 안 남습니다.');
});
