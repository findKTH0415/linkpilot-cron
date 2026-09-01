// scripts/sacheon-law-fetch.mjs
// ↑ 첫 글자는 반드시 "//" 다. "name:" 으로 시작하면 워크플로 내용이 잘못 들어간 것이다. (규정집 3장)
//
// 목적 : 주택법·주택법 시행령의 도시형생활주택 세대수 조문과 시행일을 원문으로 확보한다.
//        2026-08-20 본회의 통과 보도(신뢰등급 C)를 조문 원문(등급 A/B)으로 승급시키는 것이 이 스크립트의 존재 이유다.
// 키   : LAW_OC (계정 ID · 키 아님, 규정집 4-A) / LAW_OPEN_DATA (인증값 · 규격 미확인)

import { mkdir, writeFile } from 'node:fs/promises';

const OUT = 'data/law';
await mkdir(OUT, { recursive: true });              // ★ 6-1 무엇보다 먼저

const log = [];
const P = (s = '') => { log.push(s); };
const save = async () => { await writeFile(`${OUT}/_summary.md`, log.join('\n')); };
const today = new Date().toISOString().slice(0, 10);

P('# 주택법 도시형생활주택 조문 수집');
P('');
P(`조회일 ${today}`);
P('');

// ── 0. 키 확인 ──────────────────────────────────────────────
const OC = process.env.LAW_OC;
const AUTH = process.env.LAW_OPEN_DATA;             // 현재 규격 미확인. 존재만 기록한다.
if (!OC) {
  P('## 중단 — LAW_OC 없음');
  P('LAW_OC 는 인증키가 아니라 국가법령정보 Open API 신청 시 등록한 **계정 ID** 다. (규정집 4-A)');
  P('워크플로의 `env:` 이름과 저장소 Secret 이름이 대소문자까지 일치하는지 확인. (2-3)');
  await save();                                      // ★ 6-6 중단해도 남긴다
  process.exit(1);
}
P(`- LAW_OC 주입됨 · LAW_OPEN_DATA ${AUTH ? '주입됨(미사용 — 규격 확인 필요)' : '미주입'}`);
P('');

// ── 1. 베이스 경로 판별 ─────────────────────────────────────
const BASES = ['https://www.law.go.kr/DRF', 'https://law.go.kr/DRF'];   // ★ 6-4
let BASE = null;
for (const b of BASES) {
  const q = new URLSearchParams({ OC, target: 'law', type: 'JSON', query: '주택법', display: '5' });
  try {
    const r = await fetch(`${b}/lawSearch.do?${q}`);
    const t = await r.text();
    await writeFile(`${OUT}/_probe_${b.replace(/[^a-z]/gi, '_')}.txt`, t.slice(0, 4000));
    P(`- 프로브 \`${b}\` → HTTP ${r.status} · ${t.length}바이트`);   // ★ 6-3 · 6-5 키는 안 찍는다
    if (r.status === 200 && t.trim().startsWith('{')) { BASE = b; break; }
  } catch (e) {
    P(`- 프로브 \`${b}\` → 네트워크 실패 (${e.name})`);
    P('  > 분석 샌드박스에서 실행하면 `403 host_not_allowed` 가 난다. 반드시 Actions에서 돌린다. (규정집 1장)');
  }
}
if (!BASE) { P(''); P('## 중단 — 유효한 베이스 경로 없음'); await save(); process.exit(1); }
P('');

// ── 2. 법령 목록 조회 (현행 + 시행예정) ─────────────────────
const targets = [
  { target: 'law',   name: '현행법령' },
  { target: 'eflaw', name: '시행일법령(시행예정 포함)' },
];
const found = [];

for (const t of targets) {
  for (const query of ['주택법', '주택법 시행령']) {
    const q = new URLSearchParams({ OC, target: t.target, type: 'JSON', query, display: '20' });
    const r = await fetch(`${BASE}/lawSearch.do?${q}`);
    const raw = await r.text();
    const fname = `list_${t.target}_${query.replace(/\s/g, '')}.json`;
    await writeFile(`${OUT}/${fname}`, raw);          // ★ 6-2 원문 먼저
    P(`- 목록 \`${t.name} / ${query}\` → HTTP ${r.status} · ${fname}`);

    let j = null;
    try { j = JSON.parse(raw); } catch { P('  > JSON 파싱 실패. 원문 파일을 직접 확인한다.'); continue; }
    const box = j.LawSearch ?? j.lawSearch ?? j;
    const items = box?.law ?? box?.Law ?? [];
    const arr = Array.isArray(items) ? items : items ? [items] : [];
    if (arr.length === 0) { P('  > 빈 응답 — 수집 실패로 기록한다. (7-5)'); continue; }
    for (const it of arr) {
      found.push({
        target: t.target,
        name: it.법령명한글 ?? it['법령명한글'] ?? '',
        mst: it.법령일련번호 ?? it.MST ?? '',
        공포일자: it.공포일자 ?? '',
        시행일자: it.시행일자 ?? '',
        제개정구분: it.제개정구분명 ?? '',
      });
    }
  }
}

P('');
P(`목록 수집 **${found.length}건**`);
if (found.length === 0) { P('> 전량 빈 응답. 중단한다.'); await save(); process.exit(1); }

P('');
P('| 구분 | 법령명 | 공포일자 | 시행일자 | 제개정 |');
P('|---|---|---|---|---|');
for (const f of found.slice(0, 30)) {
  P(`| ${f.target} | ${f.name} | ${f.공포일자} | ${f.시행일자} | ${f.제개정구분} |`);
}
await writeFile(`${OUT}/law_index.json`, JSON.stringify(found, null, 2));

// ── 3. 본문 조회 및 도시형생활주택 조문 추출 ────────────────
const KEYS = ['도시형생활주택', '소형주택', '세대'];
const targetsToRead = found.filter(f => /^주택법( 시행령)?$/.test(f.name.trim()) && f.mst);
const seen = new Set();
P('');
P('## 조문 추출');

for (const f of targetsToRead) {
  const key = `${f.target}_${f.mst}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const q = new URLSearchParams({ OC, target: f.target, type: 'JSON', MST: String(f.mst) });
  const r = await fetch(`${BASE}/lawService.do?${q}`);
  const raw = await r.text();
  await writeFile(`${OUT}/body_${key}.json`, raw);    // ★ 6-2
  P(`- 본문 \`${f.name} (${f.target}, 시행 ${f.시행일자})\` → HTTP ${r.status} · body_${key}.json`);

  // 조문 텍스트에서 키워드 포함 문장만 뽑아 별도 파일로 남긴다.
  const hits = [];
  const walk = (node) => {
    if (node == null) return;
    if (typeof node === 'string') {
      if (KEYS[0] && node.includes(KEYS[0])) hits.push(node.trim());
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') { Object.values(node).forEach(walk); }
  };
  try { walk(JSON.parse(raw)); } catch { P('  > JSON 파싱 실패. 원문 확인 필요.'); }

  const uniq = [...new Set(hits)];
  await writeFile(`${OUT}/clause_${key}.md`,
    `# ${f.name} · ${f.target} · 시행 ${f.시행일자} · 공포 ${f.공포일자}\n\n조회일 ${today}\n\n` +
    (uniq.length ? uniq.map(s => `- ${s}`).join('\n\n') : '(도시형생활주택 문구 미검출)'));
  P(`  · '도시형생활주택' 포함 문구 ${uniq.length}건 → clause_${key}.md`);
}

// ── 4. 판정 메모 ────────────────────────────────────────────
P('');
P('## 판독 지침');
P('1. `law_index.json` 에서 **공포일자 2026-08 이후 · 시행일자가 미래인 항목**이 있는지 먼저 본다. 통과와 시행은 다르다.');
P('2. `clause_*.md` 에서 세대수 상한(300 / 500 / 700)과 **적용 용도지역 열거**를 확인한다.');
P('   제2종일반주거지역이 열거에 포함되는지가 사천 건의 분기점이다.');
P('3. 확인된 조문은 "법령명, 조·항·호, 시행일자, 조회일" 형식으로 인용한다. (규정집 10-3)');
P('4. 조문 원문을 확보하기 전까지 개정 관련 서술의 신뢰등급은 C 이며, 대외 문서 인용을 금한다.');

await save();
console.log(`완료 — ${OUT}/_summary.md`);
