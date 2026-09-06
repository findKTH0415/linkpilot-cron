#!/usr/bin/env node
'use strict';
/**
 * api-report.js — 실측 진단 결과를 **사람이 읽는 요약**으로 만든다.
 *
 * ★★★ 왜 만들었나 〈2026-09-01 · 사장님 「공공 API 활용 지침서」〉.
 *   지침서 §1 표의 **일곱이 「미검증」**이다. 검증이 안 되는 이유는 하나다 —
 *   **열쇠가 이 자리에 없다.** 열쇠는 GitHub Actions Secrets 와 NAS 에만 있고,
 *   Secrets 는 **다시 읽을 수 없다.**
 *
 *   그래서 지침서 §0 이 정한 길을 그대로 쓴다:
 *     열쇠가 있는 자리(Actions)에서 부르고 → **결과만 커밋**한다.
 *   `npm run im:smoke` 가 이미 26개 커넥터를 실제로 부른다. 이 도구는 그 출력을
 *   지침서 §7 이 요구하는 `_summary.md` 로 접는다.
 *
 * ★★ **이 저장소는 공개다** (D-10). 그래서 쓰기 전에 **열쇠가 섞였는지 직접 센다** —
 *   지침서 §9 마지막 줄(「결과 파일에 개인정보나 키가 섞이지 않는가」)을 사람 대신
 *   기계가 본다. 한 글자라도 걸리면 **파일을 안 쓰고 빨갛게 끝난다.**
 *   ★ 재는 방법이 어림이 아니다 — `process.env` 의 **실제 값**이 본문에 있는지 본다.
 *     모양으로 짐작하는 것보다 정확하고, 새 열쇠가 늘어도 저절로 따라온다.
 *
 * 쓰기:
 *   node im-agent/tools/api-report.js <진단출력.txt> [--out data/_api]
 *   npm run im:smoke > /tmp/s.txt 2>&1; node im-agent/tools/api-report.js /tmp/s.txt
 *
 * 되돌아오는 값: 0 정상 · 1 열쇠가 섞였다(파일 안 씀) · 2 읽을 진단 출력이 없다
 */

const fs = require('fs');
const path = require('path');

/** 지침서 §1 표 — 이름과 발급처. 값은 절대 담지 않는다 */
const KEYS = [
  ['DART_API_KEY', '금융감독원 전자공시', '기업 개황·재무제표·감사보고서'],
  ['REB_API_KEY', '한국부동산원 R-ONE', '상업용부동산 임대동향'],
  ['KOSIS_API_KEY', '통계청', '인구·가구·사회통계'],
  ['ECOS_API_KEY|ECOS_BOK_KEY', '한국은행', '금리·환율·통화 (이름 둘 다 읽는다)'],
  ['KEPCO_BIGDATA_KEY', '한국전력', '전력 사용량'],
  ['KMA_APIHUB_KEY', '기상청', '일사·일조 (태양광)'],
  ['DATA_GO_KR_KEY', '공공데이터포털', '실거래가·건축물대장·인허가 등'],
  ['LAW_OC|LAW_OPEN_DATA', '국가법령정보센터', '법령·조례 (이름 둘 다 읽는다)'],
  ['VWORLD_KEY', '브이월드', '지오코딩·지적·토지특성'],
  ['VWORLD_DOMAIN', '브이월드', '서비스URL — 키와 **짝**이라 둘 다 있어야 한다'],
  ['KRX_API_KEY', '한국거래소', '상장 시세 — 서비스 승인이 따로 필요'],
  ['PEXELS_API_KEY', 'Pexels', '무료 이미지'],
  ['KICT_API_KEY', '건설기술연구원', '건설 관련'],
];

/** 지침서 §4.2 — 상태코드만 보면 구분이 안 되는 것들을 응답 본문으로 가른다 */
const REASONS = [
  [/SERVICE_KEY_IS_NOT_REGISTERED_ERROR|활용신청이 필요/, '활용신청 안 됨', '그 API 에 활용신청을 하십시오 (키는 멀쩡합니다)'],
  [/NO_OPENAPI_SERVICE_ERROR/, '엔드포인트 없음', '주소가 폐기됐습니다 — 커넥터를 고쳐야 합니다'],
  [/미설정/, '키 없음', 'Secrets 에 등록되지 않았거나 이름이 다릅니다'],
  [/\b401\b|승인/, '승인 대기', '발급은 됐지만 서비스 이용신청 승인이 안 났습니다'],
  [/\b429\b|한도|quota/i, '한도 초과', '오늘 호출 한도를 넘겼습니다 — 내일 다시 잽니다'],
  [/타임아웃|timeout|ETIMEDOUT|ECONNRESET/i, '응답 없음', '서버가 안 받았습니다 — 일시적일 수 있습니다'],
];

function classify(detail) {
  for (const [re, label, hint] of REASONS) if (re.test(detail)) return { label, hint };
  return { label: '실패', hint: '아래 진단 원문을 보십시오' };
}

/**
 * 진단 출력에서 `● 이름` / `✕ 이름` 줄과 바로 뒤 설명을 뽑는다.
 *
 * ★★ **「진단 중단」은 항목이 아니다** 〈실측 — 내 검사가 잡았다〉.
 *   스모크가 통째로 터지면 `✕ 진단 중단: …` 한 줄을 남긴다. 그 줄을 항목으로
 *   세면 요약에 「1개 중 0개 살아 있음」이라 적히는데, 그것은 **한 항목이 실패한 것**
 *   처럼 읽힌다. 실제로는 **아무것도 안 돈 것**이다 — 전혀 다른 사실이고,
 *   못 잰 것을 실패로 적으면 무엇을 못 쟀는지 사라진다 (§8).
 */
const ABORT = /^✕\s*진단 중단/;
function parse(text) {
  const lines = text.split('\n');
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    if (ABORT.test(lines[i])) continue;
    const m = lines[i].match(/^([●✕])\s+(.+?)\s*$/);
    if (!m) continue;
    const detail = (lines[i + 1] || '').trim();
    items.push({ ok: m[1] === '●', name: m[2], detail });
  }
  return items;
}

/** 진단이 통째로 죽었는가. 죽었으면 그 이유 한 줄을 돌려준다 */
function aborted(text) {
  const line = text.split('\n').find((l) => ABORT.test(l));
  return line ? line.replace(/^✕\s*/, '').trim() : null;
}

/**
 * ★ 본문에 **실제 열쇠 값**이 들어갔는지 센다. 모양으로 짐작하지 않는다.
 * @returns {string[]} 걸린 환경변수 **이름** (값은 절대 안 돌려준다)
 */
function leaks(text) {
  const hit = [];
  for (const [name, v] of Object.entries(process.env)) {
    if (!/KEY|TOKEN|SECRET|PASSWORD|OC$/i.test(name)) continue;
    const val = String(v || '').trim();
    if (val.length < 12) continue;            // 짧은 값은 우연히 겹친다 (LAW_OC 는 이메일 앞부분)
    if (text.includes(val)) hit.push(name);
  }
  return hit;
}

function summary(items, at, abortLine) {
  const present = KEYS.map(([names, org, use]) => {
    const alt = names.split('|');
    const got = alt.find((n) => String(process.env[n] || '').trim());
    return { names: alt, org, use, got: got || null };
  });
  const live = items.filter((x) => x.ok).length;
  const dead = items.length - live;

  const L = [];
  L.push('# 공공 API 실측 진단');
  L.push('');
  L.push(`**잰 시각** ${at} · **잰 곳** GitHub Actions (열쇠가 있는 자리)`);
  L.push('');
  if (items.length) L.push(`**${items.length}개 항목 중 ${live}개 살아 있음 · ${dead}개 실패**`);
  else L.push('**진단이 한 항목도 못 돌았습니다** — 아래 원문을 보십시오.');
  if (abortLine) {
    L.push('');
    L.push(`> ⚠ **진단이 도중에 죽었습니다** — \`${abortLine.replace(/`/g, "'")}\``);
    L.push('> **그 뒤 항목은 돌지 않았습니다.** 위 수는 「거기까지」이지 전부가 아닙니다.');
  }
  L.push('');
  L.push('> 이 파일은 `npm run im:smoke` 를 **키가 있는 자리에서 돌린 결과**입니다.');
  L.push('> 키는 한 글자도 담기지 않습니다 — 쓰기 전에 기계가 세고, 걸리면 안 씁니다.');
  L.push('');
  L.push('## 1. 열쇠가 들어왔는가');
  L.push('');
  L.push('| 열쇠 | 발급처 | 쓰는 곳 | 들어옴 |');
  L.push('|---|---|---|---|');
  for (const p of present) {
    const mark = p.got ? `✅ \`${p.got}\`` : '— **없음**';
    L.push(`| ${p.names.map((n) => '`' + n + '`').join(' 또는 ')} | ${p.org} | ${p.use} | ${mark} |`);
  }
  L.push('');
  const missing = present.filter((p) => !p.got);
  if (missing.length) {
    L.push(`★ **${missing.length}개가 안 들어왔습니다.** Secrets 에 없거나 **이름이 다릅니다** —`);
    L.push('이름이 다르면 아무 오류 없이 조용히 죽습니다 (지침서 §9 첫 줄).');
    L.push('');
  }
  L.push('## 2. 실제로 불러 본 결과');
  L.push('');
  if (!items.length) {
    L.push('_항목이 없습니다._');
  } else {
    L.push('| 항목 | 결과 | 왜 | 무엇을 하면 되나 |');
    L.push('|---|---|---|---|');
    for (const it of items) {
      if (it.ok) L.push(`| ${it.name} | ✅ 살아 있음 | — | — |`);
      else {
        const c = classify(it.detail);
        L.push(`| ${it.name} | ✕ ${c.label} | ${it.detail.slice(0, 60).replace(/\|/g, '·')} | ${c.hint} |`);
      }
    }
  }
  L.push('');
  L.push('## 3. 이 파일을 어떻게 읽나');
  L.push('');
  L.push('- **살아 있음** — 커넥터가 응답을 받고 기대한 필드가 있습니다. 지침서 §1 의 「미검증」을 이걸로 바꾸십시오.');
  L.push('- **활용신청 안 됨** — 키는 멀쩡합니다. 그 API 하나에 신청만 하면 됩니다 (지침서 §4.2).');
  L.push('- **키 없음** — 이름이 다를 수 있습니다. 위 1번 표에서 어느 이름으로 들어왔는지 보십시오.');
  L.push('- **승인 대기** — KRX 처럼 발급 뒤 관리자 승인이 따로 필요한 곳입니다.');
  L.push('');
  L.push('원문은 같은 폴더의 `_raw.txt` 에 있습니다.');
  return L.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  const src = args.find((a) => !a.startsWith('--'));
  const oi = args.indexOf('--out');
  const outDir = oi >= 0 ? args[oi + 1] : path.join('data', '_api');

  if (!src || !fs.existsSync(src)) {
    console.error('✕ 읽을 진단 출력이 없습니다:', src || '(안 줬습니다)');
    console.error('  쓰기: npm run im:smoke > /tmp/s.txt 2>&1; node im-agent/tools/api-report.js /tmp/s.txt');
    process.exit(2);
  }
  const text = fs.readFileSync(src, 'utf8');

  /* ★ 쓰기 전에 센다. 걸리면 **아무것도 안 쓴다** — 공개 저장소다 (§2 · D-10) */
  const bad = leaks(text);
  if (bad.length) {
    console.error('✕ 진단 출력에 열쇠 값이 섞여 있습니다 — 파일을 쓰지 않았습니다.');
    console.error('  걸린 환경변수 이름:', bad.join(', '), '(값은 안 찍습니다)');
    console.error('  ※ 이 저장소는 공개입니다. 커밋되면 이력에 영구히 남습니다 (지침서 §10).');
    process.exit(1);
  }

  const items = parse(text);
  const at = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '_summary.md'), summary(items, at, aborted(text)));
  fs.writeFileSync(path.join(outDir, '_raw.txt'), text);
  console.log(`${outDir}/_summary.md — 항목 ${items.length}개 (살아 있음 ${items.filter((x) => x.ok).length}) · 열쇠 섞임 0`);
}

if (require.main === module) main();
module.exports = { parse, classify, leaks, summary, aborted, KEYS };
