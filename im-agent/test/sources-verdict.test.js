'use strict';
/**
 * sources-verdict.test.js — **초록이 「값이 왔다」를 뜻하게** 〈2026-09-19 · D-225〉
 *   〈사장님 「권하는 개선안 대로 진행해」 — 제가 올린 권장 ①〉
 *
 * ★★★ **무엇이 문제였나.** `yeoui893-sources.yml` 의 두 단계가 모두
 *   `continue-on-error: true` 이고 **판정 단계가 없어**, 조회가 전부 실패해도
 *   **초록으로 끝났다.** 초록이라 아무도 요약을 안 열어 보고, 정작 하려던 수집은
 *   한 번도 안 된 채로 남는다 — §12-24 가 브이월드에서 겪은 「0/5 인데 초록」과
 *   **같은 모양**이다.
 *
 * ★ **`continue-on-error` 자체는 남긴다.** 걷어내면 앞 단계가 막힌 날 뒷 단계가
 *   **아예 안 돈다** — 지가지수가 막혔다고 법령·금리까지 못 받을 이유가 없다.
 *   대신 **맨 끝에서 판정**한다.
 *
 * ★★ **판정은 맨 마지막이다** — 결과 커밋과 아티팩트를 먼저 남긴 뒤에 빨갛게
 *   끝내야 **빨간 실행에서도 받을 것이 남는다** (§12-24 의 그 규칙).
 *
 * ★★★ **검사가 «자기 논리»를 재면 안 된다** (§12-24 에서 사보타주 둘이 빠져나간 자리).
 *   그래서 판정을 **베끼지 않고 오려 내 실제로 돌린다** — 셸은 `bash` 로,
 *   스크립트의 갈래식은 소스에서 읽어 먹인다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { yamlNoComment } = require('./yaml-lite.js');

const ROOT = path.resolve(__dirname, '..', '..');
const WF = path.join(ROOT, '.github', 'workflows', 'yeoui893-sources.yml');
const read = (p) => fs.readFileSync(p, 'utf8');

test('판정 단계가 «맨 마지막»이다 (결과·아티팩트를 먼저 남긴 뒤에 빨갛게 끝낸다)', () => {
  const y = read(WF);
  const names = [...y.matchAll(/^\s*- name:\s*(.+)$/gm)].map((m) => m[1].trim());
  assert.ok(names.length >= 4, `단계를 못 읽었습니다 — 이 칸은 아무것도 안 잽니다 (${names.length}개)`);

  const iVerdict = names.findIndex((n) => /판정/.test(n));
  assert.ok(iVerdict >= 0, '판정 단계가 없습니다 — 그러면 전부 실패해도 초록입니다 (§12-24)');

  const iArtifact = names.findIndex((n) => /아티팩트/.test(n));
  const iCommit = names.findIndex((n) => /커밋/.test(n));
  assert.ok(iArtifact >= 0 && iCommit >= 0, '결과 커밋·아티팩트 단계를 못 찾았습니다');
  assert.ok(iVerdict > iArtifact && iVerdict > iCommit,
    '판정이 결과 커밋·아티팩트보다 «앞»에 있습니다 — 빨갛게 끝나면 받을 것이 안 남습니다 '
    + `(판정 ${iVerdict + 1}번째 · 커밋 ${iCommit + 1} · 아티팩트 ${iArtifact + 1})`);
});

test('★ 판정 셸을 «오려 내 돌린다» — 베끼면 한쪽이 옛말을 한다', () => {
  const y = yamlNoComment(read(WF));
  /* 판정 단계의 `run: |` 블록을 통째로 집는다 (꼬리 글자로 찾지 않는다 · §12-6) */
  const at = y.search(/^\s*- name:\s*판정/m);
  assert.ok(at >= 0, '판정 단계를 못 찾았습니다');
  const runAt = y.indexOf('run: |', at);
  assert.ok(runAt > 0, '판정 단계에 run 블록이 없습니다');
  const lines = y.slice(y.indexOf('\n', runAt) + 1).split('\n');
  const indent = (lines[0].match(/^\s*/) || [''])[0].length;
  const body = [];
  for (const l of lines) {
    if (l.trim() && (l.match(/^\s*/) || [''])[0].length < indent) break;
    body.push(l.slice(indent));
  }
  const shell = body.join('\n');
  assert.ok(/GITHUB_STEP_SUMMARY/.test(shell) && /exit 1/.test(shell),
    '판정 셸을 제대로 못 오려 냈습니다 — 이 칸은 아무것도 안 잽니다');

  const run = (J, S) => {
    const r = spawnSync('bash', ['-c', shell], {
      encoding: 'utf8',
      env: { ...process.env, J, S, GITHUB_STEP_SUMMARY: '/dev/null' },
    });
    return { code: r.status, out: String(r.stdout || '') };
  };

  /* ① 둘 다 성공 → 초록 */
  const ok = run('success', 'success');
  assert.strictEqual(ok.code, 0, `둘 다 성공인데 빨갛습니다: ${ok.out}`);
  assert.match(ok.out, /전부 받았다/, '전부 받은 것을 그렇게 안 적습니다');

  /* ② 한쪽 실패 → 빨강 + «어느 것»인지 적는다 */
  const half = run('failure', 'success');
  assert.strictEqual(half.code, 1, '한쪽이 실패했는데 초록입니다 — 이것이 이 칸을 둔 까닭입니다');
  assert.match(half.out, /지가지수/, '실패한 갈래의 이름을 안 적습니다');
  assert.ok(!/법령·한국은행 — \*\*못/.test(half.out), '멀쩡한 갈래를 실패로 적습니다');

  /* ③ 둘 다 실패 → 빨강 */
  assert.strictEqual(run('failure', 'failure').code, 1, '둘 다 실패인데 초록입니다');

  /* ④ 안 돌았다(skipped)·못 쟀다(빈 값) → «초록으로 안 끝낸다» (§8) */
  assert.strictEqual(run('skipped', 'success').code, 1, '안 돈 단계를 통과로 셉니다');
  const unknown = run('', '');
  assert.strictEqual(unknown.code, 1, '못 잰 것을 통과로 셉니다 (§8)');
  assert.match(unknown.out, /못 쟀다/, '못 잰 것을 「못 쟀다」로 안 적습니다');

  /* ★ 그리고 스스로 처방을 안 적는다 — 무엇이 막았는지는 요약이 말한다 (§12-19) */
  assert.ok(!/열쇠를 다시|콘솔|활용신청/.test(half.out),
    '판정 단계가 스스로 처방을 적습니다 — 무엇이 막았든 같은 곳을 가리키게 됩니다 (§12-19)');
});

/* ★★★ **세는 범위를 「이 둘」에서 「워크플로가 부르는 전부」로 넓힌다** 〈2026-09-19 · D-226〉.
   [무엇이 났나] 이 칸은 이름 둘을 **손으로 박아** 두고 있었다. 그런데 실측으로
     `scripts/` 의 **넷**(market-fetch · market-wonju · bldrgst-fetch · yeoui893-fetch)이
     **무엇이 막았든 늘 0 으로 끝나거나 판정을 요약 맨 끝에만** 적고 있었다 —
     그 넷은 이 칸이 **한 번도 안 봤다.**
   ★ 잣대는 그대로다 — **「그 숫자를 재는 법이 재려는 것을 다 덮는가」**
     (§6-2-6 의 46 → 105 · §8 의 쪼개기 래칫과 **같은 규칙**).
   ★★ **목록을 손으로 적지 않는다** — 워크플로가 실제로 부르는 것을 읽는다.
     새 수집 스크립트가 생기는 날 **자동으로 걸린다** (§8-1).
   ★★★ **예외는 「이름과 사유」로 적는다** (§12-33 과 같은 잣대). 이름을 적는 것은
     약하게 고치는 것이 아니다 — **새로 그런 스크립트가 생기면 여전히 빨개진다.**
     그리고 **죽은 이름으로 남지 않게** 함께 센다. */
const VERDICT_EXEMPT = {
  'dart-fetch.mjs':
    '조회 자체가 실패하면 getBuf 가 던져 그 자리에서 0 이 아닌 값으로 끝난다. '
    + '그리고 「그 상호가 DART 에 없다」는 서버가 대답한 것이라 실패가 아니다 (§4 의 셋째 갈래).',
  'sacheon-law-fetch.mjs':
    '「전량 빈 응답」과 「베이스 경로 없음」에서 이미 1 로 끝난다.',
};

test('★ 워크플로가 부르는 수집 스크립트가 «전부» 갈래를 되돌아오는 값으로 낸다 (0 전부 · 1 일부 · 2 하나도)', () => {
  /* 워크플로가 실제로 부르는 scripts 의 .mjs 를 모은다 — 주석은 떼고 본다 (§8) */
  const wfDir = path.join(ROOT, '.github', 'workflows');
  const called = new Set();
  for (const f of fs.readdirSync(wfDir).filter((x) => /\.ya?ml$/.test(x))) {
    const y = yamlNoComment(read(path.join(wfDir, f)));
    for (const m of y.matchAll(/\bnode\s+scripts\/([\w.-]+\.mjs)/g)) called.add(m[1]);
  }
  assert.ok(called.size >= 5,
    `워크플로가 부르는 수집 스크립트를 못 읽었습니다 (${called.size}개) — 이 칸은 아무것도 안 잽니다`);

  /* ★ 예외가 «죽은 이름»으로 남지 않게 센다 */
  for (const name of Object.keys(VERDICT_EXEMPT)) {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', name)),
      `예외 목록의 ${name} 이 이제 없습니다 — 죽은 이름은 지웁니다.`);
  }

  const missing = [];
  for (const f of [...called].sort()) {
    if (VERDICT_EXEMPT[f]) continue;
    const src = read(path.join(ROOT, 'scripts', f))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const at = src.lastIndexOf('process.exit(');
    if (at < 0) { missing.push(`${f} — 되돌아오는 값을 아예 안 냅니다`); continue; }
    /* ★★★ **「되돌아오는 값이 있다」와 「그 값이 잰 값이다」는 다른 사실이다**
       〈사보타주에서 실제로 빠져나간 자리〉. 판정을 통째로 지워도 «열쇠 없음» 가드의
       `process.exit(1)` 이 남아 통과했다. **마지막 exit 의 인자가 «계산된 값»인지** 본다 —
       숫자를 박아 둔 것은 갈래를 세어 낸 값이 아니다. */
    if (!/process\.exit\(\s*[A-Za-z_$]/.test(src.slice(at))) {
      missing.push(`${f} — 마지막 되돌아오는 값이 박아 둔 숫자입니다 (갈래를 세어 낸 값이 아닙니다)`);
      continue;
    }
    /* 판정은 **마지막**에 온다 — 결과 파일을 먼저 남긴 뒤에 빨갛게 끝낸다 (§12-24) */
    const tail = src.slice(at - 900);
    /* ★★★ **같은 폴더의 공용 창구까지 함께 본다** 〈2026-09-20 · D-247 · 실측〉.
       [무엇이 났나] 진단 둘이 `probe-lib.mjs` 한 벌을 쓰게 되면서 `verdictOf`(갈래 0·2·3·4·5)가
       그 파일로 **옮겨 갔다.** 그러자 이 칸이 **routing-probe 까지** 「갈래 2 가 안 보인다」로
       읽었다 — **기능은 그대로인데 세는 범위가 안 따라간 것**이다.
       ★ 잣대는 하나다 — 「그 숫자를 **재는 법**이 재려는 것을 다 덮는가」
         (§8 의 쪼개기 래칫 · §6-2-6 의 46 → 105 와 **같은 규칙**).
       ★★ **약하게 고치는 것이 아니다** — 갈래를 공용 창구에서 지우면 **그 자리에서 빨개진다**
         (사보타주로 확인했다). 넓힌 것은 **어디를 보는가**이지 **무엇을 재는가**가 아니다. */
    const libs = [];
    for (const m of src.matchAll(/from\s+'\.\/([\w.-]+\.mjs)'/g)) {
      const lp = path.join(ROOT, 'scripts', m[1]);
      if (fs.existsSync(lp)) {
        libs.push(read(lp).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, ''));
      } else {
        /* ★ 못 읽으면 「못 쟀다」로 적는다 — 조용히 넘기면 그 자리가 통과로 읽힌다 (§8) */
        missing.push(`${f} — 공용 창구 ${m[1]} 를 못 읽었습니다 (이 칸이 그만큼 눈이 멉니다)`);
      }
    }
    if (!/\b2\b/.test(tail + '\n' + libs.join('\n'))) { missing.push(`${f} — 「하나도 못 받음(2)」 갈래가 안 보입니다`); continue; }
    /* 판정 글이 요약 «앞쪽»에 간다 — 맨 끝에 적으면 아무도 안 본다 (§6-3 ①).
       ★ 부르는 이름을 박지 않는다 — log.unshift() 와 log.splice(4,0,…) 는 **같은 성질**이다.
         이름으로 세면 뒤엣것이 옳은데도 빨개지고, 그때 「검사를 약하게 고칠까」가 된다
         (§6-2-5 의 잣대). */
    const front = /log\.unshift\(/.test(src)
      || [...src.matchAll(/log\.splice\(\s*(\d+)\s*,\s*0\s*,/g)].some((m) => Number(m[1]) < 10);
    if (!front) { missing.push(`${f} — 판정을 요약 앞쪽에 안 올립니다`); continue; }
    /* 판정을 «프로세스 밖으로도» 낸다 — 워크플로가 stdout 만 받아 가는 자리도
       stderr 만 받아 가는 자리도 있다 (§12-19). 어느 쪽인지는 그 워크플로가 정한다. */
    if (!/console\.(log|error)\(/.test(tail)) { missing.push(`${f} — 판정을 밖으로 안 냅니다 (§12-19)`); continue; }
  }
  assert.deepStrictEqual(missing, [],
    '무엇이 막았든 «늘 초록»으로 끝나는 수집 스크립트가 남았습니다 — '
    + '초록이라 아무도 요약을 안 열어 보고, 정작 하려던 수집은 한 번도 안 된 채로 남습니다 (§12-24):\n  '
    + missing.join('\n  '));
});

/* ------------------------------------------------------------------------- *
 * **커넥터가 갈라 준 것을 «읽어» 적는가** 〈2026-09-19 · D-226 · §12-19〉
 *
 * [무엇이 났나] `law.js` 는 실패를 **못 닿음·승인·OC·없음·형식** 다섯으로 갈라
 *   `kind`·`head`·`bodyHead`·`headHdr` 로 돌려준다. 그런데 이 스크립트는
 *   **`error` 한 칸만** 찍고 나머지를 버렸다 — 요약에 남는 글은
 *   「찾지 못함 — fetch failed (4회 시도 실패)」 하나뿐이었다.
 *   **간헐적 못 닿음**과 **OC 오타**가 같은 글자로 보이는데 할 일은 정반대다.
 *
 * ★ **나르는 자리는 셋이다** — 커넥터가 실어도 여기서 안 읽으면 사라지고,
 *   읽어도 요약에 안 적으면 또 사라진다. 「만들었다」와 「닿는다」는 다른 사실이다 (§8).
 * ★★ **베끼지 않고 오려 내 돌린다** (§12-24 에서 사보타주 둘이 빠져나간 자리).
 *   「`why` 라는 낱말이 있는가」는 이름만 바꿔 끼워도 통과하는, 아무것도 안 재는 검사다.
 * ------------------------------------------------------------------------- */

/** 소스에서 `function 이름(...) { … }` 을 **중괄호 짝을 세어** 오려 낸다 (꼬리 글자로 찾지 않는다 · §12-6) */
function cutFn(src, name) {
  const at = src.search(new RegExp(`^function\\s+${name}\\s*\\(`, 'm'));
  if (at < 0) return null;
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}

test('★★★ 실패 사유를 «갈래까지» 적는다 — 소스에서 오려 내 돌린다 (D-226)', () => {
  const src = read(path.join(ROOT, 'scripts', 'yeoui893-sources.mjs'));
  const why = cutFn(src, 'why');
  const fail2 = cutFn(src, 'fail2');
  assert.ok(why && fail2,
    'why()/fail2() 를 못 오려 냈습니다 — 이 칸은 아무것도 안 잽니다 '
    + `(why=${Boolean(why)} · fail2=${Boolean(fail2)})`);

  const make = () => new Function(`const kinds = [];\n${why}\n${fail2}\nreturn { kinds, why, fail2 };`)();

  /* ① 커넥터가 갈라 준 것을 버리지 않는가 */
  const m = make();
  const line = m.why({
    ok: false, error: 'HTTP 403 (재시도 무의미)', kind: 'approval',
    head: '이용 승인이 아직 안 났다 — OC 값 문제가 아니다',
    httpStatus: 403, bodyHead: '미승인 사용자', headHdr: 'server: nginx',
  });
  assert.ok(/승인/.test(line), '사람 말로 된 사유(head)를 버립니다 — 갈래가 한 글자로 뭉개집니다.');
  assert.ok(/403/.test(line), '상태코드를 버립니다 — 401 인지 403 인지조차 안 남습니다.');
  assert.ok(/미승인 사용자/.test(line), '응답 본문을 버립니다 — 가릴 재료가 사라집니다 (D-219).');
  assert.ok(/nginx/.test(line), '헤더를 버립니다 — 「그쪽 게이트웨이인가」를 못 가립니다.');

  /* ② 전부 못 닿았으면 «열쇠를 보러 가시게» 하지 않는다 (M-86) */
  const un = make();
  un.why({ ok: false, kind: 'unreachable', head: '서버에 못 닿았다 (fetch failed)' });
  un.why({ ok: false, kind: 'unreachable', head: '서버에 못 닿았다 (타임아웃 15000ms)' });
  const t1 = un.fail2();
  /* ★★★ **낱말이 아니라 「시키는가」를 잰다** (§4.6 의 그 잣대 · 실제로 여기서 걸렸다).
     좋은 글은 「열쇠·활용 승인 문제가 **아니다**」라고 **부정으로** 쓴다 — 「열쇠」라는
     낱말만 세면 그 좋은 글이 빨개지고, 그때 「검사를 약하게 고칠까」가 된다.
     재려던 성질(**틀린 곳을 가리키는가**)은 그대로 두고 **세는 자리를 옮겼다**. */
  assert.ok(/못 닿/.test(t1), '못 닿았다는 사실을 안 적습니다.');
  assert.ok(/문제가 아니다|아니다/.test(t1),
    `전부 못 닿았는데 열쇠·승인을 「아니다」로 «부정»하지 않습니다 (M-86): ${t1}`);
  assert.ok(!/중 하나다/.test(t1),
    `전부 못 닿았는데 「열쇠·승인·그쪽 서버 중 하나다」를 그대로 적습니다 — 고칠 것이 없는 자리를 보러 가시게 됩니다: ${t1}`);

  /* ★ 반대로도 막는다 — 갈래가 섞이거나 없으면 여전히 열쇠·승인을 가리킨다 */
  const mix = make();
  mix.why({ ok: false, kind: 'unreachable', head: 'x' });
  mix.why({ ok: false, kind: 'oc', head: 'y' });
  assert.ok(/못 닿/.test(mix.fail2()) && /사유가 다르다|갈래별/.test(mix.fail2()),
    '섞인 것을 「전부 못 닿았다」나 「전부 열쇠 문제」로 뭉갭니다.');
  const none = make();
  none.why({ ok: false, kind: 'oc', head: 'y' });
  assert.ok(/중 하나다/.test(none.fail2()),
    '못 닿음이 «아닌» 실패인데도 열쇠·승인을 안 가리킵니다 — 반대쪽 갈래가 사라졌습니다.');

  /* ★★ 실패를 «빠짐없이» 세는가 — 한 건이라도 안 세면 위 ②가 거짓을 말한다 */
  const cnt = make();
  cnt.why({ ok: false, kind: 'unreachable', head: 'x' });
  cnt.why({ ok: false, error: '키 없음', unavailable: true });   // 갈래를 모르는 실패
  assert.strictEqual(cnt.kinds.length, 2,
    '갈래가 없는 실패를 안 셉니다 — 그러면 「전부 못 닿았다」가 거짓이 됩니다.');
  assert.ok(!/전부/.test(cnt.fail2()),
    '한 건이 갈래를 모르는 실패인데 「전부 못 닿았다」로 적습니다.');
});

test('★ 그 사유가 «요약까지» 간다 — 읽어 놓고 안 적으면 안 읽은 것과 같다 (§12-19)', () => {
  const src = read(path.join(ROOT, 'scripts', 'yeoui893-sources.mjs'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const calls = (src.match(/\bwhy\(/g) || []).length - 1;   // 정의 한 줄은 뺀다
  assert.ok(calls >= 3,
    `실패를 찍는 자리가 why() 를 안 지나갑니다 (${calls}곳) — 한 곳이라도 우회하면 `
    + '그 갈래만 옛 글자로 남습니다 (§12-4 「우회하는 곳 0인가」와 같은 잣대).');
  assert.ok(!/\$\{(?:f|a|r)\.error\}/.test(src),
    '아직 `error` 한 칸만 찍는 자리가 남았습니다 — 갈래가 거기서 사라집니다.');

  /* ★★★ **「함수가 있다」와 「판정이 그것을 부른다」는 다른 사실이다** 〈사보타주에서
     실제로 빠져나간 자리〉. fail2() 를 떼어 내 돌리는 칸은 그 함수가 **쓰이지 않아도**
     초록이다 — 판정 글을 옛 글자로 되돌려도 안 잡혔다. 그러니 **부르는 자리**까지 센다
     (§12-16 「세는 자리가 붙어 있는가」와 같은 잣대). */
  const at2 = src.indexOf('판정 2');
  assert.ok(at2 >= 0 && /fail2\(\)/.test(src.slice(at2, at2 + 200)),
    '「한 가지도 못 받았다」 글이 fail2() 를 안 부릅니다 — 갈래를 세어 놓고 안 씁니다.');
});
