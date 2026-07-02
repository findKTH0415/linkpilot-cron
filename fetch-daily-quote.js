/**
 * fetch-daily-quote.js
 * 매일 무인 실행:
 *   ① 외부 명언 아카이브(Wikiquote 오늘의 명언 / quotable.io)에서 검증된 명언 후보 수집
 *   ② NAS(quote.php?history=1)에서 최근 사용 이력(365일) 조회 → 중복 제외
 *   ③ Gemini로 '오늘의 생각 한 줄' 카드 텍스트 작성 (월·계절·한국 기념일 반영, 한국어)
 *   ④ NAS(quote.php)에 저장 → 앱이 읽어 표시/발송
 *
 * Secrets: GEMINI_API_KEY(콤마 여러개 가능), NAS_BASE_URL
 */
'use strict';
const GEMINI_MODELS = (process.env.GEMINI_MODELS || 'gemini-2.5-flash,gemini-2.0-flash').split(',').map(s=>s.trim()).filter(Boolean);
const GEMINI_KEYS = (process.env.GEMINI_API_KEY || '').split(',').map(s=>s.trim()).filter(Boolean);

const pad = n => String(n).padStart(2,'0');
function kstNow(){ return new Date(Date.now()+9*3600*1000); }
function kstYmd(){ const d=kstNow(); return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate()); }
function dateLabel(){ const d=kstNow(); const w='일월화수목금토'[d.getUTCDay()]; return `${d.getUTCFullYear()}년 ${pad(d.getUTCMonth()+1)}월 ${pad(d.getUTCDate())}일 (${w})`; }

function seasonHoliday(){
  const d=kstNow(); const M=d.getUTCMonth()+1, day=d.getUTCDate();
  const season=(M<=2||M===12)?'겨울':M<=5?'봄':M<=8?'여름':'가을';
  const H={'1-1':'신정','3-1':'삼일절','5-5':'어린이날','5-8':'어버이날','6-6':'현충일','8-15':'광복절','10-3':'개천절','10-9':'한글날','12-25':'성탄절'};
  const notes=[]; const key=M+'-'+day;
  if(H[key])notes.push(H[key]);
  if(M===5)notes.push('가정의 달'); if(M===1)notes.push('새해 시작');
  if(M===3)notes.push('봄·새 학기'); if(M===9||M===10)notes.push('결실·추석 시즌');
  return { month:M+'월', season, holiday:H[key]||'', notes:notes.join(', ') };
}

// ── 외부 명언 후보 수집 ──
async function fetchCandidates(){
  const out=[];
  // ① Wikiquote 오늘의 명언(QOTD) — 영어판 REST 파싱(best effort)
  try{
    const d=kstNow();
    const mon=['January','February','March','April','May','June','July','August','September','October','November','December'][d.getUTCMonth()];
    const title=`Wikiquote:Quote_of_the_day/${mon}_${d.getUTCDate()},_${d.getUTCFullYear()}`;
    const r=await fetch(`https://en.wikiquote.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&origin=*`);
    if(r.ok){ const j=await r.json(); const wt=j?.parse?.wikitext?.['*']||''; const m=wt.match(/\{\{[^}]*quote[^}]*\|([^|}]{15,300})/i); if(m&&m[1]) out.push({content:m[1].replace(/\[\[|\]\]|'''/g,'').trim(),author:'Wikiquote 오늘의 명언'}); }
  }catch(_){}
  // ② quotable.io — 검증된 명언 랜덤 다수(안정적)
  try{
    const r=await fetch('https://api.quotable.io/quotes/random?limit=8&minLength=40&maxLength=180');
    if(r.ok){ const arr=await r.json(); (Array.isArray(arr)?arr:[]).forEach(q=>{ if(q&&q.content)out.push({content:q.content,author:q.author||''}); }); }
  }catch(_){}
  return out;
}

async function gemini(sys, userText){
  if(!GEMINI_KEYS.length) throw new Error('GEMINI_API_KEY 없음');
  const body={ contents:[{role:'user',parts:[{text:userText}]}], systemInstruction:{parts:[{text:sys}]}, generationConfig:{maxOutputTokens:900,temperature:0.7,thinkingConfig:{thinkingBudget:0}} };
  for(const model of GEMINI_MODELS) for(const key of GEMINI_KEYS){
    try{
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const j=await r.json(); if(!r.ok) throw new Error(j?.error?.message||('HTTP '+r.status));
      let o=''; (j?.candidates?.[0]?.content?.parts||[]).forEach(p=>{if(p.text)o+=p.text;}); if(o.trim())return o.trim();
    }catch(e){ console.warn(`Gemini ${model} 실패: ${e.message}`); }
  }
  throw new Error('Gemini 전체 실패');
}

const SYS=`너는 최고급 비즈니스 매거진 수석 에디터다. 카카오톡 공유용 '오늘의 생각 한 줄' 카드 텍스트를 작성한다. 절제미·품격 있는 한국어.
[규칙]
1. 두 톤을 번갈아 사용(약 절반씩): (A) 통찰형 — 제공된 '명언후보'(Wikiquote/quotable 등 검증 아카이브) 중 오늘 시의성(이번달·계절·한국 기념일)에 어울리는 1개 선택, 출처 정확. (B) 감성형 — 인스타 감성처럼 짧고 직관적이며 울림 있는 한두 문장 글귀(출처 불명확하면 "— 오늘의 문장"). 허위 출처·지어낸 오귀속 금지.
2. '최근사용금지_1년'의 인물·문구는 절대 반복하지 말 것.
3. 인물명 뒤 직함 괄호 병기. 명언은 자연스러운 한국어로(원문이 영어면 자연스럽게 번역, 뜻 보존).
4. '오늘의 생각'은 2~3문장, 사업·인생에 즉시 적용 가능한 실천적 해설.
[출력] 아래 양식 그대로(설명 금지). 그리고 맨 끝 줄에 JSON 한 줄 추가: <<{"quote":"선택한 명언(한국어)","author":"인물명(직함)"}>>
─────────────────
오늘의 생각 한 줄
[오늘 날짜]
─────────────────

오늘의 명언

"[선정된 명언]"
— [이름 (직함)]

─────────────────

오늘의 생각

[실천적 해설 2~3문장]

─────────────────`;

async function main(){
  const base=(process.env.NAS_BASE_URL||'').replace(/\/$/,'');
  if(!base) throw new Error('NAS_BASE_URL 없음');
  // 최근 이력(중복방지)
  let hist=[];
  try{ const r=await fetch(base+'/quote.php?history=1&t='+Date.now()); if(r.ok){ const j=await r.json(); if(Array.isArray(j))hist=j; } }catch(_){}
  const recent365=hist.slice(0,365);
  const cands=await fetchCandidates();
  console.log('후보 '+cands.length+'개, 이력 '+recent365.length+'건');
  const ctx={ 오늘날짜:dateLabel(), 맥락:seasonHoliday(), 명언후보:cands.slice(0,10),
    최근사용금지_1년:{ 인물:[...new Set(recent365.map(h=>h.a).filter(Boolean))].slice(0,365), 문구:recent365.map(h=>h.q).filter(Boolean).slice(0,365) } };
  let out=await gemini(SYS, '조건:\n'+JSON.stringify(ctx));
  // JSON 메타 추출
  let quote='', author='';
  const mj=out.match(/<<(\{[\s\S]*?\})>>/); if(mj){ try{ const o=JSON.parse(mj[1]); quote=o.quote||''; author=o.author||''; }catch(_){} }
  out=out.replace(/<<\{[\s\S]*?\}>>/,'').replace(/\[오늘 ?날짜[^\]]*\]/g,dateLabel()).trim();
  console.log('── 오늘의 명언 ──\n'+out+'\n────────────');
  const r=await fetch(base+'/quote.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:out,quote,author,date:kstYmd()})});
  console.log('NAS 저장:', r.ok?'OK':('실패 '+r.status));
  if(!r.ok) process.exit(1);
}
main().catch(e=>{ console.error('❌ 실패:', e.message); process.exit(1); });
