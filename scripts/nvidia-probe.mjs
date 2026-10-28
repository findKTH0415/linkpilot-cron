// scripts/nvidia-probe.mjs
//
// NVIDIA AI(build.nvidia.com · NIM) 열쇠를 «진단부터» 잰다 〈2026-10-28 사장님: 「NVDIA_TAST_KEY 넣었어」 ·
//   「NVDIA_AI 엔지니어링과 LinkPilot_Shorts_Automation_Work_Guide_v1.3 반영하여 … 만들어줘」〉
//
// ★ 이름은 넣으신 글자 그대로(NVDIA_TAST_KEY) 먼저 읽고, 철자가 다를 수 있는 이름 셋도 함께 읽는다 —
//   어느 이름이 실제로 들어 있는지는 요약이 말한다(들었다 ≠ 들어 있다 · CLAUDE.md §13).
// ★ 무엇을 쓸지 정하기 전이라 «모델 목록»만 묻는다 — 생성(그림·소리) 호출의 인자를 추측으로 넣지 않는다 (§4.3).
//   목록에서 그림·소리·글 모델이 몇 개인지 갈라 적어, 쇼츠 장면에 쓸 길이 있는지 판단할 재료만 남긴다.
// ★ 열쇠 값은 한 글자도 안 남긴다 (§2 · 공개 저장소) — 요약에 섞였으면 파일을 안 쓰고 빨갛게 끝난다.
//
// 쓰는 법  node scripts/nvidia-probe.mjs [--out data/_nvidia]
// 되돌아오는 값: 0 받음 · 2 열쇠 없음 · 3 기다리면 낫는다(못 닿음·한도·5xx) · 4 열쇠 거부 · 7 대답이 목록 모양이 아니다 · 9 열쇠 샘

import { mkdir, writeFile } from 'node:fs/promises';

export const NAMES = ['NVDIA_TAST_KEY', 'NVIDIA_TEST_KEY', 'NVIDIA_API_KEY', 'NVIDIA_KEY'];
export const MODELS_URL = 'https://integrate.api.nvidia.com/v1/models';

export function pickKey(env = process.env) {
  for (const n of NAMES) { const v = String(env[n] || '').trim(); if (v.length >= 8) return { name: n, key: v }; }
  return null;
}

/** 모델 id 를 갈래로 나눈다 — 이름에 든 낱말로만(지어내지 않는다). 모르는 것은 «기타» */
export function classify(ids) {
  const g = { image: [], speech: [], text: [], other: [] };
  for (const id of ids) {
    const s = String(id).toLowerCase();
    if (/flux|stable-diffusion|sdxl|sana|consistory|edify|cosmos|bria|image/.test(s)) g.image.push(id);
    else if (/tts|magpie|fastpitch|riva|parakeet|canary|whisper|speech|audio/.test(s)) g.speech.push(id);
    else if (/llama|nemotron|mistral|mixtral|gemma|qwen|phi|deepseek|instruct|chat|gpt/.test(s)) g.text.push(id);
    else g.other.push(id);
  }
  return g;
}

export async function probe({ env = process.env, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const k = pickKey(env);
  if (!k) return { code: 2, say: `열쇠가 없다 — ${NAMES.join(' · ')} 중 어느 이름도 비어 있다(Actions 비밀 이름을 화면에서 본다)` };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  let r, body = '';
  try { r = await fetchImpl(MODELS_URL, { headers: { Authorization: `Bearer ${k.key}`, Accept: 'application/json' }, signal: ctl.signal }); body = await r.text(); }
  catch (e) { return { code: 3, name: k.name, say: `못 닿았다 — ${String(e && e.message).slice(0, 80)} (승인 문제가 아니다)` }; }
  finally { clearTimeout(t); }
  const head = body.slice(0, 300);
  if (r.status === 401 || r.status === 403) return { code: 4, name: k.name, http: r.status, say: '열쇠가 거부됐다(만료·철회·다른 서비스 열쇠)', head };
  if (r.status === 429 || r.status >= 500) return { code: 3, name: k.name, http: r.status, say: '기다리면 낫는다(한도·서버 쪽)', head };
  let j = null; try { j = JSON.parse(body); } catch (_) {}
  const ids = j && Array.isArray(j.data) ? j.data.map((x) => x && x.id).filter(Boolean) : null;
  if (!r.ok || !ids) return { code: 7, name: k.name, http: r.status, say: '대답이 모델 목록 모양이 아니다', head };
  return { code: 0, name: k.name, http: r.status, say: `모델 ${ids.length}개를 받았다`, ids, groups: classify(ids) };
}

async function main() {
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'data/_nvidia';
  await mkdir(out, { recursive: true });
  const at = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); // Asia/Seoul (§5)
  const r = await probe();
  const g = r.groups || {};
  const log = [
    `- 읽은 이름: ${r.name || '(없음)'} · 읽어 본 이름: ${NAMES.join(' · ')}`,
    r.http ? `- HTTP ${r.http} · ${MODELS_URL}` : '',
    r.head ? `- 응답 앞머리: \`${r.head.replace(/`/g, "'").replace(/\s+/g, ' ')}\`` : '',
    ...(r.ids ? ['', `## 갈래 (이름에 든 낱말로 나눔 · 확인 전)`, '', `- 그림 ${g.image.length} · 소리 ${g.speech.length} · 글 ${g.text.length} · 기타 ${g.other.length}`, '',
      '### 그림', ...g.image.map((x) => `- ${x}`), '', '### 소리', ...g.speech.map((x) => `- ${x}`), '', '### 글(앞 30)', ...g.text.slice(0, 30).map((x) => `- ${x}`)] : []),
    '', '- ★ 생성 호출은 아직 안 했다 — 무엇에 쓸지(장면 그림 · 목소리 · 대본 검토) 정한 뒤, 그 모델의 문서대로 진단을 한 번 더 짠다 (§4.3).',
  ].filter((x) => x !== '');
  log.unshift(`# NVIDIA AI 열쇠 진단 · ${at} KST`, '', `판정 ${r.code} — ${r.say}`, ''); // 판정은 요약 맨 앞 (§6-3 ①)
  const md = log.join('\n') + '\n';
  const secrets = NAMES.map((n) => String(process.env[n] || '').trim()).filter((v) => v.length >= 8);
  if (secrets.some((s) => md.includes(s))) { console.error('✗ 요약에 열쇠 값이 섞였다 — 안 쓴다'); process.exit(9); }
  await writeFile(`${out}/_summary.md`, md); console.log(md);
  if (r.code === 2) console.error('✗ 열쇠가 없어 하나도 못 받았다 (판정 2)');
  process.exit(r.code);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
