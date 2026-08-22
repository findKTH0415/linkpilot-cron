'use strict';
/**
 * vault.js — 올린 자료를 **서버에 보관하는 계층**. 02_Source_Data 를 직접 쓰지 않는다.
 *
 * 왜 계층을 따로 두는가:
 *   지금까지는 `fs.writeFileSync(02_Source_Data/이름, 버퍼)` 한 줄이었다.
 *   그 한 줄에 네 가지가 없었다 —
 *     ① 같은 이름을 올리면 **이전 파일이 조용히 사라진다** (되돌릴 방법 없음)
 *     ② 디스크가 차거나 프로세스가 죽으면 **잘린 파일이 최종 이름으로 남는다**
 *     ③ 저장한 파일이 **그때 그 파일이 맞는지 증명할 수 없다** (해시가 없다)
 *     ④ **지울 방법이 없다.** 잘못 올린 남의 딜 자료도 그대로 남는다
 *
 *   이 시스템의 전제는 「출처 없는 숫자는 들어오지 못한다」인데, 그 출처가 되는
 *   원본 파일이 바뀌었는지 알 수 없으면 출처 표시는 반쪽이다.
 *
 * ★ 보관 리스크를 줄이는 첫 번째 수단은 **덜 보관하는 것**이다.
 *   그래서 지우는 길(`trash`)과 되돌리는 길(`restore`)과 정말 없애는 길(`purge`)을
 *   모두 둔다. 다만 **자동으로 지우지 않는다** — 판단이 틀릴 수 있고 삭제는
 *   되돌릴 수 없다. `reviewDue()` 로 **알리기만** 한다.
 *
 * ★ 새 의존성 0. crypto·fs 만 쓴다 (CLAUDE.md §5).
 *
 * ★ 이 모듈의 쓰기 함수는 **전부 동기**다. Node 는 단일 스레드라 동기 구간에는
 *   다른 요청이 끼어들지 못하므로 장부 갱신에 잠금이 필요 없다.
 *   ⚠ **프로세스를 여러 개 띄우면 이 전제가 깨진다** — 한 프로세스로 운영한다.
 *
 * 파일 배치
 *   02_Source_Data/                 살아 있는 원본
 *   02_Source_Data/.vault.json      장부 — 지금 상태 (파일별 해시·크기·시각)
 *   02_Source_Data/.vault-log.jsonl 기록 — 무슨 일이 있었는가 (append only)
 *   02_Source_Data/.trash/          휴지통 — 지운 것·덮어쓴 것
 *   02_Source_Data/.tmp/            쓰는 중 (rename 전). 최종 이름은 여기 거치지 않는다
 *
 * ⚠ 숨김 이름(`.`)으로 둔 이유는 하나다 — `store.listSourceFiles()` 가
 *   02_Source_Data 를 **재귀로 훑기 때문**에, 그냥 두면 **휴지통에 버린 자료가
 *   다시 추출되어 보고서에 실린다.** store 쪽에서도 같이 제외한다(그쪽 주석 참조).
 *   한쪽만 고치면 지운 자료가 살아 돌아온다.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { kstStamp, kstDate } = require('./kst');

const SOURCE_DIR = '02_Source_Data';
const LEDGER = '.vault.json';
const LOG = '.vault-log.jsonl';
const TRASH = '.trash';
const TMP = '.tmp';

/** listSourceFiles 가 건너뛰어야 하는 이름. store.js 가 이 목록을 가져다 쓴다 */
const RESERVED = [LEDGER, LOG, TRASH, TMP];

/** 파일 권한 — 소유자만. NAS 공유폴더에 다른 계정이 있어도 읽지 못한다 */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

const LEDGER_VERSION = 1;

/**
 * 저장 이름 규칙.
 *
 * ★ 원본 파일명을 그대로 쓰지 않는다 — `../` 하나로 프로젝트 폴더 밖에 쓸 수 있다.
 *   basename 으로 자른 뒤 **최종 경로가 정말 안쪽인지 다시 확인**한다(호출부).
 * ★ 원본명은 버리지 않고 **장부에 남긴다.** 정규화로 글자가 바뀌면 사용자는
 *   자기가 올린 파일을 못 찾는데, 그때 원본명이 없으면 대조할 것이 없다.
 */
function safeName(raw) {
  const s = String(raw || '');
  const cut = path.basename(s)
    // 제어문자 — 로그·터미널·파일 목록을 망가뜨린다. 지우고 남은 것으로 판단한다
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')            // 파일시스템별 금지문자
    .trim();
  if (!cut) return { ok: false, reason: '파일명이 비어 있습니다' };
  if (RESERVED.includes(cut)) return { ok: false, reason: '예약된 이름입니다' };
  // 숨김 이름은 받지 않는다 — 장부·휴지통과 섞이고, 목록에서 안 보인다
  if (cut.startsWith('.')) return { ok: false, reason: '점으로 시작하는 이름은 올릴 수 없습니다' };
  // 255바이트는 대부분 파일시스템의 한 칸 상한이다. 넘으면 저장이 실패하는데
  // 증상이 「저장 실패」로만 보여 원인이 이름 길이라는 것이 드러나지 않는다
  if (Buffer.byteLength(cut, 'utf8') > 200) return { ok: false, reason: '파일명이 너무 깁니다 (200바이트)' };
  return { ok: true, name: cut };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sourceDir(projectDir) {
  return path.join(projectDir, SOURCE_DIR);
}

/** 경로가 정말 dir 안쪽인가. basename 만으로는 심볼릭 링크·정규화 차이를 못 막는다 */
function inside(dir, full) {
  const rel = path.relative(dir, full);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/* ────────────────────────────── 장부 ────────────────────────────── */

function emptyLedger() {
  return { version: LEDGER_VERSION, files: {}, trash: [] };
}

function readLedger(dir) {
  const full = path.join(dir, LEDGER);
  if (!fs.existsSync(full)) return emptyLedger();
  try {
    const v = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (!v || typeof v !== 'object') return emptyLedger();
    return {
      version: v.version || LEDGER_VERSION,
      files: v.files && typeof v.files === 'object' ? v.files : {},
      trash: Array.isArray(v.trash) ? v.trash : [],
    };
  } catch (_) {
    // ★ 장부가 깨졌다고 **빈 장부로 덮어쓰지 않는다.** 덮어쓰면 그 순간
    //   모든 파일이 「장부 밖 파일」이 되고, 원인은 아무 데도 안 남는다.
    //   빈 장부를 돌려주되 파일은 그대로 두고, reconcile() 이 되살린다
    return emptyLedger();
  }
}

/**
 * 장부를 원자적으로 쓴다.
 * 장부가 반쯤 쓰인 채 남으면 **파일은 다 있는데 목록이 사라진다** — 자료 자체를
 * 잃는 것과 체감이 같다.
 */
function writeLedger(dir, ledger) {
  atomicWrite(dir, LEDGER, Buffer.from(JSON.stringify(ledger, null, 2), 'utf8'));
}

/** append-only 기록. 장부(현재 상태)와 달리 **덮어쓰지 않는다** — 감사 기록이다 */
function appendLog(dir, entry) {
  try {
    fs.appendFileSync(path.join(dir, LOG), JSON.stringify({ at: kstStamp(), ...entry }) + '\n', { encoding: 'utf8', mode: FILE_MODE });
  } catch (_) {
    // 기록 실패가 저장 실패가 되면 안 된다 — 자료를 못 올리는 쪽이 더 나쁘다.
    // 다만 조용히 넘기지 않도록 put() 이 응답에 logged:false 를 실어 돌려준다
    return false;
  }
  return true;
}

/* ────────────────────────────── 원자적 쓰기 ────────────────────────────── */

/**
 * tmp 에 쓰고 fsync 한 뒤 rename 한다.
 *
 * ★ 왜 이렇게까지 하는가: `writeFileSync` 는 디스크가 차면 **잘린 파일을
 *   최종 이름으로** 남긴다. 그 파일은 열리기는 하는데 내용이 모자라고,
 *   증상이 「원본이 이상하다」로만 보여 저장 때문이라는 것이 드러나지 않는다.
 * ★ rename 은 같은 파일시스템 안에서 원자적이다. 그래서 tmp 를 **같은 폴더 아래**
 *   둔다 — /tmp 에 두면 다른 파일시스템일 수 있어 rename 이 복사로 바뀐다.
 */
function atomicWrite(dir, name, buf) {
  const tmpDir = path.join(dir, TMP);
  fs.mkdirSync(tmpDir, { recursive: true, mode: DIR_MODE });
  const tmp = path.join(tmpDir, `${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'w', FILE_MODE);
    fs.writeSync(fd, buf, 0, buf.length, 0);
    fs.fsyncSync(fd);   // 여기까지 와야 전원이 나가도 내용이 남는다
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) { /* 이미 닫힘 */ } }
  }
  try {
    fs.renameSync(tmp, path.join(dir, name));
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) { /* 정리 실패는 삼킨다 */ }
    throw err;
  }
}

/** 쓰다 만 조각 청소. 프로세스가 죽으면 .tmp 에 남는다 — 용량만 먹고 쓸모가 없다 */
function sweepTmp(projectDir) {
  const dir = sourceDir(projectDir);
  const tmpDir = path.join(dir, TMP);
  if (!fs.existsSync(tmpDir)) return { removed: 0, bytes: 0 };
  let removed = 0, bytes = 0;
  for (const n of fs.readdirSync(tmpDir).sort()) {
    const full = path.join(tmpDir, n);
    try {
      bytes += fs.statSync(full).size;
      fs.unlinkSync(full);
      removed += 1;
    } catch (_) { /* 지금 쓰는 중일 수 있다 — 넘어간다 */ }
  }
  return { removed, bytes };
}

/* ────────────────────────────── 저장 ────────────────────────────── */

/**
 * 자료 한 건을 보관한다.
 *
 * ★ **덮어쓰지 않는다.** 같은 이름이 오면 기존 파일을 휴지통으로 옮기고 새로 쓴다.
 *   「잘못 올려서 원본이 날아갔다」가 이 시스템에서 가장 되돌리기 어려운 사고다.
 * ★ 내용이 완전히 같으면(해시 일치) **다시 쓰지 않는다.** 같은 파일을 두 번
 *   올리는 일은 흔한데, 그때마다 휴지통에 세대가 쌓이면 용량만 먹는다.
 *
 * @returns {{ok:true, name, original, bytes, sha256, at, duplicate:boolean,
 *            replaced:null|{sha256,bytes,as}, logged:boolean}
 *          |{ok:false, reason:string}}
 */
function put(projectDir, rawName, buf, opts = {}) {
  const dir = sourceDir(projectDir);
  if (!fs.existsSync(dir)) return { ok: false, reason: '프로젝트를 찾을 수 없습니다' };
  if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, reason: '빈 파일입니다' };

  const s = safeName(rawName);
  if (!s.ok) return { ok: false, reason: s.reason };

  const full = path.join(dir, s.name);
  if (!inside(dir, full) || path.dirname(full) !== dir) {
    return { ok: false, reason: '경로가 올바르지 않습니다' };
  }

  const digest = sha256(buf);
  const ledger = readLedger(dir);
  const prev = ledger.files[s.name];

  // 같은 이름 · 같은 내용 → 아무것도 하지 않는다 (세대를 만들지 않는다)
  if (prev && prev.sha256 === digest && fs.existsSync(full)) {
    return {
      ok: true, name: s.name, original: prev.original || String(rawName),
      bytes: buf.length, sha256: digest, at: prev.at, duplicate: true,
      replaced: null, logged: appendLog(dir, { action: 'put.duplicate', name: s.name, sha256: digest }),
    };
  }

  // 같은 이름 · 다른 내용 → 기존 것을 휴지통으로. **지우지 않는다**
  let replaced = null;
  if (fs.existsSync(full)) {
    const moved = toTrash(dir, ledger, s.name, 'replaced');
    replaced = moved ? { sha256: moved.sha256, bytes: moved.bytes, as: moved.as } : null;
  }

  atomicWrite(dir, s.name, buf);
  try { fs.chmodSync(full, FILE_MODE); } catch (_) { /* Windows 등 — 무해 */ }

  const at = kstStamp();
  ledger.files[s.name] = {
    original: String(rawName),
    bytes: buf.length,
    sha256: digest,
    at,
    by: opts.by || null,          // 누가 올렸는가. 없으면 null — 지어내지 않는다
    generation: prev ? (prev.generation || 1) + 1 : 1,
  };
  writeLedger(dir, ledger);

  return {
    ok: true, name: s.name, original: String(rawName),
    bytes: buf.length, sha256: digest, at, duplicate: false, replaced,
    logged: appendLog(dir, { action: 'put', name: s.name, sha256: digest, bytes: buf.length, by: opts.by || null, replaced: !!replaced }),
  };
}

/* ────────────────────────────── 휴지통 ────────────────────────────── */

/**
 * 휴지통 안 이름은 `원본이름.해시12자리` 로 짓는다.
 * 같은 이름이 여러 번 버려져도 **서로 덮어쓰지 않고**, 같은 내용이면 한 벌만 남는다.
 */
function trashNameFor(name, digest) {
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  return `${base}.${String(digest).slice(0, 12)}${ext}`;
}

/** 내부용 — 장부를 받아서 옮기고, 장부는 호출부가 쓴다 */
function toTrash(dir, ledger, name, reason) {
  const full = path.join(dir, name);
  if (!fs.existsSync(full)) return null;

  const buf = fs.readFileSync(full);
  const digest = sha256(buf);
  const meta = ledger.files[name] || {};
  const as = trashNameFor(name, digest);

  const trashDir = path.join(dir, TRASH);
  fs.mkdirSync(trashDir, { recursive: true, mode: DIR_MODE });
  const dest = path.join(trashDir, as);

  // 같은 내용이 이미 휴지통에 있으면 원본만 지운다 (두 벌을 두지 않는다)
  if (fs.existsSync(dest)) fs.unlinkSync(full);
  else fs.renameSync(full, dest);

  delete ledger.files[name];
  const entry = {
    name, as, original: meta.original || name,
    bytes: buf.length, sha256: digest,
    storedAt: meta.at || null, trashedAt: kstStamp(), reason,
  };
  // 같은 as 가 이미 장부에 있으면 늘리지 않는다
  if (!ledger.trash.some(t => t.as === as)) ledger.trash.push(entry);
  return entry;
}

/**
 * 자료를 지운다 — **휴지통으로 옮길 뿐 없애지 않는다.**
 * 정말 없애려면 `purge()` 를 따로 부른다. 한 번에 없애는 길을 두지 않은 이유는
 * 하나다 — 딜 자료는 잘못 지웠을 때 다시 만들 수 없다.
 */
function trash(projectDir, rawName, opts = {}) {
  const dir = sourceDir(projectDir);
  if (!fs.existsSync(dir)) return { ok: false, reason: '프로젝트를 찾을 수 없습니다' };
  const s = safeName(rawName);
  if (!s.ok) return { ok: false, reason: s.reason };
  if (!fs.existsSync(path.join(dir, s.name))) return { ok: false, reason: '그런 자료가 없습니다' };

  const ledger = readLedger(dir);
  const entry = toTrash(dir, ledger, s.name, opts.reason || 'deleted');
  writeLedger(dir, ledger);
  appendLog(dir, { action: 'trash', name: s.name, as: entry && entry.as, by: opts.by || null });
  return { ok: true, trashed: entry };
}

/**
 * 휴지통에서 되돌린다.
 * ★ 되돌릴 자리에 다른 파일이 있으면 **그것을 먼저 휴지통으로** 보낸다.
 *   복원이 새 사고를 만들면 안 된다.
 */
function restore(projectDir, as, opts = {}) {
  const dir = sourceDir(projectDir);
  if (!fs.existsSync(dir)) return { ok: false, reason: '프로젝트를 찾을 수 없습니다' };

  const ledger = readLedger(dir);
  const idx = ledger.trash.findIndex(t => t.as === String(as));
  if (idx < 0) return { ok: false, reason: '휴지통에 그런 자료가 없습니다' };
  const entry = ledger.trash[idx];

  const src = path.join(dir, TRASH, entry.as);
  if (!fs.existsSync(src)) {
    // 장부에는 있는데 파일이 없다 — 조용히 성공으로 만들지 않는다
    return { ok: false, reason: '휴지통 파일이 없습니다 (이미 비워졌을 수 있습니다)' };
  }

  let displaced = null;
  if (fs.existsSync(path.join(dir, entry.name))) {
    displaced = toTrash(dir, ledger, entry.name, 'displaced-by-restore');
  }

  fs.renameSync(src, path.join(dir, entry.name));
  try { fs.chmodSync(path.join(dir, entry.name), FILE_MODE); } catch (_) { /* 무해 */ }

  ledger.files[entry.name] = {
    original: entry.original, bytes: entry.bytes, sha256: entry.sha256,
    at: kstStamp(), by: opts.by || null,
    generation: 1, restoredFrom: entry.as, storedAt: entry.storedAt || null,
  };
  ledger.trash = ledger.trash.filter(t => t.as !== entry.as);
  writeLedger(dir, ledger);
  appendLog(dir, { action: 'restore', name: entry.name, as: entry.as, by: opts.by || null });

  return { ok: true, restored: { name: entry.name, bytes: entry.bytes, sha256: entry.sha256 }, displaced };
}

/**
 * 휴지통을 실제로 비운다 — **되돌릴 수 없다.**
 *
 * ★ `olderThanDays` 를 반드시 받는다. 기본값을 두면 「전부 지우기」가 실수로 도는데,
 *   그 실수는 되돌릴 수 없다.
 * ★ `dryRun` 이 기본이다. 무엇이 지워지는지 먼저 보여 준 다음 지운다.
 */
function purge(projectDir, opts = {}) {
  const dir = sourceDir(projectDir);
  if (!fs.existsSync(dir)) return { ok: false, reason: '프로젝트를 찾을 수 없습니다' };
  const days = opts.olderThanDays;
  if (!Number.isFinite(days) || days < 0) {
    return { ok: false, reason: 'olderThanDays 를 지정해야 합니다 (몇 일 지난 것을 없앨지)' };
  }
  const dryRun = opts.dryRun !== false;

  const ledger = readLedger(dir);
  const cutoff = Date.now() - days * 86400000;
  const targets = ledger.trash.filter((t) => {
    const ms = Date.parse(t.trashedAt || '');
    return Number.isFinite(ms) && ms <= cutoff;
  });

  if (dryRun) {
    return {
      ok: true, dryRun: true,
      willRemove: targets.map(t => ({ name: t.name, as: t.as, bytes: t.bytes, trashedAt: t.trashedAt })),
      bytes: targets.reduce((a, t) => a + (t.bytes || 0), 0),
    };
  }

  const removed = [];
  for (const t of targets) {
    const full = path.join(dir, TRASH, t.as);
    try { if (fs.existsSync(full)) fs.unlinkSync(full); removed.push(t); } catch (_) { /* 다음 번에 다시 시도된다 */ }
  }
  const gone = new Set(removed.map(t => t.as));
  ledger.trash = ledger.trash.filter(t => !gone.has(t.as));
  writeLedger(dir, ledger);
  appendLog(dir, { action: 'purge', count: removed.length, bytes: removed.reduce((a, t) => a + (t.bytes || 0), 0), olderThanDays: days, by: opts.by || null });

  return { ok: true, dryRun: false, removed: removed.map(t => ({ name: t.name, as: t.as, bytes: t.bytes })), bytes: removed.reduce((a, t) => a + (t.bytes || 0), 0) };
}

/* ────────────────────────────── 목록 · 무결성 · 용량 ────────────────────────────── */

/** 살아 있는 자료 목록 (장부 기준). 디스크에 없는 것은 `missing: true` 로 드러낸다 */
function list(projectDir) {
  const dir = sourceDir(projectDir);
  if (!fs.existsSync(dir)) return { files: [], trash: [] };
  const ledger = readLedger(dir);
  const files = Object.keys(ledger.files).sort().map((name) => {
    const m = ledger.files[name];
    return {
      name, original: m.original || name, bytes: m.bytes, sha256: m.sha256,
      at: m.at, by: m.by || null, generation: m.generation || 1,
      missing: !fs.existsSync(path.join(dir, name)),
    };
  });
  const trashList = ledger.trash.slice().sort((a, b) => String(b.trashedAt).localeCompare(String(a.trashedAt)));
  return { files, trash: trashList };
}

/**
 * 저장할 때 남긴 해시와 지금 파일을 대조한다.
 *
 * ★ 이것이 「보관 리스크 축소」의 핵심이다. 디스크가 조용히 상하거나(bit rot),
 *   NAS 공유폴더에서 누가 파일을 바꿔치기해도 **증상이 전혀 없다** —
 *   보고서는 그대로 나오고 출처 표시도 멀쩡하다. 대조하지 않으면 알 수 없다.
 *
 * @returns {{ok:boolean, checked:number, mismatched:[], missing:[], unknown:[], at:string}}
 *   unknown = 디스크에는 있는데 장부에 없는 파일. **조용히 무시하지 않는다** —
 *   NAS 에서 직접 넣은 파일이 여기 잡힌다. 등록하려면 reconcile() 을 부른다.
 */
function verify(projectDir) {
  const dir = sourceDir(projectDir);
  const at = kstStamp();
  if (!fs.existsSync(dir)) return { ok: false, checked: 0, mismatched: [], missing: [], unknown: [], at };

  const ledger = readLedger(dir);
  const mismatched = [], missing = [];
  let checked = 0;

  for (const name of Object.keys(ledger.files)) {
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) { missing.push({ name, sha256: ledger.files[name].sha256 }); continue; }
    let now;
    try { now = sha256(fs.readFileSync(full)); } catch (err) { missing.push({ name, reason: err.message }); continue; }
    checked += 1;
    if (now !== ledger.files[name].sha256) {
      mismatched.push({ name, expected: ledger.files[name].sha256, actual: now, storedAt: ledger.files[name].at });
    }
  }

  const unknown = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (RESERVED.includes(name) || name.startsWith('.')) continue;
    if (ledger.files[name]) continue;
    let st;
    try { st = fs.statSync(path.join(dir, name)); } catch (_) { continue; }
    if (st.isDirectory()) continue;
    unknown.push({ name, bytes: st.size });
  }

  return { ok: !mismatched.length && !missing.length && !unknown.length, checked, mismatched, missing, unknown, at };
}

/**
 * 장부 밖 파일을 장부에 올린다.
 *
 * 언제 쓰는가 — 장부가 생기기 전에 올라온 파일, NAS 에서 직접 복사해 넣은 파일,
 * 장부 파일이 깨져 읽히지 않은 뒤. **없던 것으로 치지 않고 등록한다.**
 *
 * ⚠ 등록 시점의 해시를 기준으로 삼는다. 그 파일이 **올라온 그대로인지는 보장하지
 *   못한다** — 그 사실을 `verifiedFrom: 'reconcile'` 로 남긴다.
 */
function reconcile(projectDir) {
  const dir = sourceDir(projectDir);
  if (!fs.existsSync(dir)) return { ok: false, reason: '프로젝트를 찾을 수 없습니다' };
  const ledger = readLedger(dir);
  const added = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (RESERVED.includes(name) || name.startsWith('.')) continue;
    if (ledger.files[name]) continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch (_) { continue; }
    if (st.isDirectory()) continue;
    const buf = fs.readFileSync(full);
    ledger.files[name] = {
      original: name, bytes: buf.length, sha256: sha256(buf),
      at: kstStamp(), by: null, generation: 1, verifiedFrom: 'reconcile',
    };
    added.push({ name, bytes: buf.length });
  }
  if (added.length) {
    writeLedger(dir, ledger);
    appendLog(dir, { action: 'reconcile', count: added.length });
  }
  return { ok: true, added };
}

/**
 * 용량 집계 — 개정안 §3-1 이 세기로 한 것만 센다.
 *
 * **센다:** 올린 원본 + 휴지통.
 * **안 센다:** 생성 산출물(09_IM·12_Final·SVG·JPEG) · API 캐시.
 *   §6-1 이 SVG 마다 JPEG 을 하나 더 만드는데 그것까지 청구하면 규칙이 요금이 된다.
 *
 * `tmp` 는 따로 낸다 — 청구 대상은 아니지만 **디스크는 먹는다.** 합계에 숨기면
 * 「사용량은 그대론데 디스크가 찬다」가 된다.
 */
function usage(projectDir) {
  const dir = sourceDir(projectDir);
  const zero = { live: { files: 0, bytes: 0 }, trash: { files: 0, bytes: 0 }, tmp: { files: 0, bytes: 0 }, billableBytes: 0, at: kstStamp() };
  if (!fs.existsSync(dir)) return zero;

  const out = { live: { files: 0, bytes: 0 }, trash: { files: 0, bytes: 0 }, tmp: { files: 0, bytes: 0 }, billableBytes: 0, at: kstStamp() };

  // ★ 장부가 아니라 **디스크를 잰다.** 장부는 갈릴 수 있고, 디스크는 갈리지 않는다
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    let st; try { st = fs.statSync(path.join(dir, name)); } catch (_) { continue; }
    if (st.isDirectory()) continue;
    out.live.files += 1; out.live.bytes += st.size;
  }
  for (const [sub, key] of [[TRASH, 'trash'], [TMP, 'tmp']]) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) continue;
    for (const name of fs.readdirSync(d).sort()) {
      let st; try { st = fs.statSync(path.join(d, name)); } catch (_) { continue; }
      if (st.isDirectory()) continue;
      out[key].files += 1; out[key].bytes += st.size;
    }
  }
  out.billableBytes = out.live.bytes + out.trash.bytes;
  return out;
}

/**
 * 보관 검토 대상인가 — **알리기만 한다. 지우지 않는다.**
 *
 * 보관 리스크를 줄이는 가장 확실한 방법은 「덜 오래 보관하는 것」인데, 자동 삭제는
 * 되돌릴 수 없고 판단이 틀릴 수 있다. 그래서 **「이 프로젝트 자료를 N일째 안
 * 건드렸다」를 말하는 데까지만** 한다. 지우는 것은 사람이 누른다.
 *
 * @param days 며칠 손대지 않으면 검토 대상인가
 */
function reviewDue(projectDir, days) {
  const dir = sourceDir(projectDir);
  const at = kstStamp();
  if (!fs.existsSync(dir)) return { due: false, reason: 'no-source-dir', at };
  if (!Number.isFinite(days) || days <= 0) return { due: false, reason: 'no-policy', at };

  const u = usage(projectDir);
  if (!u.live.files && !u.trash.files) return { due: false, reason: 'empty', lastActivity: null, at };

  // ★ **자료 자체**의 시각만 본다. 장부(.vault.json)·기록(.vault-log.jsonl)·
  //   임시 조각(.tmp)은 제외한다 — 그것들은 대조 한 번, 청소 한 번에도 새 시각이
  //   찍혀서 「방금 손댔다」로 보인다. 그러면 오래 묵은 자료가 영원히 검토 대상이
  //   되지 않고, 보관 기간이라는 장치가 통째로 무력해진다.
  let newest = 0;
  const touch = (p) => { try { newest = Math.max(newest, fs.statSync(p).mtimeMs); } catch (_) { /* 없으면 넘어간다 */ } };
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    touch(path.join(dir, name));
  }
  const trashDir = path.join(dir, TRASH);
  if (fs.existsSync(trashDir)) for (const n of fs.readdirSync(trashDir).sort()) touch(path.join(trashDir, n));

  // 장부에 적힌 시각도 함께 본다 — NAS 에서 복사해 들어온 파일은 mtime 이
  // 원본의 것이라 실제로 여기 들어온 날보다 앞선다
  const ledger = readLedger(dir);
  const stamp = (s) => { const ms = Date.parse(s || ''); if (Number.isFinite(ms)) newest = Math.max(newest, ms); };
  for (const k of Object.keys(ledger.files)) stamp(ledger.files[k].at);
  for (const t of ledger.trash) stamp(t.trashedAt);

  if (!newest) return { due: false, reason: 'unknown', lastActivity: null, at };
  const idleDays = Math.floor((Date.now() - newest) / 86400000);
  return {
    due: idleDays >= days,
    idleDays,
    lastActivity: kstDate(new Date(newest)),
    bytes: u.billableBytes,
    policyDays: days,
    at,
  };
}

module.exports = {
  SOURCE_DIR, LEDGER, LOG, TRASH, TMP, RESERVED, FILE_MODE, DIR_MODE, LEDGER_VERSION,
  safeName, sha256, sourceDir, trashNameFor,
  put, trash, restore, purge,
  list, verify, reconcile, usage, reviewDue, sweepTmp,
  readLedger, writeLedger,
};
