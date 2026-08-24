'use strict';
/**
 * env-doctor.js — **열쇠 파일이 왜 안 읽히는지 사람 말로 말한다** 〈2026-08-23〉.
 *
 *   node im-agent/tools/env-doctor.js          (엔진 루트에서)
 *   npm run im:env-doctor
 *
 * ★★★ 왜 만들었나. 2026-08-23, 사장님이 NAS 엔진 루트에 `linkpilot.env` 를
 *   제대로 놓으셨는데 배포 확인은 여전히 **「OCR: 꺼짐」**이었다. 그런데
 *   꺼짐이라는 말은 **원인을 하나도 안 말해 준다** — 파일이 없는 것인지,
 *   폴더인 것인지, 서식 문서로 저장된 것인지, 줄 모양이 틀린 것인지,
 *   따옴표가 섞인 것인지 전부 같은 「꺼짐」이다.
 *
 *   ★ 이 저장소에서 오늘만 세 번 같은 결의 사고가 났다 — **재는 장치는
 *     만들었는데 재고 나서 「그래서 왜」를 안 말했다.** 그때마다 사람이
 *     다시 손으로 뒤졌다.
 *
 * ★★ **값은 한 글자도 안 찍는다** (CLAUDE.md §2). 찍는 것은 이것뿐이다:
 *      - 이름이 있는가 · 파일인가 폴더인가 · 몇 바이트인가
 *      - 서식 문서(RTF)인가 · BOM 이 붙었는가 · 줄끝이 CRLF 인가
 *      - **파일 자체의 지문** (열쇠가 아니라 파일의 것 — 「바뀌긴 했나」를 잰다)
 *      - **파싱된 키 이름** (env.js 가 이미 이름만 돌려준다)
 *      - GEMINI_API_KEY 의 **길이와 앞머리가 아는 모양인지** (`KEY_SHAPES`)
 *   길이와 앞머리만으로 「따옴표가 섞였다 / 자리표시자가 그대로다 / 빈 값이다」
 *   가 갈린다. 그러면서 열쇠 자체는 로그에 안 남는다.
 *
 * ★ 되돌아오는 값은 늘 0 이다. **진단이 배포를 죽이면 안 된다.**
 *
 * ★★★ `--live` 를 주면 **열쇠가 실제로 살아 있는지 한 번 물어본다**
 *   〈2026-08-23 · 마지막으로 남은 구멍이었다〉.
 *
 *   지금까지 「OCR 켜짐」은 **글자가 들어 있다**는 뜻일 뿐이었다. 폐기된
 *   열쇠·지워진 프로젝트의 열쇠도 똑같이 「켜짐」으로 나온다 — 그러면
 *   자료를 올리는 그 순간에야 실패하고, 화면에는 「못 읽었습니다」만 남는다.
 *   **재는 장치가 아무것도 안 재는** 그 결이다 (M-11 · M-12 · M-30).
 *
 *   ★ 그래서 아주 작은 요청을 한 번 던져 본다. 실패하면 **왜 실패했는지**를
 *     사람 말로 적는다 — 401/403(열쇠가 죽었다)과 그물이 안 닿는 것을 가른다.
 *   ★ 못 물어본 것을 **죽은 것으로 세지 않는다.** 그물이 막혀 있을 수 있다.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../core/env.js');

const say = (s) => process.stdout.write(s + '\n');

/** 구글이 실제로 내주는 열쇠 앞머리들. 새 모양이 나오면 여기에 더한다 */
const KEY_SHAPES = ['AIza', 'AQ.'];

/** 사람이 읽는 한 줄 진단. 값은 안 담는다 */
function inspect(file) {
  const out = { file, kind: '없다' };
  let st;
  try { st = fs.statSync(file); } catch (_) { return out; }
  if (st.isDirectory()) { out.kind = '폴더'; return out; }
  if (!st.isFile()) { out.kind = '파일이 아니다'; return out; }

  out.kind = '파일';
  out.bytes = st.size;

  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { out.readError = String(e.code || e.message); return out; }

  out.bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const head = buf.slice(0, 6).toString('latin1');
  out.rtf = head.startsWith('{\\rtf');
  /* ★ 워드·페이지스로 저장하면 zip 이다 — 이것도 「서식 문서」로 묶어 말한다 */
  out.zip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4B;
  out.crlf = buf.indexOf('\r\n') !== -1;
  /* ★★★ **파일이 바뀌긴 했는지**를 말한다 〈2026-08-23 · 두 번 헛돌았다〉.
   *   「고쳤습니다」라고 하셨는데 로그가 똑같은 말을 되풀이했다. 그때
   *   「안 고치신 것」과 「고쳤는데 안 올라간 것」이 구분이 안 됐다 —
   *   File Station 의 [업로드 - 건너뛰기] 는 **있던 파일을 그대로 둔다.**
   * ★ 파일 자체의 지문을 적으면 지난번과 대 보고 **한 번에 갈린다.**
   *   열쇠가 아니라 **파일**의 지문이므로 값이 새지 않는다 (§2). */
  out.sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);

  const text = buf.toString('utf8');
  const lines = text.split(/\r?\n/);
  out.lines = lines.length;
  out.parsed = lines.map(env.parseLine).filter(Boolean).map((kv) => kv.key);
  out.unparsed = lines.filter((l) => l.trim() && !l.trim().startsWith('#') && !env.parseLine(l)).length;
  return out;
}

function describe(i) {
  if (i.kind === '없다') return `${path.basename(i.file)} — 없다`;
  if (i.kind === '폴더') {
    return `${path.basename(i.file)} — **폴더다.** 파일이어야 한다 (File Station 의 [생성] 은 폴더만 만든다)`;
  }
  if (i.readError) return `${path.basename(i.file)} — 못 읽는다 (${i.readError}) · 권한을 본다`;

  const bits = [`${i.bytes}바이트`, `${i.lines}줄`, `파일지문 ${i.sha}`];
  if (i.rtf) bits.push('**서식 문서(RTF)** — 텍스트 편집기에서 [포맷] → [일반 텍스트로 만들기] 를 안 눌렀다');
  if (i.zip) bits.push('**워드/페이지스 문서** — 일반 텍스트가 아니다');
  if (i.bom) bits.push('BOM 이 붙었다 (우리 파서는 떼고 읽는다 — 지장 없다)');
  if (i.crlf) bits.push('줄끝이 CRLF (읽는 데는 지장 없다)');
  bits.push(i.parsed.length ? `읽힌 키: ${i.parsed.join(', ')}` : '**읽힌 키가 없다**');
  if (i.unparsed) bits.push(`못 읽은 줄 ${i.unparsed}개 (KEY=값 모양이 아니다)`);
  return `${path.basename(i.file)} — ${bits.join(' · ')}`;
}

function main() {
  const root = env.repoRoot();
  say(`열쇠 파일을 찾는 곳: ${root}`);
  say('');

  const seen = env.NAMES.map((n) => inspect(path.join(root, n)));
  seen.forEach((i) => say('  ' + describe(i)));
  say('');

  const chosen = env.pick(root);
  const r = env.load(chosen);
  say(`실제로 읽은 파일: ${r.exists ? chosen : '(없다 — ' + chosen + ' 자리에 있어야 한다)'}`);

  const key = process.env.GEMINI_API_KEY || '';
  if (!key) {
    say('GEMINI_API_KEY: **비어 있다** → OCR 은 꺼진 채로 돈다');
  } else {
    const marks = [`길이 ${key.length}`];
    /* ★★ **열쇠 모양은 하나가 아니다** 〈2026-08-23 · 하마터면 멀쩡한 열쇠를
     *   틀렸다고 할 뻔했다〉. 구글 AI 스튜디오는 예전 `AIza…` 말고 `AQ.…` 로
     *   시작하는 열쇠도 준다. 아는 모양이 아니라고 **틀렸다고 단정하지 않는다**
     *   (§4.9) — 모르는 것은 모른다고만 적는다. */
    const shape = KEY_SHAPES.find((k) => key.slice(0, k.length) === k);
    marks.push(shape ? `${shape}… 로 시작 (아는 모양)` : '앞머리가 아는 모양이 아니다 (틀렸다는 뜻은 아니다)');
    if (/^["']|["']$/.test(key)) marks.push('**따옴표가 값에 섞였다**');
    if (/\s/.test(key)) marks.push('**빈칸·줄바꿈이 값에 섞였다**');
    /* ★ 「xxx」 하나로 잡으면 진짜 열쇠에 그 세 글자가 들어 있을 때 멀쩡한 것을
     *   틀렸다고 한다. 안내문에 실제로 쓰는 말만 본다 */
    if (/여기에|붙여넣|YOUR_|_HERE/i.test(key)) marks.push('**자리표시자가 그대로 들어 있다**');
    say(`GEMINI_API_KEY: ${marks.join(' · ')}`);
  }

  /* ★ 강제 오프라인이 켜져 있으면 열쇠가 멀쩡해도 꺼진다. 이것을 안 보면
   *   「열쇠는 맞는데 왜 꺼졌지」로 몇 시간을 쓴다 */
  if (process.env.IM_AGENT_OFFLINE === '1') {
    say('IM_AGENT_OFFLINE=1 — **열쇠와 무관하게 강제로 꺼져 있다.** 기동 스크립트를 본다');
  }

  let offline = null;
  try { offline = require('../core/llm.js').isOffline(); } catch (_) { /* 진단이 죽으면 안 된다 */ }
  if (offline !== null) {
    say(`엔진이 보는 상태: ${offline ? 'OCR 꺼짐' : 'OCR 켜짐 (열쇠가 들어 있다는 뜻이다)'}`);
  }
  return { offline, hasKey: !!key };
}

/**
 * **열쇠가 어느 것이 들어 있고 어느 것이 비어 있는지** 한 눈에 적는다
 * 〈2026-08-24 · 지적도가 안 켜지는데 볼 곳이 없었다〉.
 *
 *   node im-agent/tools/env-doctor.js --keys
 *
 * ★★ **값은 한 글자도 안 찍는다** (§2). 찍는 것은 이름과 길이뿐이다.
 * ★ 「OCR 켜짐」처럼 하나만 재고 있었다. 그런데 안 켜지는 것은 하나가 아니다 —
 *   지적도·공시지가가 없으면 매스가 직사각형으로 서고 조감도가 아예 안 나온다.
 *   **재는 곳이 없으면 「왜 안 나오지」가 그때마다 처음 보는 문제가 된다.**
 * ★ `VWORLD_DOMAIN` 은 **주소라서 길이만으로도 실수가 보인다** — 스킴·경로를
 *   벗기면 ned 계열이 간헐적으로 거부한다 (CLAUDE.md §4.1).
 */
function keys() {
  const { SECRET_ENV } = require('../connectors/http.js');
  const root = env.repoRoot();
  env.load(env.pick(root));

  say(`열쇠 파일을 찾는 곳: ${root}`);
  say('');
  const on = [];
  const off = [];
  SECRET_ENV.forEach((n) => {
    const v = process.env[n] || '';
    if (v) { on.push(`${n}(${v.length}자)`); } else { off.push(n); }
  });
  say(`들어 있다: ${on.length ? on.join(' · ') : '(하나도 없다)'}`);
  say(`비어 있다: ${off.length ? off.join(' · ') : '(없다)'}`);
  say('');

  /* ★ 이름이 있는 것과 **그 기능이 켜진 것**은 다른 사실이다.
   *   커넥터 자신에게 묻는다 — 그쪽이 무엇을 요구하는지 아는 것은 그쪽이다. */
  const ask = (mod, label) => {
    try {
      const m = require(`../connectors/${mod}.js`);
      say(`${label}: ${m.isAvailable() ? '켜짐' : '**꺼짐**'}`);
    } catch (e) {
      say(`${label}: 못 쟀다 (${e.message})`);
    }
  };
  ask('vworld', '지적·위성지도(VWorld)');
  ask('nsdi', '공시지가·용도지역(VWorld NED)');

  const d = (process.env.VWORLD_DOMAIN || '').trim();
  if (!d) {
    say('VWORLD_DOMAIN: **비어 있다** — ned 계열이 간헐적으로 거부한다 (§4.1)');
  } else if (!/^https?:\/\//.test(d)) {
    say('VWORLD_DOMAIN: **스킴(https://)이 없다** — 콘솔의 서비스URL 을 글자 그대로 넣는다');
  } else {
    say(`VWORLD_DOMAIN: 모양은 맞다 (${d.length}자)`);
  }
  return { on: on.length, off: off.length };
}

/**
 * 열쇠가 **실제로 받아들여지는지** 한 번 물어본다. 값은 안 찍는다.
 *
 * ★ 가장 가벼운 요청을 쓴다 — 모델 목록. 생성 요청은 돈과 시간이 든다.
 * ★ 10초 안에 답이 없으면 **「못 물어봤다」**로 끝낸다. 진단이 배포를 붙잡으면
 *   안 되고, 못 물어본 것은 죽은 것과 **다른 사실**이다.
 */
async function live() {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key) { say('열쇠 확인: 안 해 봤다 — 열쇠가 비어 있다'); return; }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': key }, signal: ctl.signal,
    });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      const n = Array.isArray(j && j.models) ? j.models.length : null;
      say(`열쇠 확인: **살아 있다** — 구글이 받아들였다${n === null ? '' : ` (모델 ${n}개 보인다)`}`);
      return;
    }
    /* ★ 본문에 이유가 들어 있다. 상태코드만 보면 「열쇠가 죽었다」와
     *   「그 API 를 안 켰다」가 같아 보인다 (§4.2 와 같은 결) */
    const t = (await r.text().catch(() => '')).slice(0, 300);
    const why = /API_KEY_INVALID|API key not valid/i.test(t) ? '**열쇠가 유효하지 않다** — 새로 만들어야 한다'
      : /SERVICE_DISABLED|has not been used|is disabled/i.test(t) ? '**그 프로젝트에서 Generative Language API 가 꺼져 있다**'
        : /PERMISSION_DENIED/i.test(t) ? '**권한이 없다** — 열쇠가 다른 프로젝트 것이거나 제한이 걸려 있다'
          : /quota|RESOURCE_EXHAUSTED/i.test(t) ? '**한도를 넘었다** — 열쇠 자체는 살아 있다'
            : `HTTP ${r.status}`;
    say(`열쇠 확인: **거절당했다** — ${why}`);
  } catch (e) {
    /* ★ 못 물어본 것을 죽은 것으로 세지 않는다 */
    say(`열쇠 확인: **못 물어봤다** — ${e && e.name === 'AbortError' ? '10초 안에 답이 없다' : '그물이 안 닿는다'}. `
      + '열쇠가 죽었다는 뜻이 **아니다**');
  } finally {
    clearTimeout(timer);
  }
}

if (require.main === module) {
  if (process.argv.includes('--keys')) {
    keys();
  } else {
    const r = main();
    /* ★ `--live` 일 때만 그물을 탄다. 기본은 파일만 본다 — 빠르고 조용하다 */
    if (process.argv.includes('--live') && r && r.hasKey) live();
  }
}
module.exports = { inspect, describe, live, keys };
