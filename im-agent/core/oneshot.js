'use strict';
/**
 * oneshot.js — **한 번 읽고 버리는** 직접 업로드 〈2026-08-17 결정〉.
 *
 * 왜 필요한가:
 *   자료를 연결해서 쓰기로 했는데(`core/linked.js`), **저장소를 안 쓰는 사람은
 *   자료를 넣을 방법이 없어진다.** 그 길을 남기되 **보관은 하지 않는다** —
 *   받아서 읽고 지문만 남기고 파일은 버린다.
 *
 * ★★ 연결과 **위험이 다르다. 이쪽이 더 나쁘다.**
 *   연결된 자료는 원본이 사용자 저장소에 남아 있어 나중에 다시 읽고 대조할 수
 *   있다. 1회성은 **우리도 원본을 안 갖고, 어디 있는지도 모른다.**
 *   지문은 남지만 **대조할 상대가 없다** — 「이 숫자 어디서 나왔나」에
 *   「그날 올라온 이 이름의 파일」까지만 답할 수 있다.
 *   그래서 출처에 **그 사실을 박는다** (`citation()`).
 *
 * ★ 지문이 남는데도 대조를 못 하는 것을 **「대조했다」로 읽히게 두지 않는다.**
 *   `verify()` 를 만들지 않고 `cannotVerify()` 로 **거절한다** —
 *   함수가 없으면 「아직 안 붙였나 보다」로 읽히고 누군가 만들어 넣는다.
 *
 * ★ 파일 수명: 받은 버퍼를 **메모리에서 읽고**, 임시 폴더에 쓴 뒤
 *   `dispose()` 로 지운다. `linked.materialize()` 와 같은 모양이라
 *   호출부가 둘을 같은 방식으로 다룬다.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { kstStamp } = require('./kst');
const vault = require('./vault');
const storage = require('../connectors/storage');

const LEDGER = '01_Project/oneshot.json';
const LOG = '01_Project/oneshot-log.jsonl';
const LEDGER_VERSION = 1;

/** 이 경로로 들어온 자료의 출처 표시. 연결 자료와 **한눈에 갈려야** 한다 */
const KIND = 'oneshot';

function ledgerPath(projectDir) { return path.join(projectDir, LEDGER); }

function read(projectDir) {
  const full = ledgerPath(projectDir);
  if (!fs.existsSync(full)) return { version: LEDGER_VERSION, items: [] };
  try {
    const v = JSON.parse(fs.readFileSync(full, 'utf8'));
    return { version: v.version || LEDGER_VERSION, items: Array.isArray(v.items) ? v.items : [] };
  } catch (_) {
    // 깨졌다고 덮어쓰지 않는다 — 원본이 우리에게도 사용자에게도 없을 수 있어
    // 이 장부가 **그 자료가 있었다는 유일한 기록**이다
    return { version: LEDGER_VERSION, items: [] };
  }
}

function write(projectDir, ledger) {
  const dir = path.join(projectDir, '01_Project');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.oneshot-${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ledgerPath(projectDir));
}

function log(projectDir, entry) {
  try {
    fs.mkdirSync(path.join(projectDir, '01_Project'), { recursive: true });
    fs.appendFileSync(path.join(projectDir, LOG),
      JSON.stringify({ at: kstStamp(), ...entry }) + '\n', { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (_) { return false; }
}

/* ────────────────────────── 같은 자료 겹치기 ────────────────────────── */

/**
 * ★★★ **같은 파일을 다시 올리면 줄이 하나 더 생겼다** 〈2026-08-23 사장님:
 *   「중복파일 쌓이는 문제 해결해줘」〉.
 *
 *   OCR 이 꺼져 있던 동안 사장님이 같은 자료를 여러 번 올려 보셨다. 그때마다
 *   장부에 줄이 하나씩 붙어 **같은 이름이 여덟 줄**이 되었다. 화면은 그것을
 *   「같은 이름의 자료가 여덟 개」로 보여 주었고, **고를 것이 없는데 고르라는
 *   말**이 되었다.
 *
 * ★ 지문(sha256)이 같으면 **같은 파일이다** — 판이 둘인 것이 아니다.
 *   그러니 한 줄로 접되, **몇 번 올렸는지·처음이 언제였는지는 남긴다.**
 *   접는 것과 지우는 것은 다르다 (§4.9 — 대체값으로 메우지 않는다).
 *
 * ★ 지문이 **다르면 안 접는다.** 이름만 같고 내용이 다른 것은 진짜 판 충돌이고,
 *   그것을 접으면 틀린 판으로 보고서를 만들게 된다 — 이 장부가 막으려던 바로 그 일이다.
 * ★ 지문이 **없으면 안 접는다.** 같은지 알 수 없는 것을 같다고 하지 않는다.
 * ★ 낱낱의 업로드 시각은 `oneshot-log.jsonl` 에 그대로 남는다. 여기서 접어도
 *   **일어난 일의 기록이 사라지지는 않는다.**
 *
 * ★★ **이름이 아니라 지문으로 가른다** 〈같은 날 · 실제 화면에서 그랬다〉.
 *
 *   사장님 화면에 `…인세티브(1).png` 와 `…인세티브(2).png` 가 번갈아 여덟 줄
 *   있었다. **맥이 같은 파일을 두 번 내려받으면서 붙인 번호**였고 내용은 같은
 *   파일이다. 이름으로 가르면 이 둘이 「판이 둘」로 남아, **고를 것이 없는데
 *   고르라는 말**이 그대로 남는다.
 *
 * ★ 지문이 같으면 바이트가 같다 — 이름이 달라도 같은 파일이다.
 *   다른 이름은 버리지 않고 `alsoNamed` 로 함께 남긴다.
 */

/** 접는 기준. **지문뿐이다** — 지문이 없으면 `null` 을 돌려 안 접게 한다 */
function keyOf(item) {
  const fp = item && item.fingerprint && item.fingerprint.value;
  if (!fp) return null;
  return String(fp);
}

/** 같은 지문을 한 줄로 접는다. **처음 나온 자리를 지킨다** */
function mergeItems(items) {
  const out = [];
  const at = new Map();
  (Array.isArray(items) ? items : []).forEach((it) => {
    if (!it || typeof it !== 'object') return;
    const k = keyOf(it);
    if (k === null) { out.push(it); return; }   // 지문이 없으면 접지 않는다
    const seen = at.get(k);
    if (seen === undefined) {
      at.set(k, out.length);
      out.push(Object.assign({}, it, {
        times: it.times || 1,
        firstReadAt: it.firstReadAt || it.readAt || null,
        alsoNamed: Array.isArray(it.alsoNamed) ? it.alsoNamed.slice() : [],
      }));
      return;
    }
    const prev = out[seen];
    prev.times += (it.times || 1);
    /* ★ 시각은 `2026-08-23T20:31:00+09:00` 로 폭이 고정이라 글자 비교로 앞뒤가 난다 */
    const last = it.readAt || null;
    if (last && (!prev.readAt || last > prev.readAt)) prev.readAt = last;
    const first = it.firstReadAt || it.readAt || null;
    if (first && (!prev.firstReadAt || first < prev.firstReadAt)) prev.firstReadAt = first;
    if (!prev.by && it.by) prev.by = it.by;
    /* ★ 이름이 다르면 **버리지 않고 함께 적는다.** 맥의 `(1)`·`(2)` 처럼
     *   같은 파일이 다른 이름으로 들어온 것을 나중에도 알 수 있어야 한다 */
    const other = it.original || it.name;
    if (other && other !== (prev.original || prev.name)
        && prev.alsoNamed.indexOf(other) === -1) prev.alsoNamed.push(other);
  });
  return out;
}

/* ────────────────────────── 받기 ────────────────────────── */

/**
 * 파일 여러 개를 받아 **임시 폴더에 두고** 장부에 지문만 남긴다.
 *
 * @param files [{name, buf}]
 * @returns {{ok:true, accepted:[], rejected:[], files:[], dispose:Function, dir:string}}
 *   files 는 `02-extraction` 이 그대로 받는 모양이다 ({name, path, size, ext}).
 *
 * ★ **프로젝트 폴더에 쓰지 않는다.** 거기 쓰면 지우는 것을 잊었을 때 그대로
 *   보관이 되고, 「1회성입니다」가 조용히 거짓이 된다.
 */
function accept(projectDir, files, opts = {}) {
  if (!fs.existsSync(projectDir)) return { ok: false, reason: '프로젝트를 찾을 수 없습니다' };
  if (!Array.isArray(files) || !files.length) return { ok: false, reason: '올릴 파일이 없습니다' };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-oneshot-'));
  const ledger = read(projectDir);
  const accepted = [], rejected = [], out = [];
  // ★ 시각을 밖에서 넣을 수 있게 둔다 (`store.nextProjectId(id, when)` 과 같은 꼴).
  //   제품에서는 아무도 안 넘기고 지금 시각이 찍힌다. **미리보기 빌더만 넘긴다** —
  //   커밋되는 산출물에 「빌드한 날」이 박히면 **자정을 넘기는 순간 재생성 결과가
  //   커밋본과 달라져 CI 가 빨개진다.** 2026-08-18 에 실제로 그렇게 터졌다:
  //   바뀐 줄은 `2026-08-17 읽음` → `2026-08-18 읽음` **한 곳뿐**이었고,
  //   코드를 고친 사람이 아니라 **날짜가 바뀐 것이 원인**이었다.
  const at = opts.at || kstStamp();

  for (const f of files) {
    const raw = String((f && f.name) || '');
    const buf = f && f.buf;
    if (!Buffer.isBuffer(buf) || !buf.length) { rejected.push({ name: raw, reason: '빈 파일입니다' }); continue; }

    const safe = vault.safeName(raw);
    if (!safe.ok) { rejected.push({ name: raw, reason: safe.reason }); continue; }

    let name = safe.name;
    for (let n = 2; fs.existsSync(path.join(dir, name)); n += 1) {
      const ext = path.extname(safe.name);
      name = `${ext ? safe.name.slice(0, -ext.length) : safe.name} (${n})${ext}`;
    }
    const full = path.join(dir, name);
    fs.writeFileSync(full, buf, { mode: 0o600 });

    const fp = storage.fingerprint(buf);
    const item = {
      kind: KIND,
      name, original: raw, bytes: buf.length,
      fingerprint: fp,
      readAt: at,
      by: opts.by || null,
      // ★ 이 한 줄이 이 모듈의 요점이다. 사본이 없고 **가리킬 원본도 없다**
      retainedCopy: false,
      originalLocation: null,
    };
    ledger.items.push(item);
    accepted.push({ name, bytes: buf.length, sha256: fp.value });
    out.push({ name, path: full, size: buf.length, ext: path.extname(name).toLowerCase() });
  }

  /* ★ 접어서 쓴다 — 안 그러면 같은 파일을 올릴 때마다 장부가 자란다.
   *   낱낱의 업로드는 바로 아래 `log()` 가 그대로 남긴다 */
  const before = ledger.items.length;
  ledger.items = mergeItems(ledger.items);
  write(projectDir, ledger);
  log(projectDir, {
    action: 'accept', got: accepted.length, rejected: rejected.length,
    collapsed: before - ledger.items.length, by: opts.by || null,
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return { removed: 0 };
    disposed = true;
    let removed = 0;
    try {
      for (const n of fs.readdirSync(dir)) {
        try { fs.unlinkSync(path.join(dir, n)); removed += 1; } catch (_) { /* 이미 없다 */ }
      }
      fs.rmdirSync(dir);
    } catch (_) { /* 폴더가 이미 없으면 그만이다 */ }
    log(projectDir, { action: 'dispose', removed });
    return { removed };
  };

  return { ok: true, accepted, rejected, files: out, dispose, dir };
}

/** 이 프로젝트에 1회성으로 들어온 자료의 기록. **파일은 없다** */
function list(projectDir) {
  const ledger = read(projectDir);
  /* ★ 읽을 때도 접는다. 그래야 **이미 여덟 줄로 쌓여 있던 장부**도 지금 바로
   *   한 줄로 보인다 — 다음 업로드를 기다리지 않는다 */
  const items = mergeItems(ledger.items);
  return {
    items,
    // 몇 줄을 접었는지 — 화면이 「기록이 여러 벌인 것이 아니다」를 말할 수 있다
    collapsed: ledger.items.length - items.length,
    // 화면이 이 값을 보고 「다시 올려야 합니다」를 띄운다
    reusable: false,
    at: kstStamp(),
  };
}

/* ────────────────────────── 못 하는 것 ────────────────────────── */

/**
 * **대조할 수 없다.** 지문은 있는데 견줄 상대가 없다.
 *
 * 연결 자료는 저장소에 물어보면 되지만, 1회성은 **원본이 어디 있는지조차
 * 모른다.** 여기에 `verify()` 를 만들어 두면 「이상 없음」이 나오고,
 * 그것이 **대조를 통과했다는 뜻으로 읽힌다.**
 */
function cannotVerify() {
  return {
    ok: false,
    byDesign: true,
    reason: '1회성으로 올린 자료는 원본과 대조할 수 없습니다 — 우리도 원본을 갖고 있지 않고 '
      + '어디 있는지도 모릅니다',
    insteadDo: '같은 값을 다시 확인해야 하면 저장소를 연결하거나, 그 파일을 다시 올립니다.',
  };
}

/**
 * **다시 쓸 수 없다.** 보고서를 다시 만들려면 **다시 올려야 한다.**
 *
 * 이것이 1회성의 대가이고, 화면이 올리기 **전에** 말해야 한다 —
 * 나중에 알면 「지난번 자료로 다시 만들어 주세요」가 안 되는 것을 그때 안다.
 */
function cannotReuse() {
  return {
    ok: false,
    byDesign: true,
    reason: '1회성으로 올린 자료는 보관하지 않아 다시 쓸 수 없습니다',
    insteadDo: '보고서를 다시 만들려면 자료를 다시 올리거나, 저장소를 연결해 두면 됩니다.',
  };
}

/** 출처 한 줄. **연결 자료와 한눈에 갈려야 한다** (§4.7) */
function citation(item) {
  if (!item) return null;
  const bits = [
    '직접 올림 (1회성)',
    item.original || item.name,
    item.readAt ? `${item.readAt.slice(0, 10)} 읽음` : '읽지 않음',
  ];
  if (item.fingerprint) bits.push(`sha256 ${item.fingerprint.value.slice(0, 12)}`);
  /* ★ 여러 번 올린 것은 그 사실을 적는다. **같은 파일이라 한 줄로 접었다**는
   *   것을 출처가 말해야, 화면에서 줄이 준 이유를 나중에도 알 수 있다 */
  if (item.times > 1) {
    bits.push(`${item.times}번 올림${item.firstReadAt ? ` · 처음 ${item.firstReadAt.slice(0, 10)}` : ''}`);
  }
  /* ★ 같은 파일이 다른 이름으로도 들어왔으면 그 이름을 적는다 — 나중에
   *   「그 파일 이름이 뭐였더라」로 원본을 찾을 때 이것뿐이다 */
  if (Array.isArray(item.alsoNamed) && item.alsoNamed.length) {
    bits.push(`다른 이름: ${item.alsoNamed.join(' · ')}`);
  }
  // ★ 원본을 다시 확인할 수 없다는 것을 출처가 말한다. 이것이 연결과 갈리는 점이다
  bits.push('사본 보관 안 함 · 원본 재확인 불가');
  return bits.join(' · ');
}

module.exports = {
  LEDGER, LOG, LEDGER_VERSION, KIND,
  read, write, accept, list, citation, mergeItems, keyOf,
  cannotVerify, cannotReuse,
};
