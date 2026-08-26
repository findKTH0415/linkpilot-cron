'use strict';
/**
 * render-birdseye.js — 기하 조감도를 Gemini(Nano Banana Pro 계열)로 실사화한다.
 *
 * 〈2026-08-25 사장님 지시 — 「D-34 보류하지 말고 자세히 안내해줘」〉
 * D-34 의 「API 실측 전 자동화 보류」를 푼다. 다만 **역할은 갈라져 있다**:
 *   ① 생성은 자동이다      — 이 도구가 후보 이미지를 만든다.
 *   ② 채택은 사람이다      — 후보를 눈으로 보고 `--adopt` 로 등록해야
 *                            model-result.json 의 renders 에 실린다.
 *   ③ 표기는 불변이다      — 「AI 렌더 — 실제 설계안이 아님」 disclaimer 와
 *                            도구·세대 기록(규격 §3-1)이 후보 단계부터 붙는다.
 * 자동으로 문서에 싣지 않는 이유: AI 그림은 우리가 지어낸 형상이라,
 * 그럴듯할수록 설계안으로 읽히는 사고가 커진다 (D-34 원결정과 같은 결).
 *
 * ★ 표준(CLAUDE.md §7 · outputspec.RENDER_STANDARD)은 Veras 4.0 (Nano Banana
 *   Pro 기반)이고, 이 도구의 경로는 **gemini + 같은 기반 모델**이라 표준으로
 *   친다 — 수령 Agent 의 RENDER_TOOL_NONSTANDARD 검사를 통과한다.
 * ★ 키가 없으면 만들지 않고 안내만 한다 (§4.6 — 지어내지 않는다).
 * ★ 새 의존성 없음 — fetch 내장. 호출 경로는 core/llm.js 의 실측(2026-08-17,
 *   Interactions 우선 → generateContent 폴백)을 따른다.
 * ★★ **이미지 모델 ID 와 이미지 응답 형상은 키 있는 자리(NAS)에서 실측해
 *   확정한다** — 여기(키 없는 컨테이너)서는 실측할 수 없다(§7 im:smoke 와
 *   같은 규칙). 그래서 모델 목록을 환경변수로 열어 두고, 실패 시 서버가
 *   말한 오류를 그대로 찍는다 — 그 출력이 실측 기록이 된다.
 *
 * 쓰는 법:
 *   node im-agent/tools/render-birdseye.js --project LP-DEMO-APT-000
 *   node im-agent/tools/render-birdseye.js --image 04_Property/birdseye.jpg
 *   node im-agent/tools/render-birdseye.js --project <id> --adopt render_SC-AERIAL-01_gemini_01.png
 */

const fs = require('fs');
const path = require('path');
require('../core/env').ensure();
const store = require('../core/store');

const KEYS = (process.env.GEMINI_API_KEY || '').split(',').map(s => s.trim()).filter(Boolean);
/* 이미지 출력 모델 후보 (Nano Banana Pro = Gemini 3 Pro Image · Nano Banana = 2.5 Flash Image).
   ★ 2026-08-25 실측 (render-smoke #1, 실키): 모델 이름·인증은 이대로 통과했다 —
     서버가 gemini-3-pro-image / gemini-2.5-flash-preview-image 로 응답했다.
     막힌 것은 과금 하나: 「free_tier_requests, limit: 0」 — **무료 티어에는
     이미지 생성 한도가 0** 이라 결제 연결이 있어야 돈다 (안내 문서 §5). */
const MODELS = (process.env.GEMINI_RENDER_MODELS
  || 'gemini-3-pro-image,gemini-2.5-flash-image')
  .split(',').map(s => s.trim()).filter(Boolean);

const SCENE = 'SC-AERIAL-01';
const ENGINE = 'Nano Banana Pro';
const DISCLAIMER = 'AI 렌더 — 실제 설계안이 아님';
const DEFAULT_PROMPT = '이 건축 매스 조감도를 사실적인 건축 시각화로 바꿔라. '
  + '건물의 형태·층수·비례·배치·도로 위치는 그대로 유지하고, 재질(외장·유리·도로 포장)과 '
  + '주변 환경(하늘·조명·가로수)만 사실적으로 그린다. 새 건물이나 구조물을 추가하지 않는다.';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

/* Interactions API — 이미지 파트를 찾아 base64 를 돌려준다. 없으면 throw. */
async function tryInteractions(model, key, imgBuf, mime, prompt) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      model,
      input: [
        { type: 'image', mime_type: mime, data: imgBuf.toString('base64') },
        { type: 'text', text: prompt },
      ],
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error && (j.error.message || j.error)) || `HTTP ${r.status}`);
  const steps = Array.isArray(j?.steps) ? j.steps : [];
  for (const st of steps) {
    for (const c of (Array.isArray(st?.content) ? st.content : [])) {
      if (c && (c.type === 'image' || c.mime_type || c.inline_data)) {
        const data = c.data || (c.inline_data && c.inline_data.data);
        if (data) return Buffer.from(data, 'base64');
      }
    }
  }
  throw new Error('응답에 이미지가 없다(interactions)');
}

/* generateContent 폴백 — candidates[].content.parts[].inlineData 를 찾는다 */
async function tryGenerate(model, key, imgBuf, mime, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: mime, data: imgBuf.toString('base64') } },
        { text: prompt },
      ] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error && j.error.message) || `HTTP ${r.status}`);
  for (const p of (j?.candidates?.[0]?.content?.parts || [])) {
    if (p.inlineData && p.inlineData.data) return Buffer.from(p.inlineData.data, 'base64');
  }
  throw new Error('응답에 이미지가 없다(generateContent)');
}

function candDir(projectId) {
  return path.join(store.projectDir(projectId), '04_Property', 'render-candidates');
}

/**
 * ★★★ **실패를 사람 말로 가른다** 〈2026-08-25 · 같은 벽에 두 번 부딪혔다〉.
 *
 *   서버가 돌려주는 말은 전부 영어 한 덩어리라 「열쇠가 틀렸다」와
 *   「열쇠는 맞는데 결제가 없다」가 **똑같이 보인다.** 실제로 사장님이
 *   열쇠를 다시 넣으셨는데 **열쇠 문제가 아니었다** — 두 번 헛돌았다.
 *
 * ★ 그래서 셋으로 가른다: 결제(quota) · 열쇠(auth) · 모델 이름(not found).
 *   판정 못 하는 것은 「모르겠다」로 두고 원문을 보여 준다 — 지어내지 않는다.
 */
function diagnose(errors) {
  const all = errors.join(' | ').toLowerCase();
  if (/quota|exceeded|rate.?limit|billing/.test(all)) {
    return {
      kind: 'billing',
      head: '열쇠는 살아 있다 — 막힌 것은 **결제**다.',
      body: [
        '  구글이 열쇠를 받아들였고(인증 통과), 「무료 구간의 이미지 한도가 0」이라고 답했다.',
        '  → **열쇠를 다시 넣어도 안 열린다.** 그 열쇠가 속한 프로젝트에 결제를 연결해야 한다:',
        '     aistudio.google.com → 「Get API key」 → 그 키의 프로젝트 줄 → 「Set up Billing」.',
        '  → 결제 없이 지금 시험하려면 **웹 무료 경로**를 쓴다 (안내 문서 §4-1):',
        '     AI Studio 또는 Gemini 앱에 조감도를 올리고 같은 지시문을 준다.',
      ],
    };
  }
  if (/api[_ ]?key|unauthenticated|permission|invalid|401|403/.test(all)) {
    return {
      kind: 'key',
      head: '**열쇠가 거부됐다** — 결제가 아니라 열쇠 문제다.',
      body: ['  GitHub Secrets 의 GEMINI_API_KEY 를 다시 넣는다 (한 줄로, 앞뒤 빈칸 없이).'],
    };
  }
  if (/not found|404|unsupported|no longer available/.test(all)) {
    return {
      kind: 'model',
      head: '**모델 이름이 안 맞는다** — 열쇠·결제와 무관하다.',
      body: ['  GEMINI_RENDER_MODELS 로 이름을 바꿔 다시 시도한다.'],
    };
  }
  return { kind: 'unknown', head: '무엇이 막았는지 **판정하지 못했다** — 아래 원문을 그대로 본다.', body: [] };
}

/* --adopt: 후보를 사람 확인 하에 model-result.json renders 에 등록한다 */
function adopt(projectId, file) {
  const dir = candDir(projectId);
  const meta = path.join(dir, file.replace(/\.png$/i, '') + '.json');
  if (!fs.existsSync(path.join(dir, file)) || !fs.existsSync(meta)) {
    console.error(`✗ 후보가 없다: ${file} — 먼저 생성 모드로 후보를 만든다`);
    process.exit(1);
  }
  const resultPath = path.join(store.projectDir(projectId), '04_Property', 'model-result.json');
  if (!fs.existsSync(resultPath)) {
    console.error('✗ model-result.json 이 아직 없다 — SketchUp 결과를 받은 뒤에 채택한다.');
    console.error('  (렌더는 결과 파일의 renders 에 실려야 수령 Agent 가 대조한다 — 규격 §3)');
    process.exit(1);
  }
  const entry = JSON.parse(fs.readFileSync(meta, 'utf8'));
  entry.adopted = true;
  entry.adopted_at = new Date().toISOString();
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  result.renders = Array.isArray(result.renders) ? result.renders : [];
  // 표지·티저용 원본을 04_Property 바로 아래로 옮겨 결과 파일과 같은 층에 둔다
  const finalPath = path.join(store.projectDir(projectId), '04_Property', file);
  fs.copyFileSync(path.join(dir, file), finalPath);
  result.renders.push(entry);
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  console.log(`✓ 채택됨 — ${file} → model-result.json renders (${result.renders.length}번째)`);
  console.log('  다음 보고서 생성에서 수령 Agent 가 표기·표준을 검사한다.');
}

async function main() {
  const projectId = arg('project', 'LP-DEMO-APT-000');
  const adoptFile = arg('adopt', null);
  if (adoptFile) return adopt(projectId, adoptFile);

  if (!KEYS.length) {
    console.error('✗ GEMINI_API_KEY 가 없다 — 렌더를 만들지 않는다 (지어내지 않는다, §4.6).');
    console.error('  발급·등록 절차: docs/안내-조감도-자동-렌더.md');
    process.exit(2);
  }

  let imgPath = arg('image', null);
  if (!imgPath) {
    const base = path.join(store.projectDir(projectId), '04_Property');
    for (const f of ['birdseye.jpg', 'birdseye.png']) {
      if (fs.existsSync(path.join(base, f))) { imgPath = path.join(base, f); break; }
    }
  }
  if (!imgPath || !fs.existsSync(imgPath)) {
    console.error('✗ 원본 조감도가 없다 — 먼저 보고서를 생성해 04_Property/birdseye.jpg 를 만들거나 --image 로 지정한다.');
    process.exit(2);
  }
  const mime = /\.png$/i.test(imgPath) ? 'image/png' : 'image/jpeg';
  const imgBuf = fs.readFileSync(imgPath);
  const prompt = arg('prompt', DEFAULT_PROMPT);

  console.log(`원본: ${imgPath} (${(imgBuf.length / 1024).toFixed(0)}KB) · 장면 ${SCENE}`);
  const errors = [];
  for (const model of MODELS) {
    for (const key of KEYS) {
      for (const [label, fn] of [['interactions', tryInteractions], ['generateContent', tryGenerate]]) {
        try {
          const out = await fn(model, key, imgBuf, mime, prompt);
          const dir = candDir(projectId);
          fs.mkdirSync(dir, { recursive: true });
          let n = 1;
          while (fs.existsSync(path.join(dir, `render_${SCENE}_gemini_${String(n).padStart(2, '0')}.png`))) n++;
          const name = `render_${SCENE}_gemini_${String(n).padStart(2, '0')}.png`;
          fs.writeFileSync(path.join(dir, name), out);
          // 규격 §3-1 의 renders 항목을 후보 단계부터 완성해 둔다 — 채택 때 그대로 실린다
          fs.writeFileSync(path.join(dir, name.replace(/\.png$/, '.json')), JSON.stringify({
            file: name,
            tool: 'gemini',
            tool_version: model,
            engine: ENGINE,
            based_on: SCENE,
            settings: { prompt, geometry_override: '유지 지시(프롬프트)' },
            ai_generated: true,
            disclaimer: DISCLAIMER,
            adopted: false,
          }, null, 2));
          console.log(`✓ 후보 생성 — ${path.join(dir, name)} (${model} · ${label} · ${(out.length / 1024).toFixed(0)}KB)`);
          console.log('');
          console.log('★ 아직 문서에 실리지 않았다 — 채택은 사람 몫이다 (D-34 개정).');
          console.log(`  눈으로 확인한 뒤: npm run im:render -- --project ${projectId} --adopt ${name}`);
          return;
        } catch (e) {
          errors.push(`${model}[${label}]: ${e.message}`);
        }
      }
    }
  }
  const d = diagnose(errors);
  console.error('✗ 이미지 생성 실패 — ' + d.head);
  d.body.forEach(l => console.error(l));
  console.error('');
  console.error('  서버가 말한 그대로 (이 출력이 실측 기록이다):');
  errors.slice(0, 4).forEach(e => console.error('    - ' + e.split('\n')[0]));
  process.exit(1);
}

module.exports = { diagnose };

if (require.main === module) {
  main().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
}
