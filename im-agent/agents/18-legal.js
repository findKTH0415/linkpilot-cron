'use strict';
/**
 * 18 Legal & Permit Agent — 인허가·법률 검토 (D-113)
 *
 * ★★ **이 Agent 가 메우는 구멍은 이미 코드에 표시돼 있었다.**
 *   `07_geo` 가 용적률·건폐율 상한을 **국토계획법 시행령**에서 채우고,
 *   `09_massing` 이 그 값에 「지자체 조례 확인 필요」라는 쪽지를 붙여 왔다.
 *   그 쪽지를 **아무도 떼지 않았다** — 확인하는 사람이 없었기 때문이다.
 *
 *   CLAUDE.md §4.1: 「**시행령 상한을 조례 한도로 쓰지 않는다.** 용적률·건폐율의
 *   실제 한도는 조례가 정한다 — `law.ordinance()` 로 그 조례를 찾아 근거를 붙인다.」
 *
 * ★★★ **한도 숫자를 짓지 않는다.** `law.ordinance()` 가 주는 것은 조례 **후보
 *   목록**이지 용적률 값이 아니다. 조례 본문에서 숫자를 긁어 오는 것은 할 수는
 *   있지만 **틀렸을 때 문서만 봐서는 안 잡힌다** — 값은 멀쩡히 들어가고 출처
 *   표시도 멀쩡하다. 그래서 이 Agent 는
 *
 *     · 지금 쓰는 한도가 **어디서 온 값인지** 밝히고
 *     · 그것이 시행령 값이면 **조례로 확인해야 한다고 깃발을 든다**
 *     · 조례 후보를 **사람에게 내민다** (§4.9 — 자동으로 하나를 고르지 않는다)
 *
 *   메우지 않는 것이 이 Agent 의 값이다. 메우면 「적용됨」만 남고 무엇이
 *   빠졌는지 사라진다 (지침 §4).
 *
 * ★ `facts` 는 **항상 빈 배열이다.** 조문은 읽은 것이지만 이 Agent 가 내는 것은
 *   「값」이 아니라 「그 값을 아직 확인 못 했다」는 사실이다. 값을 내면 그 순간
 *   09_massing 과 **같은 수를 두 곳에서** 갖게 된다 (지침 §1-3).
 *
 * ★ `LAW_OC` 가 없으면 `unavailable` 로 그 절을 비운다. 지어내지 않는다 (§4.6).
 *   ★★ 그리고 **왜 비었는지**를 적는다 — 조용히 빠지면 사람은 고장으로 읽고
 *      없는 고장을 찾으러 간다 (지침 §4).
 *
 * 전부 결정적 대조다. LLM 미사용.
 */

const law = require('../connectors/law');
const store = require('../core/store');

/** 지번 주소에서 지자체(시·군·구)를 뽑는다. 못 뽑으면 null — 짐작하지 않는다 */
function regionOf(address) {
  if (!address) return null;
  const s = String(address).trim();
  // 「서울특별시 서초구 …」 · 「경기도 성남시 분당구 …」 꼴에서 앞 둘~셋을 집는다.
  // ★ 광역시·특별시는 두 토막(시 + 구), 도는 세 토막(도 + 시 + 구)이다.
  const parts = s.split(/\s+/);
  if (parts.length < 2) return null;
  const wide = parts[0];
  if (/(특별시|광역시|특별자치시|특별자치도)$/.test(wide)) {
    return /(구|군)$/.test(parts[1]) ? `${wide} ${parts[1]}` : wide;
  }
  if (/도$/.test(wide)) {
    // 도 → 시/군 → (있으면) 구. 조례는 시 단위가 대부분이라 시/군까지만 쓴다.
    if (parts[1] && /(시|군)$/.test(parts[1])) return `${wide} ${parts[1]}`;
    return null;
  }
  return null;
}

const inputSchema = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string' },
    geo: { type: 'object', nullable: true },
    massing: { type: 'object', nullable: true },
  },
};

const outputSchema = {
  type: 'object',
  required: ['facts', 'flags', 'status'],
  properties: {
    // ★ 값을 내지 않는다 (D-96 · 지침 §1-3). 스키마가 강제한다 —
    //   주석으로만 적으면 다음 사람이 채운다 (지침 §1-2).
    facts: { type: 'array', maxItems: 0 },
    flags: { type: 'array' },
    status: { type: 'string', enum: ['reviewed', 'unavailable'] },
    /** 지금 쓰는 한도가 어디서 왔는가 — 값이 아니라 **출처의 갈래**다 */
    limitBasis: { type: 'object', nullable: true },
    /** 사람이 골라야 하는 조례 후보 (§4.9) */
    ordinanceCandidates: { type: 'array' },
    /** 왜 못 봤는지 — 비어 있을 때 사람이 헤매지 않게 (지침 §4) */
    unavailableReason: { type: 'string', nullable: true },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

function flag(severity, type, message, extra = {}) {
  return { severity, type, message, agent: '18_legal', ...extra };
}

async function run(input, ctx = {}) {
  const log = ctx.log || (() => {});
  const flags = [];
  const projectId = input.projectId;

  /* ── 어느 지자체인가 ──────────────────────────────────────
   * 주소가 없으면 조례를 찾을 방법이 없다. **짐작하지 않는다.** */
  const ds = store.dataset ? store.dataset(projectId) : null;
  const addrFact = ds && ds.get ? ds.get('project.location') : null;
  const address = (input.geo && input.geo.geo && input.geo.geo.address)
    || (addrFact ? String(addrFact.value) : null);
  const region = regionOf(address);

  /* ── 지금 쓰는 한도가 어디서 왔나 ─────────────────────────
   * 07_geo 가 시행령에서 채웠으면 그 출처 문자열에 「시행령」이 들어 있다. */
  const limitFact = ds && ds.get ? ds.get('land.far_limit') : null;
  const limitSource = limitFact ? String(limitFact.source || '') : null;
  const fromDecree = !!(limitSource && /시행령|국토계획법/.test(limitSource));
  const limitBasis = limitFact ? {
    key: 'land.far_limit',
    source: limitSource,
    // ★ 값을 옮겨 적지 않는다 — 같은 수를 두 곳에 두지 않는다 (지침 §1-3)
    kind: fromDecree ? 'decree' : (limitSource ? 'other' : 'unknown'),
    zoning: (input.geo && input.geo.landUse && input.geo.landUse.zone) || null,
  } : null;

  /* ── 열쇠가 없으면 여기서 멈춘다 ─────────────────────────
   * ★ 다만 **왜 멈췄는지**는 남긴다. 그리고 시행령 값을 쓰고 있다는 사실은
   *   열쇠와 무관하게 참이므로 그 깃발은 그대로 든다. */
  if (!law.isAvailable()) {
    const reason = `${law.OC_NAMES.join(' 또는 ')} 미설정 — 지자체 건축조례를 조회할 수 없다`;
    flags.push(flag('YELLOW', 'LEGAL_UNAVAILABLE',
      `${reason}. 용적률·건폐율 한도를 조례로 확인하지 못했다`));
    if (fromDecree) {
      flags.push(flag('YELLOW', 'ORDINANCE_UNVERIFIED',
        `용적률·건폐율 한도를 **시행령 값**으로 쓰고 있다 (${limitSource}). 실제 한도는 지자체 조례가 정한다 — 조례로 확인하기 전에는 이 한도를 「확정」으로 읽으면 안 된다 (CLAUDE.md §4.1)`));
    }
    log('  인허가·법률: 조회 생략 — 열쇠 미설정');
    return {
      facts: [], flags, status: 'unavailable',
      limitBasis, ordinanceCandidates: [], unavailableReason: reason,
      confidence: 0.2,
    };
  }

  if (!region) {
    const reason = address
      ? `주소에서 지자체를 못 가렸다: ${address}`
      : '주소가 없어 지자체를 가릴 수 없다';
    flags.push(flag('YELLOW', 'LEGAL_REGION_UNKNOWN',
      `${reason} — 조례는 지자체마다 다르므로 지자체를 특정하지 못하면 조회할 수 없다. **전국 값으로 대신하지 않는다** (§4.9)`));
    log(`  인허가·법률: ${reason}`);
    return {
      facts: [], flags, status: 'unavailable',
      limitBasis, ordinanceCandidates: [], unavailableReason: reason,
      confidence: 0.2,
    };
  }

  /* ── 조례를 찾는다 ───────────────────────────────────────
   * ★ 후보가 여럿이면 **고르지 않는다.** 내밀고 사람이 특정한다 (§4.9). */
  const r = await law.ordinance(region, '건축조례');
  const candidates = [];

  if (!r.ok) {
    const reason = r.error || '조례 조회 실패';
    flags.push(flag('YELLOW', 'ORDINANCE_NOT_FOUND',
      `${region} 의 건축조례를 못 찾았다 — ${reason}`));
  } else {
    for (const x of r.value) {
      candidates.push({ name: x.name, id: x.id, org: x.org, enforcedAt: x.enforcedAt });
    }
    if (r.ambiguous) {
      flags.push(flag('YELLOW', 'ORDINANCE_AMBIGUOUS',
        `${region} 의 건축조례 후보가 ${candidates.length}건이다 — 어느 것인지 **사람이 특정해야 한다.** 자동으로 하나를 고르면 틀렸을 때 문서만 봐서는 안 잡힌다 (§4.9)`));
    }
  }

  /* ── 시행령 값을 쓰고 있으면 그것을 말한다 ──────────────
   * ★★ 조례를 **찾았다고 해서 확인된 것이 아니다.** 조례 본문의 용적률 표를
   *   읽어 한도를 정하는 것은 사람의 일이다. 여기서 「확인됨」으로 바꾸면
   *   찾기만 하고 안 읽은 것이 확인된 것처럼 남는다. */
  if (fromDecree) {
    flags.push(flag('YELLOW', 'ORDINANCE_UNVERIFIED',
      candidates.length
        ? `용적률·건폐율 한도를 **시행령 값**으로 쓰고 있다 (${limitSource}). 실제 한도는 조례가 정한다 — 아래 조례에서 해당 용도지역의 한도를 확인해야 한다: ${candidates.map(c => c.name).filter(Boolean).join(' · ')}`
        : `용적률·건폐율 한도를 **시행령 값**으로 쓰고 있다 (${limitSource}). 실제 한도는 조례가 정하는데 그 조례를 아직 못 찾았다`));
  } else if (!limitFact) {
    flags.push(flag('YELLOW', 'LEGAL_LIMIT_MISSING',
      '용적률 한도가 아직 채워지지 않았다 — 조례 대조의 대상이 없다'));
  }

  log(`  인허가·법률: ${region} · 조례 후보 ${candidates.length}건`
    + (fromDecree ? ' · 한도는 아직 시행령 값' : ''));

  return {
    facts: [], flags, status: 'reviewed',
    limitBasis,
    ordinanceCandidates: candidates,
    unavailableReason: null,
    // ★ 조례를 「찾은 것」이지 「읽은 것」이 아니다 — 확신을 높게 두지 않는다
    confidence: candidates.length && !fromDecree ? 0.7 : 0.5,
  };
}

module.exports = { id: '18_legal', label: 'Legal & Permit Agent', inputSchema, outputSchema, run, regionOf };
