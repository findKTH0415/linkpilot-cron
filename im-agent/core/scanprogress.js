'use strict';
/**
 * scanprogress.js — **자료를 읽는 동안 「몇 개 중 몇 개」를 남긴다.**
 *
 * ★★★ 왜 만들었나 〈2026-08-24 사장님: 「서버가 읽고, 스캔하는데 너무 오래걸림 /
 *   그런데 결국 읽은 값은 0」〉.
 *
 *   스캔은 요청 하나로 돌고 **끝나야 답한다.** 그동안 화면이 아는 것은
 *   「몇 초 지났나」뿐이라, 진행률을 **걸린 시간으로 어림**하고 있었다.
 *   그래서 이런 일이 났다:
 *
 *     · 자료가 30개든 1개든 **같은 속도로 차오른다** — 어림이라 그렇다
 *     · 한 파일에서 오래 걸려도 화면은 그냥 「읽는 중」이다
 *     · 다 읽고 값이 0 이면, **어디서 0 이 됐는지**를 알 길이 없다
 *
 * ★ 그래서 읽는 쪽이 **파일 하나를 끝낼 때마다 여기에 적는다.** 화면은 그것을
 *   물어본다. 어림이 아니라 **센 수**다.
 *
 * ★★ **끝난 파일만 적는다.** 「지금 읽는 중」을 적으면 나란히 읽는 이 코드에서는
 *   여러 개가 동시에 「읽는 중」이 되어, 그 목록이 진행이 아니라 잡음이 된다.
 *   대신 **끝난 것의 이름과 결과**를 적는다 — 그것이 사실이다.
 *
 * ★★★ **이 파일이 없어도 스캔은 돌아야 한다.** 진행을 못 적는 것은 불편이고,
 *   스캔이 죽는 것은 사고다. 그래서 쓰기 실패를 통째로 삼킨다 (§4.6 과 같은 결).
 *
 * ★ 갱신시각은 **한 곳에서만** 만든다 (`core/kst.js` 의 `kstStamp`) — CLAUDE.md §8.
 */

const fs = require('fs');
const path = require('path');
const store = require('./store');
const { kstStamp } = require('./kst');

const REL = '01_Project/scan-progress.json';

/** 이보다 오래된 기록은 「지난 판」으로 본다 (ms). 서버가 죽으면 파일만 남는다 */
const STALE_MS = 10 * 60 * 1000;

function file(projectId) {
  return path.join(store.projectDir(projectId), REL);
}

function write(projectId, data) {
  try {
    const p = file(projectId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) { /* 진행을 못 적는 것이 스캔을 죽이면 안 된다 */ }
  return data;
}

/**
 * 읽기를 시작한다.
 * @param {string[]} names 읽을 파일 이름 — **읽기 전에** 정한다.
 *   나중에 세면 못 읽은 파일이 빠져 분모가 줄고, 100% 인데 빠진 것이 생긴다.
 */
function begin(projectId, names) {
  const list = Array.isArray(names) ? names.map(String) : [];
  return write(projectId, {
    at: kstStamp(),
    startedMs: Date.now(),
    total: list.length,
    queued: list,
    done: [],
    running: true,
    finishedAt: null,
  });
}

/** 지금 것을 읽는다. 없으면 null */
function read(projectId) {
  try {
    const raw = fs.readFileSync(file(projectId), 'utf8');
    const j = JSON.parse(raw);
    return (j && typeof j === 'object') ? j : null;
  } catch (_) { return null; }
}

/**
 * 파일 하나가 끝났다.
 * @param {{name:string, ok:boolean, facts?:number, ms?:number, why?:string, ocr?:boolean}} row
 */
function fileDone(projectId, row) {
  const cur = read(projectId);
  if (!cur || !cur.running) return cur;
  const done = (cur.done || []).slice();
  done.push({
    name: String((row && row.name) || ''),
    ok: !!(row && row.ok),
    facts: Number((row && row.facts) || 0),
    ms: Number((row && row.ms) || 0),
    ocr: !!(row && row.ocr),
    why: (row && row.why) || null,
  });
  cur.done = done;
  cur.at = kstStamp();
  return write(projectId, cur);
}

/** 다 읽었다. **끝났다는 사실을 반드시 적는다** — 안 적으면 화면이 영원히 돈다 */
function finish(projectId, summary) {
  const cur = read(projectId) || { total: 0, done: [], queued: [] };
  cur.running = false;
  cur.at = kstStamp();
  cur.finishedAt = Date.now();
  cur.summary = summary || null;
  return write(projectId, cur);
}

/**
 * 화면이 그대로 그릴 수 있는 꼴로 만든다. **여기 한 곳에서만 센다** —
 * 화면과 서버가 따로 세면 두 곳이 다른 수를 말하는 날이 온다.
 *
 * ★ `pct` 는 **센 수**다. 어림이 아니다. 분모를 모르면 `null` 을 준다 —
 *   0% 로 적으면 「안 되고 있다」로 읽힌다 (모르는 것과 다르다).
 */
function view(projectId) {
  const cur = read(projectId);
  if (!cur) return { known: false };
  const done = (cur.done || []).length;
  const total = Number(cur.total || 0);
  const age = Date.now() - Number(cur.startedMs || 0);
  /* ★ 서버가 도중에 죽으면 파일만 남아 **영원히 「읽는 중」**이 된다.
   *   오래된 것은 도는 중으로 세지 않는다 — 「모른다」가 사실이다 */
  const stale = !!cur.running && age > STALE_MS;
  return {
    known: true,
    running: !!cur.running && !stale,
    stale,
    total,
    done,
    ok: (cur.done || []).filter(x => x.ok).length,
    failed: (cur.done || []).filter(x => !x.ok).length,
    facts: (cur.done || []).reduce((a, x) => a + Number(x.facts || 0), 0),
    ocr: (cur.done || []).filter(x => x.ocr).length,
    pct: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null,
    last: done ? cur.done[done - 1] : null,
    rows: cur.done || [],
    /* ★★★ **읽을 차례를 그대로 넘긴다** 〈2026-08-29 사장님 지시 · D-177〉.
     *   화면이 「한 개씩 읽는 과정」을 펴려면 **끝난 것**만으로는 모자란다 —
     *   아직 안 읽힌 이름이 있어야 「무엇이 남았나」를 그릴 수 있다.
     *   ★ 이것은 `begin()` 이 **읽기 전에** 정한 목록이라, 도중에 줄거나 늘지 않는다. */
    queued: cur.queued || [],
    at: cur.at || null,
    finished: !cur.running,
  };
}

module.exports = { begin, fileDone, finish, read, view, REL, STALE_MS };
