'use strict';
/**
 * hidden.js — **목록에서 접어 두기** 〈2026-08-24 사장님: 「지난 리스트는
 * 삭제해줘 목록에서 혼란스러움」〉.
 *
 * ★★★ **지우지 않고 접는다.** 사장님이 고르신 길이다.
 *
 *   고르는 목록에 스무 개가 넘게 쌓여 있었다 — 시험하며 만든 것과
 *   앱에서 가져온 실제 딜(서창산업/CB발행 · 금호클래식카 …)이 **섞여** 있다.
 *   지우면 그 안의 자료와 만든 보고서까지 함께 사라지고 **되돌릴 수 없다.**
 *
 * ★ 그래서 접기만 한다. 폴더도 자료도 보고서도 그대로 있고, 「지난 것 보기」로
 *   언제든 되돌아온다. **지운 것이 아니라는 것을 화면이 말해야 한다.**
 *
 * ★ 접힌 목록은 **프로젝트 폴더 밖**에 둔다. 폴더 안에 두면 폴더를 옮기거나
 *   다시 만들 때 접힘이 따라오거나 사라지는데, 둘 다 놀랍다.
 *
 * ★ 실패해도 던지지 않는다 (§4.6). 목록을 못 읽는다고 화면이 죽으면 안 된다 —
 *   그때는 **아무것도 안 접힌 것으로** 본다. 접히는 것보다 보이는 쪽이 안전하다.
 */

const fs = require('fs');
const path = require('path');

const { kstStamp } = require('./kst');

const FILE = 'hidden.json';

function root() {
  return process.env.IM_AGENT_ROOT || path.join(__dirname, '..', '..', 'im-projects');
}

function file() { return path.join(root(), FILE); }

/** 접어 둔 것 `{id: 접은시각}`. **절대 던지지 않는다** */
function map() {
  try {
    const v = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v.items)) {
      /* 배열로 적힌 옛 판도 읽어 준다 — 못 읽는 것보다 낫다 */
      if (v && Array.isArray(v.items)) {
        const out = {};
        v.items.forEach((id) => { if (typeof id === 'string') out[id] = null; });
        return out;
      }
      return {};
    }
    const out = {};
    Object.keys(v.items || {}).forEach((k) => { out[k] = v.items[k]; });
    return out;
  } catch (_) {
    return {};   // 없거나 깨졌으면 아무것도 안 접힌 것으로 본다
  }
}

/** 접어 둔 프로젝트 id 목록 */
function list() { return Object.keys(map()); }

/** 이 프로젝트가 접혀 있는가 */
function isHidden(id) {
  return Object.prototype.hasOwnProperty.call(map(), String(id || ''));
}

function write(items) {
  const dir = root();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.hidden-${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2), 'utf8');
  fs.renameSync(tmp, file());
}

/**
 * 접거나 편다.
 * @returns {boolean} 실제로 바뀌었는가. 실패해도 `false` 를 돌려주고 던지지 않는다
 */
function set(id, hidden) {
  const key = String(id || '').trim();
  if (!key) return false;
  try {
    const items = map();
    const had = Object.prototype.hasOwnProperty.call(items, key);
    if (hidden && had) return false;
    if (!hidden && !had) return false;
    if (hidden) items[key] = kstStamp();
    else delete items[key];
    write(items);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { FILE, root, file, map, list, isHidden, set, write };
