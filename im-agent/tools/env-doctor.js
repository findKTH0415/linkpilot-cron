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
  if (offline !== null) say(`엔진이 보는 상태: ${offline ? 'OCR 꺼짐' : 'OCR 켜짐'}`);
}

if (require.main === module) main();
module.exports = { inspect, describe };
