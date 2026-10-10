#!/usr/bin/env node
/**
 * gpt-review.mjs — 지침함(docs/지침함)의 업무지침을 ChatGPT 로 «독립 교차검증» 한다. 〈2026-10-10 · D-428〉
 *
 * 사장님 지시: 「여기서 업무지침 전략이 만들어지면 챗지피티와 검증 자동화 해줘」.
 *
 * ★ 왜 다른 모델인가 — 만드는 손(Claude)과 재는 손이 같으면 작성자가 만든 오류를 못 잡는다
 *   (§11 · 사장님 preference 「회귀 검사와 별도로 독립 감사」). ChatGPT 는 «둘째 눈»이다.
 * ★★ 그 결과는 «참고 의견»이지 승인이 아니다 — 반영 여부는 사장님·Orchestrator 가 정한다 (§11).
 * ★★ 열쇠(OPENAI_API_KEY)는 Actions 에만 있다 — 키가 있는 자리에서 부르고 결과만 커밋한다 (§4).
 *    값은 한 글자도 안 찍는다. 이 저장소는 공개다 (§2 · D-10).
 *
 * 쓰는 법:
 *   node scripts/gpt-review.mjs                 바뀐(또는 아직 검토 안 된) 지침만 검토
 *   node scripts/gpt-review.mjs --force <파일>  그 지침을 다시 검토
 *   node scripts/gpt-review.mjs --status        검토·반영 현황만 적는다 (부르지 않는다 · 열쇠 불필요)
 *
 * 되돌아오는 값 (값마다 하실 일이 다르다 · §12-24):
 *   0 검토할 것을 다 검토했다(또는 검토할 것이 없다)   1 일부만 검토했다
 *   2 하나도 못 했다 — 열쇠가 없다(넣으실 일)          3 못 닿음·과부하·잠깐 한도(기다리면 낫는다)
 *   4 열쇠 거부(401·403 — 열쇠를 다시 본다)            5 결제·사용 한도 소진(기다려도 안 낫는다)
 *   6 모델 이름이 없다(저장소 변수 OPENAI_REVIEW_MODEL 을 고친다)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* 검사가 임시 폴더로 돌릴 수 있게 자리를 바꿀 수 있다 — 기본은 저장소의 지침함 */
export const DIR = process.env.GUIDE_DIR ? path.resolve(process.env.GUIDE_DIR) : path.join(ROOT, 'docs', '지침함');
const { kstStamp } = require('../im-agent/core/kst.js');

/* 지침이 아닌 파일 — 안내·현황·기록·검토 결과·검증 기준 */
const NOT_GUIDE = /^(README|INBOX|반영기록|_.*)\.md$|\.(gpt|gemini)-review\.md$/;

export function listGuides(dir = DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !NOT_GUIDE.test(f)).sort();
}
export const hashOf = (t) => crypto.createHash('sha256').update(String(t).replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
export const reviewName = (f, kind = 'gpt') => f.replace(/\.md$/, `.${kind}-review.md`);

/* 검토 파일 첫 줄에 «무엇을 검토했는지»(지문)를 적어 둔다 — 지침이 바뀌면 다시 검토한다 */
export function reviewedHash(dir, f, kind = 'gpt') {
  const p = path.join(dir, reviewName(f, kind));
  if (!fs.existsSync(p)) return null;
  const m = fs.readFileSync(p, 'utf8').match(/(?:gpt|gemini)-review:\s*hash=([0-9a-f]{12})/);
  return m ? m[1] : null;
}
export function verdictOfReview(dir, f, kind = 'gpt') {
  const p = path.join(dir, reviewName(f, kind));
  if (!fs.existsSync(p)) return null;
  const m = fs.readFileSync(p, 'utf8').match(/(?:gpt|gemini)-review:[^>]*verdict=(PASS|REVISE|BLOCK)/);
  return m ? m[1] : null;
}
/* Orchestrator 가 반영하면 「반영기록.md」에 `파일 · 지문` 을 남긴다 */
export function appliedHashes(dir = DIR) {
  const p = path.join(dir, '반영기록.md');
  if (!fs.existsSync(p)) return new Set();
  return new Set([...fs.readFileSync(p, 'utf8').matchAll(/\b([0-9a-f]{12})\b/g)].map((m) => m[1]));
}

/* ★ 바깥 글을 싣기 전에 열쇠를 가린다 — 원본과 턴 값 둘 다 (§12-13 · D-246) */
export function redact(s, secrets = []) {
  let out = String(s ?? '');
  for (const v of secrets) {
    if (!v) continue;
    for (const x of new Set([v, String(v).trim()])) if (x.length >= 6) out = out.split(x).join('***');
  }
  return out.replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***');
}

/* ★★ 공개 저장소다 — 열쇠처럼 생긴 글이 든 지침은 «보내지도 커밋하지도» 않는다 (§2) */
export function leakCheck(text) {
  const hits = [];
  if (/sk-[A-Za-z0-9_-]{20,}/.test(text)) hits.push('OpenAI 열쇠 모양');
  if (/AIza[0-9A-Za-z_-]{30,}/.test(text)) hits.push('구글 열쇠 모양');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) hits.push('개인키');
  if (/\b01[016789]-?\d{3,4}-?\d{4}\b/.test(text)) hits.push('휴대전화 번호');
  return hits;
}

/* 갈래 — 상태코드만 보지 않고 본문까지 본다 (§4.2) */
export function classify(status, body) {
  const b = String(body || '');
  if (status === undefined || status === null) return { code: 3, kind: 'unreachable', say: 'OpenAI 에 닿지 못했습니다 — 열쇠 문제가 아닙니다. 잠시 뒤 다시 겁니다.' };
  if (status === 401 || status === 403) return { code: 4, kind: 'auth', say: '열쇠가 거부됐습니다 — GitHub 비밀 OPENAI_API_KEY 값을 다시 봅니다.' };
  if (status === 404 && /model/i.test(b)) return { code: 6, kind: 'model', say: '그 모델 이름이 없습니다 — 저장소 변수 OPENAI_REVIEW_MODEL 을 고칩니다. 열쇠 문제가 아닙니다.' };
  if (status === 429 && /insufficient_quota|billing/i.test(b)) return { code: 5, kind: 'quota', say: 'OpenAI 결제·사용 한도가 찼습니다 — 기다려도 안 낫습니다. OpenAI 결제 화면을 봅니다.' };
  if (status === 429 || status >= 500) return { code: 3, kind: 'busy', say: '잠깐 한도이거나 그쪽 서버가 바쁩니다 — 기다리면 낫습니다. 우리 쪽에 고칠 것이 없습니다.' };
  return { code: 4, kind: 'http', say: `HTTP ${status} 로 거부됐습니다 — 본문 앞머리를 봅니다.` };
}

const CRITERIA_FILE = '_검증기준.md';
export function buildMessages(name, text, criteria) {
  const sys = [
    '너는 LinkPilot(PDI GID — 한국 부동산·인프라 PF 자문사의 업무 플랫폼)의 «독립 검증자»다.',
    '다른 AI(Claude)가 쓴 업무지침을 교차검증한다. 작성자를 편들지 말고 문제를 찾는 것이 일이다.',
    '아래 «검증 기준»에 비추어 본다: 내부 모순 · 기존 규칙과의 충돌 · 모호한 표현 · 완료조건/담당/기한 누락 ·',
    '근거 없이 확정으로 쓴 사실 · 비밀·개인정보 노출 위험(이 글은 공개 저장소에 남는다) · 실행 불가능한 지시.',
    '평가 점수는 매기지 않는다. 한국어로, 쉬운 말과 짧은 문장으로 쓴다.',
    '반드시 JSON 하나로만 답한다: {"verdict":"PASS|REVISE|BLOCK","summary":"두세 문장",',
    '"issues":[{"severity":"HIGH|MEDIUM|LOW","where":"절·줄","problem":"무엇이 문제인가","fix":"어떻게 고치나"}],',
    '"conflicts":["기존 규칙과 부딪히는 자리"]}',
    'PASS=그대로 반영 가능 · REVISE=고쳐서 반영 · BLOCK=반영하면 안 됨(HIGH 문제가 있다).',
  ].join('\n');
  const user = `## 검증 기준\n${criteria || '(검증 기준 파일 없음 — 일반 원칙으로 본다)'}\n\n## 검증할 업무지침: ${name}\n${text}`;
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

export function parseReview(content) {
  let j;
  try { j = JSON.parse(String(content || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; }
  if (!j || !/^(PASS|REVISE|BLOCK)$/.test(j.verdict)) return null;
  j.issues = Array.isArray(j.issues) ? j.issues : [];
  j.conflicts = Array.isArray(j.conflicts) ? j.conflicts : [];
  /* HIGH 가 있는데 PASS 라고 하면 그 말을 믿지 않는다 — 판정과 근거가 서로 다른 말을 하면 사고 신호다 (§8) */
  if (j.verdict === 'PASS' && j.issues.some((i) => i && i.severity === 'HIGH')) j.verdict = 'REVISE';
  return j;
}

export async function reviewOne({ name, text, criteria, key, model, fetchImpl = fetch, timeoutMs = 120000 }) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let r, body = '';
  try {
    r = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: buildMessages(name, text, criteria), response_format: { type: 'json_object' } }),
    });
    body = await r.text();
  } catch (e) {
    clearTimeout(t);
    return { ok: false, ...classify(undefined), detail: redact(e && e.message, [key]) };
  }
  clearTimeout(t);
  if (!r.ok) return { ok: false, ...classify(r.status, body), status: r.status, detail: redact(body.slice(0, 300), [key]) };
  let content = '';
  try { content = JSON.parse(body).choices[0].message.content; } catch { /* 아래에서 갈래로 */ }
  const review = parseReview(content);
  /* 대답은 왔는데 판정을 못 읽었다 — 「통과」로 적지 않는다 (§8 · D-228) */
  if (!review) return { ok: false, code: 3, kind: 'unparsed', say: '대답은 왔는데 판정 형식이 아닙니다 — 다시 겁니다.', detail: redact(String(content).slice(0, 300), [key]) };
  return { ok: true, review };
}

/* ★★ 둘째 검증자 — Gemini 〈2026-10-10 사장님: 「둘다 만들어줘」 · D-430〉
 * OpenAI 열쇠가 없어도 다른 회사의 AI 로 교차검증한다. 열쇠는 배포가 이미 쓰는 GEMINI 묶음(Actions 비밀)이다.
 * 한도(429)·과부하(5xx)는 다음 열쇠로, 거부(401·403)도 다음 열쇠로(열쇠마다 승인이 다르다) · 모델 이름 없음(404)은 다음 모델로 (§4.6 · §12-25). */
export function geminiKeys(env = process.env) {
  const names = Object.keys(env).filter((k) => /^GEMINI_(API_)?KEY(_\d+)?$/.test(k)).sort();
  return [...new Set(names.map((k) => String(env[k] || '').trim()).filter((v) => v.length >= 20 && !/[<>]/.test(v)))];
}
export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
export async function reviewGemini({ name, text, criteria, keys, models = GEMINI_MODELS, fetchImpl = fetch, timeoutMs = 120000 }) {
  const [sys, user] = buildMessages(name, text, criteria);
  let last = { ok: false, code: 2, kind: 'nokey', say: 'Gemini 열쇠가 이 자리에 없습니다.' };
  for (const model of models) {
    for (const key of keys) {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
      let r, body = '';
      try {
        r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: sys.content }] }, contents: [{ role: 'user', parts: [{ text: user.content }] }],
            generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192 } }),
        });
        body = await r.text();
      } catch (e) { clearTimeout(t); last = { ok: false, code: 3, kind: 'unreachable', say: 'Gemini 에 닿지 못했습니다 — 열쇠 문제가 아닙니다.', detail: redact(e && e.message, keys) }; continue; }
      clearTimeout(t);
      if (r.status === 404) { last = { ok: false, code: 6, kind: 'model', say: `Gemini 모델 ${model} 이 없습니다 — 다음 모델로 갑니다.`, detail: redact(body.slice(0, 200), keys) }; break; }
      if (!r.ok) { last = { ok: false, code: r.status === 401 || r.status === 403 ? 4 : 3, kind: 'http', say: `Gemini 가 HTTP ${r.status} 로 거부했습니다.`, detail: redact(body.slice(0, 200), keys) }; continue; }
      let content = '';
      try { content = JSON.parse(body).candidates[0].content.parts.map((x) => x.text || '').join(''); } catch { /* 아래 */ }
      const review = parseReview(content);
      if (!review) { last = { ok: false, code: 3, kind: 'unparsed', say: 'Gemini 대답이 판정 형식이 아닙니다.', detail: redact(String(content).slice(0, 200), keys) }; break; }
      return { ok: true, review, model };
    }
  }
  return last;
}

const VLABEL = { PASS: '통과 — 그대로 반영 가능', REVISE: '보완 필요 — 고쳐서 반영', BLOCK: '반영 보류 — 고칠 때까지 반영하지 않는다' };
export function renderReview(f, hash, model, rv, at, kind = 'gpt') {
  const who = kind === 'gemini' ? 'Gemini' : 'ChatGPT';
  const rows = rv.issues.map((i) => `| ${i.severity || '-'} | ${String(i.where || '-').replace(/\|/g, '/')} | ${String(i.problem || '').replace(/\|/g, '/')} | ${String(i.fix || '').replace(/\|/g, '/')} |`);
  return [
    `<!-- ${kind}-review: hash=${hash} verdict=${rv.verdict} model=${model} at=${at} -->`,
    `# ${who} 교차검증 — ${f.replace(/\.md$/, '')}`,
    '',
    `**판정: ${VLABEL[rv.verdict]}** · 검토 모델 ${model} · ${at} 기준 · 지침 지문 \`${hash}\``,
    '',
    rv.summary || '',
    '',
    rows.length ? '| 중요도 | 위치 | 문제 | 고칠 점 |\n|---|---|---|---|\n' + rows.join('\n') : '찾은 문제 없음.',
    '',
    rv.conflicts.length ? '**기존 규칙과 부딪히는 자리**\n' + rv.conflicts.map((c) => `- ${c}`).join('\n') : '',
    '',
    '> 이 검토는 다른 AI 의 «참고 의견»입니다 — 승인이 아닙니다 (CLAUDE.md §11).',
    '> 반영 여부는 사장님과 Orchestrator 가 정하고, 반영하면 `반영기록.md` 에 이 지문을 적습니다.',
    '',
  ].join('\n');
}

/* 현황표 — 사람이 읽는 한 장. 열쇠 없이도 만든다 */
export function renderStatus(dir = DIR, at = kstStamp()) {
  const applied = appliedHashes(dir);
  const rows = listGuides(dir).map((f) => {
    const h = hashOf(fs.readFileSync(path.join(dir, f), 'utf8'));
    const rh = reviewedHash(dir, f);
    const v = rh === h ? verdictOfReview(dir, f) : null;
    const gpt = v ? { PASS: '통과', REVISE: '보완 필요', BLOCK: '반영 보류' }[v] : (rh ? '옛 판을 검토함 — 다시 검토 대기' : '검토 대기');
    const grh = reviewedHash(dir, f, 'gemini');
    const gv = grh === h ? verdictOfReview(dir, f, 'gemini') : null;
    const gem = gv ? { PASS: '통과', REVISE: '보완 필요', BLOCK: '반영 보류' }[gv] : (grh ? '옛 판을 검토함' : '검토 대기');
    const st = applied.has(h) ? '반영 완료' : '미반영';
    return { f, h, gpt, gem, st };
  });
  const pending = rows.filter((r) => r.st === '미반영').length;
  return [
    `# 지침함 현황 — ${at} 기준`,
    '',
    `지침 ${rows.length}건 · **미반영 ${pending}건** · 이 표는 \`npm run guide:status\` 가 만든다(손으로 고치지 않는다).`,
    '',
    rows.length ? '| 지침 | 지문 | ChatGPT 검토 | Gemini 검토 | Orchestrator 반영 |\n|---|---|---|---|---|\n'
      + rows.map((r) => `| ${r.f} | \`${r.h}\` | ${r.gpt} | ${r.gem} | ${r.st} |`).join('\n') : '아직 지침이 없습니다.',
    '',
  ].join('\n');
}

async function main(argv) {
  const log = [];
  const key = (process.env.OPENAI_API_KEY || '').trim();
  const model = (process.env.OPENAI_REVIEW_MODEL || '').trim() || 'gpt-4.1';
  const forceAt = argv.indexOf('--force');
  const force = forceAt >= 0 ? path.basename(String(argv[forceAt + 1] || '')) : '';
  const writeStatus = () => fs.writeFileSync(path.join(DIR, '_검증현황.md'), renderStatus());

  if (argv.includes('--status')) { writeStatus(); console.log(renderStatus()); return 0; }

  const criteriaPath = path.join(DIR, CRITERIA_FILE);
  const criteria = fs.existsSync(criteriaPath) ? fs.readFileSync(criteriaPath, 'utf8') : '';
  const todo = listGuides().filter((f) => (force ? f === force : reviewedHash(DIR, f) !== hashOf(fs.readFileSync(path.join(DIR, f), 'utf8'))));
  if (force && !todo.length) log.push(`- 다시 검토하라 하신 «${force}» 가 지침함에 없습니다.`);

  /* 1번 검증자 Gemini — 먼저 돈다 〈2026-10-10 사장님: 「1.제미나이 2.쳇지피티 순으로」〉. 결과 글은 로그에도 싣는다(작업 가지에서는 커밋하지 않으므로) */
  const gkeys = geminiKeys();
  const gTodo = listGuides().filter((f) => (force ? f === force : reviewedHash(DIR, f, 'gemini') !== hashOf(fs.readFileSync(path.join(DIR, f), 'utf8'))));
  let gDone = 0; const gFails = [];
  for (const f of gTodo) {
    const text = fs.readFileSync(path.join(DIR, f), 'utf8');
    if (leakCheck(text).length) { gFails.push({ code: 4, f, say: '공개 저장소에 둘 수 없는 글이 있어 보내지 않았습니다.' }); continue; }
    if (!gkeys.length) { gFails.push({ code: 2, f, say: 'Gemini 열쇠(GEMINI_API_KEY…)가 이 자리에 없습니다.' }); continue; }
    const r = await reviewGemini({ name: f, text, criteria, keys: gkeys });
    if (!r.ok) { gFails.push({ code: r.code, f, say: r.say + (r.detail ? ` (앞머리: ${r.detail.slice(0, 160)})` : '') }); continue; }
    const doc = renderReview(f, hashOf(text), r.model, r.review, kstStamp(), 'gemini');
    fs.writeFileSync(path.join(DIR, reviewName(f, 'gemini')), doc);
    gDone += 1;
    log.push(`- ✓ [Gemini] ${f} — ${VLABEL[r.review.verdict]} (문제 ${r.review.issues.length}건)`);
    log.push('', '<details><summary>Gemini 검토 전문</summary>', '', doc, '</details>', '');
  }
  for (const x of gFails) log.push(`- ✗ [Gemini] ${x.f} — ${x.say}`);

  let done = 0; const fails = [];
  for (const f of todo) {
    const text = fs.readFileSync(path.join(DIR, f), 'utf8');
    const leak = leakCheck(text);
    if (leak.length) { fails.push({ code: 4, f, say: `공개 저장소에 둘 수 없는 글이 있습니다(${leak.join(' · ')}) — 보내지 않았습니다. 그 줄을 지우고 다시 올립니다.` }); continue; }
    if (!key) { fails.push({ code: 2, f, say: '열쇠(OPENAI_API_KEY)가 이 자리에 없습니다 — GitHub 비밀에 넣으시면 다음 실행부터 검토합니다.' }); continue; }
    /* 2번 검증자 ChatGPT 는 Gemini 의견까지 받아 동의·반박을 함께 적는다 — 같은 지문의 의견만 싣는다 */
    const gp = path.join(DIR, reviewName(f, 'gemini'));
    const prior = reviewedHash(DIR, f, 'gemini') === hashOf(text) ? fs.readFileSync(gp, 'utf8') : '';
    const crit = prior ? `${criteria}\n\n## 앞선 검증자(Gemini) 의견 — 동의하는 것과 반박하는 것을 issues·summary 에 함께 적는다\n${prior}` : criteria;
    const r = await reviewOne({ name: f, text, criteria: crit, key, model });
    if (!r.ok) { fails.push({ code: r.code, f, say: r.say + (r.detail ? ` (앞머리: ${r.detail.slice(0, 160)})` : '') }); if (r.code === 4 || r.code === 5 || r.code === 6) break; continue; }
    fs.writeFileSync(path.join(DIR, reviewName(f)), renderReview(f, hashOf(text), model, r.review, kstStamp()));
    done += 1;
    log.push(`- ✓ ${f} — ${VLABEL[r.review.verdict]} (문제 ${r.review.issues.length}건)`);
  }
  for (const x of fails) log.push(`- ✗ ${x.f} — ${x.say}`);

  writeStatus();

  /* 판정 — 섞이면 «고칠 것이 있는 쪽»을 먼저 말한다 (§12-24) */
  const worst = [4, 5, 6, 2, 3].find((c) => fails.some((x) => x.code === c));
  let code = !todo.length || !fails.length ? 0 : done === 0 ? (worst ?? 2) : 1;
  /* ★ OpenAI 열쇠만 없고 Gemini 가 전부 검토했으면 «검토는 됐다» — 빨강으로 끝내지 않고 그 사실을 적는다 */
  const gemCovered = gTodo.length > 0 && gFails.length === 0;
  const onlyNoKey = fails.length > 0 && fails.every((x) => x.code === 2);
  if (code === 2 && onlyNoKey && gemCovered) { code = 0; log.unshift('- ChatGPT 는 열쇠(OPENAI_API_KEY)가 없어 건너뛰었고, Gemini 가 대신 검토했습니다.'); }
  else if (code === 0 && gFails.length && !fails.length && todo.length === 0 && gDone === 0) code = gFails.some((x) => x.code === 4) ? 4 : 3;
  const head = code === 0
    ? (todo.length || gDone ? `판정 0 — ChatGPT ${done}건 · Gemini ${gDone}건 검토 완료` : '판정 0 — 새로 검토할 지침이 없습니다')
    : `판정 ${code} — ${todo.length}건 중 ${done}건 검토 · ${fails[0].say}`;
  log.unshift(head, '');
  fs.writeFileSync(path.join(DIR, '_검토요약.md'), `# 이번 검토 — ${kstStamp()}\n\n${log.join('\n')}\n`);
  console.log(redact(log.join('\n'), [key, ...gkeys]));
  return code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const code = await main(process.argv.slice(2)).catch((e) => { console.error('예상 밖 오류:', redact(e && e.message, [process.env.OPENAI_API_KEY])); return 2; });
  process.exit(code);
}
