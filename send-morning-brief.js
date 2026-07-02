/**
 * send-morning-brief.js
 * 매일 지정시간(한국시간) 무인 실행:
 *   ① NAS(sync.php)에서 LinkPilot 데이터(프로젝트/할일/일정/인맥) 조회
 *   ② 오늘 기준 '아침업무 브리핑' 데이터 구성 → Gemini로 8섹션 브리핑 생성
 *   ③ Solapi 친구톡(텍스트)으로 무인 발송 (폰이 꺼져 있어도 동작)
 *
 * 필요한 환경변수(GitHub Secrets):
 *   GEMINI_API_KEY     — Google AI Studio 무료 키 (콤마로 여러 개 가능 — 자동 로테이션)
 *   SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_PFID
 *   NAS_BASE_URL       — 예: https://synologynas.tail43fc79.ts.net (sync.php 호출용)
 *   ONLY_TO            — (테스트) 특정 1명만. 예: 01065503050. 없으면 FRIENDS_URL/RECIPIENTS
 *   FRIENDS_URL / RECIPIENTS — 카드 cron과 동일
 *   SENDER_PHONE       — (선택) 친구톡 실패 시 SMS 대체
 */
'use strict';
const { SolapiMessageService } = require('solapi');

const GEMINI_MODELS = (process.env.GEMINI_MODELS || 'gemini-2.5-flash,gemini-2.0-flash').split(',').map(s => s.trim()).filter(Boolean);
const GEMINI_KEYS = (process.env.GEMINI_API_KEY || '').split(',').map(s => s.trim()).filter(Boolean);

const BRIEF_SYSTEM = `당신은 김대표(CEO) 전담 업무 비서 AI입니다. 매일 오전 '아침 브리핑'을 생성합니다. 휴대폰에서 보기 좋게 큰 흐름으로, 각 섹션을 명확히 구분(섹션 사이 빈 줄 1개)하고 항목은 짧고 굵게.
[근거 규칙] 추측·일반론 금지, 주어진 JSON 데이터에만 근거. 데이터 없으면 "없음". 마크다운(**,#) 금지, 일반 텍스트. 이모지는 섹션 제목에만. 날짜표현은 기준일 기준.
[형식 규칙] 아래 8개 섹션 순서·헤더(이모지+제목) 그대로. 섹션 제목은 한 줄 독립. 섹션 제목 줄과 내용 사이, 섹션과 섹션 사이에 빈 줄 1개.

✅ 오늘 핵심정리

오늘 가장 중요한 일 한 줄.

🌤 날씨 요약

데이터에 날씨가 없으면 "오늘 일정·업무 중심으로 안내드립니다." 한 줄.

🗓 오늘의 일정

일정마다 2줄: 1줄=[시간] [제목] · 참석 [이름] / 2줄=📍 [장소]. 없으면 "오늘 일정 없음".

🚗 이동 동선

첫 미팅장소 → … → 마지막 순서로 한 줄. 없으면 "이동 일정 없음".

🚨 오늘 반드시 처리할 업무

[긴급] 오늘긴급할일 최대 5건 번호로 ([업무] · 마감·관련인).
[보통] 오늘보통할일 최대 5건 번호로.
없으면 "처리할 업무 없음".

🆕 신규 접수 (최근 15일)

신규접수_최근15일 최대 10건. [프로젝트명] · 다음 액션 (접수일 표기 금지). 없으면 "최근 15일 신규 접수 없음".

📂 프로젝트 현황

[타진] 프로젝트현황_타진 최대 10건: [프로젝트명] · 상태 · 다음 액션.
[진행] 프로젝트현황_진행 최대 10건: [프로젝트명] · 상태 · 다음 액션.
없으면 "해당 없음".

🤝 오늘 연락해야 할 사람

오늘긴급할일 관련인 + 프로젝트·소개로 도움 되는 인맥 위주, 최대 6명.
- [이름] / 연결고리 / 연락 이유`;

const pad = n => String(n).padStart(2, '0');
function kstNow() { return new Date(Date.now() + 9 * 3600 * 1000); }
function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
function dateLabel() { const d = kstNow(); const w = '일월화수목금토'[d.getUTCDay()]; return `${d.getUTCFullYear()}년 ${pad(d.getUTCMonth()+1)}월 ${pad(d.getUTCDate())}일 ${w}요일`; }

// 상태 → 단계 표준화 (앱 mapToStage 간이 버전)
function mapToStage(s) {
  s = (s || '').trim();
  if (s === '완료') return '완료';
  if (s === '보류') return '보류';
  if (s === '진행' || s === '해외') return '진행';
  if (s === '타진') return '타진';
  return '접수'; // 접수/접수검토/검토/그 외
}

async function fetchData() {
  const base = (process.env.NAS_BASE_URL || (process.env.FRIENDS_URL || '').replace(/\/friends\.php.*$/, '')).replace(/\/$/, '');
  if (!base) throw new Error('NAS_BASE_URL 없음');
  const r = await fetch(base + '/sync.php?t=' + Date.now(), { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error('sync.php ' + r.status);
  const j = await r.json();
  return j && typeof j === 'object' ? j : {};
}

function buildPayload(data) {
  const contacts = data.contacts || [], projects = data.projects || [], todos = data.todos || [], events = data.events || [];
  const tStr = ymd(kstNow());
  const _15d = ymd(new Date(kstNow().getTime() - 15 * 86400000));
  const todayEvs = events.filter(e => (e.startDate || e.date || '') === tStr || (e.date || '') === tStr)
    .sort((a, b) => (a.time || 'zz').localeCompare(b.time || 'zz'));
  const byStage = s => projects.filter(p => mapToStage(p.status) === s);
  const projMap = p => ({ 제목: p.title, 상태: p.status, 다음액션: (p.memo || '').replace(/\s+/g, ' ').slice(0, 60), 클라이언트: p.client || '', 마감: p.dueDate || '' });
  const recentKey = p => '' + (p.updatedAt || p.createdAt || p.dueDate || '');
  const 신규접수_15일 = byStage('접수').filter(p => { const k = (recentKey(p) || '').slice(0, 10); return k && k >= _15d; })
    .sort((a, b) => recentKey(b).localeCompare(recentKey(a))).slice(0, 10).map(projMap);
  const 이동경로 = todayEvs.filter(e => e.location).map(e => ({ 시간: e.time || '', 장소: e.location }));
  const cmap = c => ({ 이름: c.name, 소속: c.org || '', 소개자: c.referrer || '', 딜: c.deal || '', 활동수: (c.timeline || []).length });
  const 활동활발 = contacts.map(c => ({ c, act: (c.timeline || []).length * 2 + (c.referrer ? 2 : 0) + (c.deal ? 1 : 0) }))
    .sort((a, b) => b.act - a.act).filter(x => x.act > 0).slice(0, 5).map(x => cmap(x.c));
  return {
    날짜: dateLabel(),
    오늘일정: todayEvs.map(e => ({ 시간: e.time || '', 제목: e.title || '', 장소: e.location || '', 참석자: Array.isArray(e.attendees) ? e.attendees.join(',') : (e.attendees || '') })),
    이동경로_시간순: 이동경로,
    오늘긴급할일: todos.filter(t => t.status !== '완료' && t.priority === '긴급').slice(0, 5).map(t => ({ 업무: t.text, 마감: t.date || t.dueDate || '', 관련: t.referrer || t.manager || '' })),
    오늘보통할일: todos.filter(t => t.status !== '완료' && t.priority !== '긴급').slice(0, 5).map(t => ({ 업무: t.text, 마감: t.date || t.dueDate || '', 관련: t.referrer || t.manager || '' })),
    신규접수_최근15일: 신규접수_15일,
    프로젝트현황_타진: byStage('타진').slice(0, 10).map(projMap),
    프로젝트현황_진행: byStage('진행').slice(0, 10).map(projMap),
    연락_활동활발TOP5: 활동활발,
  };
}

async function genBrief(payload) {
  if (!GEMINI_KEYS.length) throw new Error('GEMINI_API_KEY 없음');
  const body = {
    contents: [{ role: 'user', parts: [{ text: '기준일 데이터:\n' + JSON.stringify(payload) + '\n\n위 데이터로 아침 브리핑을 작성하라.' }] }],
    systemInstruction: { parts: [{ text: BRIEF_SYSTEM }] },
    generationConfig: { maxOutputTokens: 2400, temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } },
  };
  for (const model of GEMINI_MODELS) {
    for (const key of GEMINI_KEYS) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
          const j = await r.json();
          if (!r.ok) throw new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
          let out = '';
          (j.candidates?.[0]?.content?.parts || []).forEach(p => { if (p.text) out += p.text; });
          if (out.trim()) return out.trim();
          throw new Error('빈 응답');
        } catch (e) {
          console.warn(`Gemini ${model} 시도 실패: ${e.message}`);
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }
    }
  }
  throw new Error('Gemini 전체 실패');
}

async function loadRecipients() {
  if (process.env.ONLY_TO) {
    const only = process.env.ONLY_TO.split(',').map(s => s.replace(/[^0-9]/g, '')).filter(Boolean);
    if (only.length) { console.log('★ 테스트 모드: ' + only.join(',')); return only; }
  }
  const url = process.env.FRIENDS_URL;
  if (url) {
    try {
      const sep = url.includes('?') ? '&' : '?';
      const r = await fetch(url + sep + 'phones=1', { headers: { 'cache-control': 'no-cache' } });
      if (r.ok) { const arr = await r.json(); if (Array.isArray(arr) && arr.length) return arr; }
    } catch (e) { console.warn('FRIENDS_URL 실패: ' + e.message); }
  }
  return JSON.parse(process.env.RECIPIENTS || '[]');
}

async function main() {
  const recipients = await loadRecipients();
  if (!recipients.length) throw new Error('수신자 없음 (ONLY_TO/FRIENDS_URL/RECIPIENTS)');
  const pfId = process.env.SOLAPI_PFID;
  if (!pfId) throw new Error('SOLAPI_PFID 없음');

  const data = await fetchData();
  const payload = buildPayload(data);
  const text = await genBrief(payload);
  const full = '☀️ 아침업무 브리핑 — ' + dateLabel() + '\n\n' + text;
  console.log('── 브리핑 ──\n' + full + '\n────────────');

  const ms = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);
  const kakaoOptions = { pfId, disableSms: !process.env.SENDER_PHONE };
  const messages = recipients.map(to => ({
    to: String(to).replace(/[^0-9]/g, ''),
    from: process.env.SENDER_PHONE ? String(process.env.SENDER_PHONE).replace(/[^0-9]/g, '') : undefined,
    text: full.slice(0, 3900),
    kakaoOptions,
  }));
  const res = await ms.send(messages);
  console.log('✅ 발송 요청 완료:', JSON.stringify(res?.groupInfo || res, null, 2));
}

main().catch(e => { console.error('❌ 실패:', e.message); process.exit(1); });
