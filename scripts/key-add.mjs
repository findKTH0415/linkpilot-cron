// scripts/key-add.mjs
// ↑ 첫 글자는 반드시 "//" 다.
//
// 새 열쇠 이름을 «따라가는 자리 일곱»에 한 번에 단다 〈2026-10-17 · 사장님: 「유사하게 반복적이고 동일한 패턴 요구 업무지침은
//   별도의 업무지침이 없더라도 개선하고 향후 지속적인 업데이트 구조에서 반영되도록」〉
//
// [왜] 「○○ 키 넣었어」가 하루에 셋 왔고, 매번 손으로 일곱 자리를 달다가 한 자리(배포 NAMES)를 빠뜨렸다 — secrets.test.js 가 잡았다.
//   빠지면 «아무 오류 없이 조용히» 값이 죽는다 (CLAUDE.md §4 · §12-25). 사람의 기억에 얹지 않는다 (§8 의 guard 와 같은 결).
// [무엇을] ① 가림 SECRET_ENV(http.js) ② 진단 env(api-smoke.yml 전부) ③ 진단 목록(fsc-probe 의 서비스·검색 줄 + 이름 목록)
//   ④ 배포 env(deploy-nas.yml) ⑤ 배포 NAMES ⑥ key-presence ⑦ 지침서 인벤토리 표 · 관리대장 줄
// [어떻게] 이미 있는 이름(`KOTRA_KOREA_FDI_BY_INDUSTRY`)을 닻으로 삼아 그 바로 뒤에 끼운다. 이미 그 자리에 이름이 있으면 건너뛴다(두 번 돌려도 같다).
// ★ 값은 받지 않는다 — 이름만 다룬다 (§2). 서비스 번호를 모르면 지어내지 않고 포털 검색 줄로 단다 (§4.3).
//
// 쓰는 법:
//   node scripts/key-add.mjs --name MSS_BUSINESS_SUPPORT_ANNOUNCEMENTS --said "MSS_Business_Support_Announcements" \
//     --org "중소벤처기업부" --service "중소벤처기업부_사업공고" --use "투자정보 [정책자금] 후보" [--id 15113297] [--keyword "…" --word "…"]
import { readFile, writeFile } from 'node:fs/promises';

const A = Object.fromEntries(process.argv.slice(2).reduce((o, x, i, a) => (x.startsWith('--') ? o.concat([[x.slice(2), a[i + 1]]]) : o), []));
const NAME = String(A.name || '').toUpperCase();
if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(NAME)) { console.error('✗ --name 이 열쇠 이름 모양이 아니다 (대문자·숫자·밑줄)'); process.exit(2); }
for (const k of ['org', 'service', 'use']) if (!A[k]) { console.error('✗ --' + k + ' 가 없다'); process.exit(2); }
const DATE = A.date || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // Asia/Seoul 날짜 (§5)
const SAID = A.said || NAME;
const ANCHOR = 'KOTRA_KOREA_FDI_BY_INDUSTRY';
const note = `〈${DATE} 사장님: 「${A.service}(${SAID}) 키넣었어」〉`;
const done = []; let miss = 0;

async function edit(file, label, fn) {
  const s = await readFile(file, 'utf8');
  const t = fn(s);
  if (t === null) { done.push(`  · ${label} — 이미 있다 (건너뜀)`); return; }
  if (t === s) { done.push(`  ✗ ${label} — 닻(${ANCHOR})을 못 찾았다. 손으로 단다`); miss++; return; }
  await writeFile(file, t); done.push(`  ✓ ${label}`);
}
const has = (s, re) => re.test(s);
const afterLine = (s, re, mk) => s.replace(re, (m, ...g) => m + '\n' + mk(m, ...g));

// ① 가림
await edit('im-agent/connectors/http.js', '① 가림 SECRET_ENV', s => has(s, new RegExp(`'${NAME}'`)) ? null
  : afterLine(s, new RegExp(`^  '${ANCHOR}',[^\\n]*$`, 'm'), () => `  '${NAME}', // ★ ${A.org} ${A.service} ${note}`));
// ② 진단 env · ④ 배포 env (같은 닻 줄 뒤 · 들여쓰기 그대로)
/* ★ 닻 줄마다 따로 본다 — 한 잡에만 달린 «반쯤 된» 상태도 나머지 잡을 채운다 (Codex #241). 바로 다음 줄이 이미 그 이름이면 그 자리는 건너뛴다 */
const envFn = s => { const t = s.replace(new RegExp(`^( +)${ANCHOR}:\\s*\\$\\{\\{ secrets\\.${ANCHOR} \\}\\}$(?!\\n +${NAME}:)`, 'gm'), (m, sp) => `${m}\n${sp}${NAME}: \${{ secrets.${NAME} }}`);
  return t === s && has(s, new RegExp(`^\\s+${NAME}:`, 'm')) ? null : t; };
await edit('.github/workflows/api-smoke.yml', '② 진단 env (api-smoke 의 잡 전부)', envFn);
await edit('.github/workflows/deploy-nas.yml', '④ 배포 env', envFn);
// ⑤ 배포 NAMES — 닻 낱말 뒤에 한 칸
await edit('.github/workflows/deploy-nas.yml', '⑤ 배포 NAMES', s => {
  const i = s.search(/NAMES="GEMINI_API_KEY /); if (i < 0) return s;
  const j = s.indexOf('"', i + 7); const line = s.slice(i, j);
  if (line.split(/\s+/).includes(NAME)) return null;
  return s.slice(0, i) + line.replace(new RegExp(`\\b${ANCHOR}\\b`), `${ANCHOR} ${NAME}`) + s.slice(j);
});
// ③ 진단 목록 — 서비스 번호를 알면 SERVICES, 모르면 SEARCHES · 그리고 이름 목록
/* ★ 서비스·검색 줄과 이름 목록을 «따로» 본다 — 한쪽만 있는 반쯤 된 상태도 나머지를 채운다 (Codex #241).
     이름 목록에 없으면 진단이 그 열쇠를 «없다»로 적고, 서비스 줄이 없으면 그 열쇠를 아예 안 잰다 */
await edit('scripts/fsc-probe.mjs', '③ 진단 목록 (fsc-probe)', s => {
  const hasRow = has(s, new RegExp(`key: '${NAME}'`));
  const listRe = /^  for \(const n of \[[^\n]*$/m; const lm = s.match(listRe);
  const hasList = !!(lm && lm[0].includes(`'${NAME}'`));
  if (hasRow && hasList) return null;
  let t = s;
  if (!hasRow) {
    if (A.id) {
      t = afterLine(t, /^  \{ key: 'FSC_AMC_API', id: '15139266'[^\n]*$/m, () =>
        `  /* ★ ${note} — 서비스 이름을 받았다 */\n  { key: '${NAME}', id: '${A.id}', name: '${A.service}', use: '${A.use}' },`);
    } else {
      const kw = A.keyword || A.service.replace(/_/g, ' '); const w = A.word || A.service.split('_').pop().slice(0, 4);
      t = afterLine(t, new RegExp(`^  \\{ key: '${ANCHOR}', keyword: '대한무역투자진흥공사 외국인직접투자'[^\\n]*$`, 'm'), () =>
        `  /* ★ ${note} — 번호를 못 들었으므로 포털 검색에서 찾는다 (번호를 지어내지 않는다) */\n  { key: '${NAME}', keyword: '${kw}', word: '${w}', use: '${A.use}' },`);
    }
    if (t === s) return s; // 닻을 못 찾았다 — 손으로
  }
  if (!hasList) { const u = t.replace(listRe, line => line.replace(`'${ANCHOR}'`, `'${ANCHOR}', '${NAME}'`)); if (u === t) return s; t = u; }
  return t;
});
// ⑥ key-presence
await edit('scripts/key-presence.mjs', '⑥ key-presence', s => has(s, new RegExp(`'${NAME}'`)) ? null
  : s.replace(`'${ANCHOR}']`, `'${ANCHOR}'], ['${A.service.replace(/_/g, ' ')}', '${NAME}']`));
// ⑦ 지침서 표 · 관리대장
await edit('docs/운영지침-공공API-활용.md', '⑦ 지침서 인벤토리 표', s => has(s, new RegExp('`' + NAME + '`')) ? null
  : afterLine(s, new RegExp('^\\| `' + ANCHOR + '` \\|[^\\n]*$', 'm'), () =>
    `| \`${NAME}\` | **공공데이터포털 ${A.org}** — ${A.service} 〈${DATE} 사장님이 \`${SAID}\` 로 넣으셨다 · GitHub 은 대문자로 저장한다〉. ${A.id ? '서비스 번호 ' + A.id : '서비스 번호는 진단이 포털 검색으로 찾는다'} · 규격 미측정. ${A.use}. |`));
await edit('docs/미결정-사항.md', '⑦ 관리대장 줄', s => has(s, new RegExp('`' + NAME + '`')) ? null
  : s.replace('`' + ANCHOR + '`', '`' + ANCHOR + '` · `' + NAME + '`'));

console.log(`\n열쇠 이름 ${NAME} — 따라가는 자리\n` + done.join('\n'));
console.log(miss ? `\n✗ 손으로 달아야 하는 자리 ${miss}` : '\n✓ 다음: node --test im-agent/test/secrets.test.js im-agent/test/api-guide.test.js');
process.exit(miss ? 1 : 0);
