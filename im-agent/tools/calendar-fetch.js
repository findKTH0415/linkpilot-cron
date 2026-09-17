#!/usr/bin/env node
'use strict';
/**
 * calendar-fetch.js — 특일정보를 **열쇠가 있는 자리에서** 받아 결과만 남긴다.
 *
 * 〈2026-09-12 사장님 지시: 「특일정보 API 를 붙여라」 · D-206 결정〉
 *
 * ## 왜 이렇게 하나 (CLAUDE.md §4)
 *
 * Secrets 는 다시 읽을 수 없다. 그래서 **키를 꺼내는 대신, 키가 있는 자리(Actions)에서
 * 대신 호출하고 결과만 커밋**한다. 키는 저장소 밖으로 안 나가고 로그에도 안 남는다.
 *
 * ★ 이 저장소는 **공개**다 (D-10). 그래서 쓰기 전에 **결과에 열쇠가 섞이지 않았는지**
 *   세고, 걸리면 **파일을 안 쓰고 빨갛게 끝낸다** — `api-report.js` 와 같은 방식이다.
 *
 * ## 무엇을 남기나
 *
 *   data/_calendar/<연도>.json   그 해의 공휴일·24절기·잡절·기념일
 *   data/_calendar/_summary.md   사람이 읽는 요약 (§4 「_summary.md 를 반드시 만든다」)
 *
 * ★★ **「진단이 통째로 죽은 것」과 「한 갈래가 실패한 것」을 갈라 적는다** (§4).
 *   뭉뚱그리면 무엇을 못 받았는지 사라진다.
 *
 * 쓰기: node im-agent/tools/calendar-fetch.js [시작연도] [끝연도]
 *       (기본: 올해부터 5년치 — 표가 떨어지기 전에 넉넉히 받아 둔다)
 */

const fs = require('fs');
const path = require('path');
const kasi = require('../connectors/kasi');

const OUT = path.join(__dirname, '..', '..', 'data', '_calendar');

/** 결과 본문에 열쇠 값이 섞였는지 센다 — 이름만 말하고 값은 안 찍는다 (§2) */
function leaks(text) {
  const hits = [];
  for (const [name, v] of Object.entries(process.env)) {
    if (!v || String(v).length < 12) continue;              /* 짧으면 우연히 겹친다 */
    if (!/KEY|TOKEN|SECRET|PASS|OC$/i.test(name)) continue;
    if (text.indexOf(v) >= 0) hits.push(name);
  }
  return hits;
}

function pad(n) { return String(n).padStart(2, '0'); }

async function main() {
  const now = new Date();
  const from = Number(process.argv[2]) || now.getFullYear();
  const to = Number(process.argv[3]) || (from + 4);

  if (!kasi.isAvailable()) {
    console.log('⚠ DATA_GO_KR_KEY 가 없다 — **못 받았다** (통과가 아니다).');
    console.log('  이 도구는 열쇠가 있는 자리(GitHub Actions)에서 돌아야 뜻이 있다 (§4.3).');
    process.exit(2);                                        /* 못 잰 것은 실패와 다르다 */
  }

  fs.mkdirSync(OUT, { recursive: true });
  const rows = [];
  let hardFail = 0;

  for (let y = from; y <= to; y++) {
    const r = await kasi.year(y);
    if (r.unavailable) { console.log('⚠ ' + r.error); process.exit(2); }

    const errs = (r.errors || []);
    /* ★★★ 「아직 공표 안 됨」을 실패로 세지 않는다 (§12-12 와 같은 결).
     *   서버가 멀쩡히 대답했는데 그 해 자료가 0건인 것은 **우리가 고칠 자리가 없다.**
     *   실패로 세면 날마다 빨개지고, 그 빨강이 「활용신청을 또 하라」로 읽힌다. */
    if (r.empty) {
      console.log(`◦ ${y}년 — 서버는 대답했는데 그 해 자료가 아직 없다 (공표 전 · 고칠 것 없음)`);
      rows.push({ year: y, ok: false, empty: true, count: 0, errors: [] });
      continue;
    }
    if (!r.ok) {
      /* ★ 한 해를 통째로 못 받은 것 — 갈래 실패와 갈라 적는다 */
      hardFail++;
      console.log(`✗ ${y}년 — 한 건도 못 받았다`);
      for (const e of errs) console.log(`    ${e.label}: ${e.head || e.error}`);
      rows.push({ year: y, ok: false, count: 0, errors: errs });
      continue;
    }

    const body = JSON.stringify({ year: y, fetchedAt: new Date().toISOString(), items: r.value }, null, 1);
    const bad = leaks(body);
    if (bad.length) {
      console.log('❌ 결과에 열쇠 값이 섞였다 — 파일을 안 쓴다: ' + bad.join(' · '));
      process.exit(1);
    }
    fs.writeFileSync(path.join(OUT, `${y}.json`), body + '\n');

    const byKind = {};
    for (const it of r.value) byKind[it.label] = (byKind[it.label] || 0) + 1;
    rows.push({ year: y, ok: true, count: r.value.length, byKind, errors: errs,
      /* 사람이 눈으로 볼 대표값 — 이 둘이 맞으면 대체로 맞는다 */
      seollal: (r.value.find((v) => /설날/.test(v.name)) || {}).date || null,
      chuseok: (r.value.find((v) => /추석/.test(v.name)) || {}).date || null });
    console.log(`✓ ${y}년 — ${r.value.length}건 (설날 ${rows[rows.length - 1].seollal || '?'} · 추석 ${rows[rows.length - 1].chuseok || '?'})`);
    for (const e of errs) console.log(`    ⚠ ${e.label} 갈래만 실패: ${e.head || e.error}`);
  }

  /* ── 사람이 읽는 요약 (§4) ───────────────────────────────── */
  const L = [];
  L.push('# 특일정보 수집 요약');
  L.push('');
  L.push(`받은 때: ${new Date().toISOString()} · 대상 ${from}~${to}년`);
  L.push('');
  L.push('> 이 파일은 `npm run calendar:fetch` 가 만든다. 손으로 고치지 않는다 —');
  L.push('> 고쳐도 다음 수집에서 덮인다. 값이 이상하면 **API 쪽을 본다.**');
  L.push('');
  L.push('| 연도 | 받음 | 건수 | 설날 | 추석 | 못 받은 갈래 |');
  L.push('|---|---|---:|---|---|---|');
  for (const r of rows) {
    L.push(`| ${r.year} | ${r.ok ? '✓' : r.empty ? '◦ 공표 전' : '✗'} | ${r.count} | ${r.seollal || '—'} | ${r.chuseok || '—'} | `
      + `${(r.errors || []).map((e) => e.label).join(' · ') || '없음'} |`);
  }
  L.push('');
  const failed = rows.filter((r) => !r.ok && !r.empty);
  const empty = rows.filter((r) => r.empty);
  const partial = rows.filter((r) => r.ok && (r.errors || []).length);
  if (empty.length) {
    L.push(`◦ **아직 공표되지 않은 해가 ${empty.length}개** 있다 — ${empty.map((r) => r.year).join(' · ')}.`);
    L.push('  서버는 대답했고 오류도 없었다. **못 받은 것이 아니라 아직 없는 것**이라 고칠 자리가 없다 —');
    L.push('  공휴일은 해마다 관보로 확정된 뒤에 이 API 에 실린다. 다음 수집에서 저절로 채워진다.');
  }
  if (failed.length) {
    L.push(`★ **통째로 못 받은 해가 ${failed.length}개** 있다 — ${failed.map((r) => r.year).join(' · ')}.`);
    L.push('  이 해들은 **없는 것**이지 「명절이 없는 해」가 아니다.');
  }
  if (partial.length) {
    L.push(`★ 받았지만 **일부 갈래가 빠진 해가 ${partial.length}개** 있다.`);
    L.push('  「통째로 못 받은 것」과 다른 사실이라 갈라 적는다.');
  }
  if (!failed.length && !partial.length && !empty.length) L.push('빠진 것 없음.');
  const summary = L.join('\n') + '\n';
  const badS = leaks(summary);
  if (badS.length) { console.log('❌ 요약에 열쇠 값이 섞였다 — 안 쓴다: ' + badS.join(' · ')); process.exit(1); }
  fs.writeFileSync(path.join(OUT, '_summary.md'), summary);

  console.log('');
  const gotN = rows.filter((r) => r.ok).length;
  const emptyN = rows.filter((r) => r.empty).length;
  console.log(`요약: data/_calendar/_summary.md · 받은 해 ${gotN}/${rows.length}`
    + (emptyN ? ` (그중 ${emptyN}개는 «아직 공표 전» — 못 받은 것이 아니다)` : ''));
  process.exit(hardFail ? 1 : 0);
}

if (require.main === module) main().catch((e) => { console.log('✗ ' + e.message); process.exit(1); });
module.exports = { leaks };
