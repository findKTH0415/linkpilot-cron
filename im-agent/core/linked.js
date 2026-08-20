'use strict';
/**
 * linked.js — 연결된 자료의 **장부**. 파일은 없고 참조와 지문만 있다.
 *
 * `core/vault.js` 와 무엇이 다른가:
 *   vault 는 **우리가 보관하는** 자료를 다룬다. 여기는 **보관하지 않는** 자료다.
 *   그래서 이 장부에는 파일이 없다 — 어디 있는지(provider·fileId), 어느 판인지(rev),
 *   우리가 읽었을 때 무엇이었는지(sha256), 언제 읽었는지(readAt)만 남는다.
 *
 * ★★ 파일을 안 남긴다고 **근거까지 안 남기면 안 된다.**
 *   이 시스템의 전제가 「출처 없는 숫자는 들어오지 못한다」인데, 원본이 남의
 *   드라이브에 있으면 사용자가 그것을 고치거나 지울 수 있다. 그때 **문서에는
 *   아무 표시도 안 남고 숫자만 근거를 잃는다.**
 *   그래서 파일 대신 **지문과 판을 남긴다** — 나중에 대조하면 바뀐 것이 드러난다.
 *
 * ★★ 작업 사본의 수명을 코드가 책임진다.
 *   `materialize()` 는 **OS 임시 폴더**에 받아 오고 `dispose()` 로 폴더째 지운다.
 *   프로젝트 폴더에 두지 않는 이유는 하나다 — 거기 두면 지우는 것을 잊었을 때
 *   **그대로 보관이 되고, 아무도 눈치채지 못한다.**
 *
 * ★ 추출기에 목록을 **직접 넘긴다.** `02-extraction` 은
 *   `input.files || store.listSourceFiles()` 라 밖에서 넣을 수 있다.
 *   그래서 임시 폴더에 둬도 파이프라인이 그대로 읽는다.
 *
 * ★ **토큰은 이 장부에 절대 들어가지 않는다** (테스트로 고정).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { kstStamp } = require('./kst');
const vault = require('./vault');
const storage = require('../connectors/storage');

const LEDGER = '01_Project/linked.json';
const LOG = '01_Project/linked-log.jsonl';
const LEDGER_VERSION = 1;

/** 장부에 절대 들어가면 안 되는 이름. 하나라도 있으면 저장을 거절한다 */
const FORBIDDEN = ['accessToken', 'refreshToken', 'token', 'authorization', 'secret', 'password'];

function ledgerPath(projectDir) { return path.join(projectDir, LEDGER); }

function emptyLedger() { return { version: LEDGER_VERSION, items: [] }; }

function read(projectDir) {
  const full = ledgerPath(projectDir);
  if (!fs.existsSync(full)) return emptyLedger();
  try {
    const v = JSON.parse(fs.readFileSync(full, 'utf8'));
    return {
      version: v.version || LEDGER_VERSION,
      items: Array.isArray(v.items) ? v.items : [],
    };
  } catch (_) {
    // 깨졌다고 빈 장부로 덮어쓰지 않는다 — 덮어쓰면 무엇을 연결했는지가 사라지고
    // 원본은 남의 드라이브에 있으므로 **복구할 방법이 없다**
    return emptyLedger();
  }
}

function write(projectDir, ledger) {
  const dir = path.join(projectDir, '01_Project');
  fs.mkdirSync(dir, { recursive: true });
  // 반쯤 쓰인 장부는 「무엇을 연결했는지」를 통째로 잃는 것과 같다
  const scan = JSON.stringify(ledger);
  for (const k of FORBIDDEN) {
    if (scan.includes(`"${k}"`)) throw new Error(`장부에 ${k} 를 넣을 수 없다`);
  }
  const tmp = path.join(dir, `.linked-${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ledgerPath(projectDir));
}

function log(projectDir, entry) {
  try {
    const dir = path.join(projectDir, '01_Project');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(projectDir, LOG),
      JSON.stringify({ at: kstStamp(), ...entry }) + '\n', { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (_) { return false; }
}

/* ────────────────────────── 연결 · 해제 ────────────────────────── */

/**
 * 자료 하나를 연결한다. **가져오지 않는다** — 어디 있는지만 적는다.
 *
 * 같은 파일의 **다른 판**이 오면 이전 판을 지우지 않고 `supersededBy` 로 잇는다.
 * 지우면 「그때는 이 판을 보고 썼다」가 사라진다.
 */
function link(projectDir, rawRef, opts = {}) {
  if (!fs.existsSync(projectDir)) return { ok: false, reason: '프로젝트를 찾을 수 없습니다' };

  const n = storage.normalizeRef(rawRef);
  if (!n.ok) return { ok: false, reason: n.reason };
  const ref = n.value;
  const key = storage.refKey(ref);

  const ledger = read(projectDir);
  const live = ledger.items.filter(i => !i.unlinkedAt && !i.supersededBy);
  const same = live.find(i => storage.refKey(i) === key);

  if (same && same.rev === ref.rev) {
    return { ok: true, already: true, item: same };
  }

  const item = {
    ...ref,
    key,
    linkedAt: kstStamp(),
    linkedBy: opts.by || null,
    // 아직 안 읽었다. **읽어야 지문이 생긴다** — 지금 지문을 지어내지 않는다
    fingerprint: null,
    readAt: null,
    unlinkedAt: null,
    supersededBy: null,
    note: storage.exportedNote(ref),
  };

  if (same) {
    same.supersededBy = ref.rev;   // 판이 올라갔다. 이전 판 기록은 남긴다
    same.supersededAt = kstStamp();
  }
  ledger.items.push(item);
  write(projectDir, ledger);
  log(projectDir, { action: 'link', key, rev: ref.rev, provider: ref.provider, by: opts.by || null });

  return { ok: true, already: false, item, replacedRev: same ? same.rev : null };
}

/** 연결을 끊는다. **원본은 건드리지 않는다** — 남의 드라이브다 */
function unlink(projectDir, key, opts = {}) {
  const ledger = read(projectDir);
  const item = ledger.items.find(i => i.key === String(key) && !i.unlinkedAt && !i.supersededBy);
  if (!item) return { ok: false, reason: '연결된 자료가 아닙니다' };
  item.unlinkedAt = kstStamp();
  item.unlinkedBy = opts.by || null;
  write(projectDir, ledger);
  log(projectDir, { action: 'unlink', key: item.key, by: opts.by || null });
  // ★ 지우는 것이 아니라 끊는 것이다. 그 구분을 응답이 말한다
  return { ok: true, unlinked: item, deletedOriginal: false };
}

/** 지금 걸려 있는 자료. 지나간 판·끊은 것은 `history` 로 따로 낸다 */
function list(projectDir) {
  const ledger = read(projectDir);
  const live = ledger.items.filter(i => !i.unlinkedAt && !i.supersededBy);
  const history = ledger.items.filter(i => i.unlinkedAt || i.supersededBy);
  return {
    items: live,
    history,
    // 지문이 없는 것 = **아직 한 번도 읽지 않은 것**. 값의 근거가 될 수 없다
    unread: live.filter(i => !i.fingerprint).map(i => i.key),
    at: kstStamp(),
  };
}

/* ────────────────────────── 가져오기 · 지우기 ────────────────────────── */

/**
 * 연결된 자료를 **잠깐** 받아 온다. 쓰고 나면 `dispose()` 를 반드시 부른다.
 *
 * @param fetchOne(item) → Promise<{ok:true, buf:Buffer} | {ok:false, reason}>
 *        제공자별 실제 내려받기. 이 모듈은 **어디서 오는지 모른다** —
 *        커넥터가 바뀌어도 수명 관리는 그대로다.
 *
 * @returns {{files:Array, failed:Array, dispose:Function, dir:string}}
 *   files 는 `02-extraction` 이 그대로 받는 모양이다 ({name, path, size, ext}).
 *
 * ★ 실패를 삼키지 않는다. 못 가져온 것은 `failed` 로 나오고, **그 사실을 모른 채
 *   보고서가 만들어지면 안 된다** — 값이 조용히 빠지고 문서는 멀쩡해 보인다.
 */
async function materialize(projectDir, fetchOne, opts = {}) {
  const { items } = list(projectDir);
  const only = opts.keys ? new Set(opts.keys) : null;
  const targets = only ? items.filter(i => only.has(i.key)) : items;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-linked-'));
  const files = [];
  const failed = [];
  const ledger = read(projectDir);

  for (const item of targets) {
    let got;
    try {
      got = await fetchOne(item);
    } catch (err) {
      got = { ok: false, reason: err.message };
    }
    if (!got || !got.ok || !Buffer.isBuffer(got.buf) || !got.buf.length) {
      // 원본이 지워졌거나 권한이 끊겼거나 판이 사라졌다 — 어느 쪽이든 말한다
      failed.push({ key: item.key, name: item.name, reason: (got && got.reason) || '가져오지 못했습니다' });
      continue;
    }

    const safe = vault.safeName(item.name);
    const base = safe.ok ? safe.name : `${item.provider}-${files.length + 1}`;
    // 임시 폴더 안에서 이름이 겹칠 수 있다 — 겹치면 앞에 번호를 붙인다
    let name = base;
    for (let n = 2; fs.existsSync(path.join(dir, name)); n += 1) {
      const ext = path.extname(base);
      name = `${ext ? base.slice(0, -ext.length) : base} (${n})${ext}`;
    }
    const full = path.join(dir, name);
    fs.writeFileSync(full, got.buf, { mode: 0o600 });

    // 우리가 읽은 바이트로 우리가 지문을 만든다 (제공자 해시를 믿지 않는다)
    const fp = storage.fingerprint(got.buf);
    const rec = ledger.items.find(i => i.key === item.key && i.rev === item.rev && !i.unlinkedAt);
    if (rec) {
      // 전에 읽은 적이 있는데 **같은 판인데 지문이 다르면** 그것부터 말해야 한다
      if (rec.fingerprint && rec.fingerprint.value !== fp.value) {
        rec.fingerprintChanged = { was: rec.fingerprint.value, now: fp.value, at: kstStamp() };
      }
      rec.fingerprint = fp;
      rec.readAt = kstStamp();
    }

    files.push({ name, path: full, size: got.buf.length, ext: path.extname(name).toLowerCase(), key: item.key });
  }

  write(projectDir, ledger);
  log(projectDir, { action: 'materialize', got: files.length, failed: failed.length });

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
    // ★ 지웠다는 것을 남긴다. 「보관하지 않는다」는 **확인할 수 있어야** 하는 말이다
    log(projectDir, { action: 'dispose', removed });
    return { removed };
  };

  return { files, failed, dispose, dir };
}

/**
 * 원본이 그때 그대로인가.
 *
 * @param headOne(item) → Promise<{ok:true, rev, providerHash?, missing?} | {ok:false, reason}>
 *        **내려받지 않고** 메타만 본다 — 매번 다 받으면 남의 계정 쿼터를 태운다.
 *
 * ★ 여기가 「보관하지 않는다」의 대가를 갚는 자리다. 우리가 파일을 안 갖고
 *   있으므로 **원본이 바뀌었는지는 물어봐야만 안다.** 안 물으면 문서는 그대로
 *   멀쩡하고 근거만 사라진다.
 */
async function verify(projectDir, headOne) {
  const { items } = list(projectDir);
  const changed = [], missing = [], unread = [], ok = [], errors = [];

  for (const item of items) {
    if (!item.fingerprint) { unread.push({ key: item.key, name: item.name }); continue; }
    let head;
    try { head = await headOne(item); } catch (err) { head = { ok: false, reason: err.message }; }

    if (!head || !head.ok) {
      if (head && head.missing) missing.push({ key: item.key, name: item.name });
      else errors.push({ key: item.key, name: item.name, reason: (head && head.reason) || '확인하지 못했습니다' });
      continue;
    }
    if (String(head.rev) !== String(item.rev)) {
      changed.push({ key: item.key, name: item.name, was: item.rev, now: String(head.rev), readAt: item.readAt });
      continue;
    }
    ok.push({ key: item.key, name: item.name });
  }

  return {
    // 하나라도 바뀌었거나 사라졌으면 통과가 아니다
    ok: !changed.length && !missing.length && !errors.length && !unread.length,
    ok_: ok, changed, missing, unread, errors, at: kstStamp(),
  };
}

/**
 * 출처에 적을 한 줄. 값이 아니라 **어디서·언제·어느 판을 읽었는가**다 (§4.7).
 */
function citation(item) {
  if (!item) return null;
  // ★ 아는 목록으로 이름을 찾는다 — 앱이 내부로 넘긴 것도 이름이 있어야
  //   출처가 「linkpilot-app」이라는 코드값으로 문서에 실리지 않는다
  const p = storage.KNOWN[item.provider];
  const bits = [
    `${p ? p.name : item.provider}`,
    item.path || item.name,
    `판 ${String(item.rev).slice(0, 12)}`,
    item.readAt ? `${item.readAt.slice(0, 10)} 읽음` : '아직 읽지 않음',
  ];
  if (item.fingerprint) bits.push(`sha256 ${item.fingerprint.value.slice(0, 12)}`);
  if (item.note) bits.push(item.note);
  // ★ **우리 서버에 사본이 없다**는 사실을 출처가 말한다. 나중에 원본이
  //   사라졌을 때 「우리한테 있겠지」로 시간을 버리지 않게 한다
  bits.push('사본 보관 안 함');
  return bits.join(' · ');
}

module.exports = {
  LEDGER, LOG, LEDGER_VERSION, FORBIDDEN,
  read, write, link, unlink, list, materialize, verify, citation,
};
