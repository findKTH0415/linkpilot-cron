/**
 * send-morning-card.js
 * 매일 아침(한국시간 6/7시) 무인 실행:
 *   ① Gemini로 "오늘의 생각 한 줄"(프리미엄 명언) 텍스트 생성
 *   ② Solapi 친구톡(CTA)으로 채널 친구 목록에 발송
 *
 * 실행 환경: GitHub Actions (NAS/내 PC 무관, 클라우드 상시). NAS 외부망 불필요.
 *
 * 필요한 환경변수(GitHub Secrets):
 *   GEMINI_API_KEY     — Google AI Studio 무료 키
 *   SOLAPI_API_KEY     — Solapi API Key
 *   SOLAPI_API_SECRET  — Solapi API Secret
 *   SOLAPI_PFID        — 카카오 발신프로필 ID (채널 연동, 예: KA01PF...)
 *   RECIPIENTS         — 수신자 휴대폰 JSON 배열, 예: ["01011112222","01033334444"]
 *   SENDER_PHONE       — (선택) 등록된 발신번호. 친구톡 실패 시 SMS 대체발송용
 *   CARD_IMAGE_URL     — (선택) 친구톡 와이드 이미지로 쓸 공개 이미지 URL. 비우면 텍스트만
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SolapiMessageService } = require('solapi');
const { renderCard } = require('./render-card');

const GEMINI_MODEL = 'gemini-2.5-flash';

// ── 프리미엄 명언 시스템 프롬프트 (앱과 동일 기준) ──
const SYSTEM = `너는 최고급 비즈니스 매거진 수석 에디터다. '오늘의 생각 한 줄' 카드 텍스트를 생성한다. 과도한 수식어 배제, 절제미·강력한 통찰, 품격 있는 한국어.
[규칙]
1. (인물) 세계적 시인·CEO·철학자·투자가·리더 중 1명 자동 선정. 인물명 뒤 직함을 괄호로 병기(예: 라이너 마리아 릴케 (시인)).
2. (글) 명언·시 구절·짧은 글·메시지 중 1개. 너무 흔한 것 금지, 깊이 있고 신선한 실제 문구만.
3. (오늘의 생각) 반드시 2~3문장. 사업과 인생에 즉시 적용 가능한 실천적 해설. 단호하면서 따뜻하게.
[출력] 아래 양식 그대로(설명 금지). [오늘 날짜]엔 제공된 날짜:
오늘의 생각 한 줄
[오늘 날짜]

"[명언]"
— [이름 (직함)]

오늘의 생각
[실천적 해설 2~3문장]`;

// 마무리 인사 — 주 단위 순환(앱과 동일)
const CLOSINGS = [
  '오늘의 통찰이 더 나은 선택과 성장의 밑거름이 되고, 건강과 평안 그리고 새로운 기회가 함께하는 뜻깊은 하루가 되시길 바랍니다.',
  '오늘도 한 줄의 통찰이 더 나은 결정으로 이어지고, 건강과 평안 그리고 새로운 기회가 함께하는 하루가 되시길 바랍니다.',
  '오늘 하루도 건강과 행복을 바탕으로 뜻하시는 모든 일에 좋은 성과와 새로운 기회가 함께하시길 바랍니다.',
  '작은 생각의 변화가 큰 결과를 만듭니다. 오늘도 건강과 평안 속에서 의미 있는 성과를 이루시는 하루 되시길 바랍니다.',
  '오늘의 통찰이 새로운 가능성을 발견하는 계기가 되고, 풍요로운 기회와 행복이 함께하는 하루가 되시길 기원합니다.',
  '건강한 몸과 긍정적인 마음으로 하루를 시작하시고, 소중한 인연과 새로운 기회가 함께하는 뜻깊은 하루 되시길 바랍니다.',
  '오늘의 통찰이 더 큰 성장과 현명한 판단으로 이어지고, 건강과 평안, 그리고 가치 있는 기회가 함께하는 하루 되시길 바랍니다.',
];
const weeklyClosing = () => CLOSINGS[Math.floor(Date.now() / (7 * 86400000)) % CLOSINGS.length];

function kstDateLabel() {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  const w = '일월화수목금토'[d.getUTCDay()];
  return `${d.getUTCFullYear()}년 ${String(d.getUTCMonth() + 1).padStart(2, '0')}월 ${String(d.getUTCDate()).padStart(2, '0')}일 (${w})`;
}

async function generateText() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 없음');
  const date = kstDateLabel();
  const body = {
    contents: [{ role: 'user', parts: [{ text: `오늘 날짜: ${date}\n위 양식대로 출력하라.` }] }],
    systemInstruction: { parts: [{ text: SYSTEM }] },
    generationConfig: { maxOutputTokens: 900, temperature: 0.8, thinkingConfig: { thinkingBudget: 0 } },
  };
  let out = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error('Gemini ' + (j?.error?.message || r.status));
      (j?.candidates?.[0]?.content?.parts || []).forEach(p => { if (p.text) out += p.text; });
      out = (out || '').replace(/\[오늘 ?날짜[^\]]*\]/g, date).trim();
      if (out) break;
      throw new Error('빈 응답');
    } catch (e) {
      console.warn('Gemini 재시도 ' + attempt + '/4: ' + e.message);
      if (attempt === 4) {
        // 폴백: 고정 명언(발송 누락 방지)
        out = '오늘의 생각 한 줄\n' + date + '\n\n"위대한 일은 작은 일들이 모여 이루어진다."\n— 빈센트 반 고흐 (화가)\n\n오늘의 생각\n조급함을 내려놓고 오늘 할 수 있는 한 걸음에 집중하십시오. 꾸준함이 결국 큰 차이를 만듭니다.';
        break;
      }
      await new Promise(res => setTimeout(res, 3000 * attempt));
    }
  }
  return out + '\n\n"' + weeklyClosing() + '"';
}

// 수신자 = ★ONLY_TO(테스트: 특정 1명만) > FRIENDS_URL(앱 친구명단) > RECIPIENTS 시크릿
async function loadRecipients() {
  // ★ 테스트 기간: ONLY_TO 가 있으면 그 번호로만 발송(쉼표로 여러명 가능)
  if (process.env.ONLY_TO) {
    const only = process.env.ONLY_TO.split(',').map(s => s.replace(/[^0-9]/g, '')).filter(Boolean);
    if (only.length) { console.log('★ 테스트 모드: ' + only.join(',') + ' 에게만 발송'); return only; }
  }
  const url = process.env.FRIENDS_URL;
  if (url) {
    try {
      const sep = url.includes('?') ? '&' : '?';
      const r = await fetch(url + sep + 'phones=1', { headers: { 'cache-control': 'no-cache' } });
      if (r.ok) {
        const arr = await r.json();
        if (Array.isArray(arr) && arr.length) return arr;
        console.warn('FRIENDS_URL 명단 비어있음 → RECIPIENTS 폴백');
      } else { console.warn('FRIENDS_URL 응답 오류 ' + r.status + ' → RECIPIENTS 폴백'); }
    } catch (e) { console.warn('FRIENDS_URL 조회 실패(' + e.message + ') → RECIPIENTS 폴백'); }
  }
  return JSON.parse(process.env.RECIPIENTS || '[]');
}

async function main() {
  const recipients = await loadRecipients();
  if (!Array.isArray(recipients) || !recipients.length) throw new Error('수신자 없음 — 앱 친구명단(FRIENDS_URL) 또는 RECIPIENTS 확인');
  console.log('수신자 ' + recipients.length + '명');
  const pfId = process.env.SOLAPI_PFID;
  if (!pfId) throw new Error('SOLAPI_PFID 없음 (카카오 발신프로필 ID)');

  const text = await generateText();
  console.log('── 생성된 명언 본문 ──\n' + text + '\n────────────────────');

  const ms = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);

  // ── 카드 이미지 렌더(서버) → NAS 저장(pcard 음악뷰어용) → Solapi 업로드(imageId) ──
  const dateLabel = kstDateLabel();
  const name = process.env.CARD_NAME || '김태형';
  const company = process.env.CARD_COMPANY || 'PDI Global infrastructure Development Co., Ltd';
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const ymd = kstNow.toISOString().slice(0, 10).replace(/-/g, '');
  const cardId = 'premium-' + ymd;
  const nasBase = (process.env.NAS_BASE_URL || (process.env.FRIENDS_URL || '').replace(/\/friends\.php.*$/, '')).replace(/\/$/, '');

  const kakaoOptions = { pfId, disableSms: !process.env.SENDER_PHONE };
  let viewUrl = nasBase ? (nasBase + '/pcard.php?id=' + encodeURIComponent(cardId) + '&t=' + Date.now()) : '';
  try {
    const buf = await renderCard(text, { date: dateLabel, name, company });
    const dataUrl = 'data:image/jpeg;base64,' + buf.toString('base64');
    // NAS 저장(친구가 '음악과 함께 보기' 누르면 pcard.php가 이 이미지를 보여줌)
    if (nasBase) {
      try {
        const r = await fetch(nasBase + '/book-img.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cardId, image: dataUrl }) });
        console.log('NAS 이미지 저장:', r.ok ? 'OK' : ('실패 ' + r.status));
      } catch (e) { console.warn('NAS 이미지 저장 실패:', e.message); }
    }
    // Solapi 업로드 → imageId (친구톡 이미지형)
    const tmp = path.join(os.tmpdir(), cardId + '.jpg');
    fs.writeFileSync(tmp, buf);
    const up = await ms.uploadFile(tmp, 'KAKAO');
    if (up && up.fileId) { kakaoOptions.imageId = up.fileId; console.log('Solapi 이미지 업로드 OK:', up.fileId); }
  } catch (e) {
    console.warn('카드 이미지 처리 실패 → 텍스트로 발송:', e.message);
  }

  // 버튼: 이미지형이면 '음악과 함께 보기', 아니면 생략
  if (kakaoOptions.imageId && viewUrl) {
    kakaoOptions.buttons = [{ buttonType: 'WL', buttonName: '음악과 함께 보기 ♪', linkMo: viewUrl, linkPc: viewUrl }];
  }
  // 회사명이 길면 공백 기준 2줄로 분할(카카오 캡션이 한 줄을 "..."로 자르지 않도록)
  const splitCo = (co) => { if (!co) return ''; if (co.length <= 22) return co; const mid = co.length / 2; let best = -1; for (let i = 0; i < co.length; i++) { if (co[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i; } return best > 0 ? co.slice(0, best) + '\n' + co.slice(best + 1) : co; };
  // 이미지형이면 본문은 짧게(제목+날짜+보내는사람+회사), 실패 시 전체 텍스트
  const signLines = dateLabel + ' ' + name + ' 드림' + (company ? ('\n' + splitCo(company)) : '');
  const msgText = kakaoOptions.imageId ? ('오늘의 생각 한 줄\n' + signLines) : text;

  const messages = recipients.map(to => ({
    to: String(to).replace(/[^0-9]/g, ''),
    from: process.env.SENDER_PHONE ? String(process.env.SENDER_PHONE).replace(/[^0-9]/g, '') : undefined,
    text: msgText,
    kakaoOptions,
  }));

  const res = await ms.send(messages);
  console.log('✅ 발송 요청 완료:', JSON.stringify(res?.groupInfo || res, null, 2));
}

main().catch(e => { console.error('❌ 실패:', e.message); process.exit(1); });
