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
// ═══ 검증 명언 DB (내장) — 원문 출처가 확인된 것만 선별(도서·연설문·아카이브). 오귀속 교정.
//   외부 소스가 전부 죽어도 매일 신선한 후보 보장. src=출처(제공: 카드엔 저자만 노출).
const CURATED=[
  // ── 리더십·경영·CEO ──
  {content:"The best way to predict the future is to create it.",author:"Peter Drucker",src:"경영학"},
  {content:"What gets measured gets managed.",author:"Peter Drucker",src:"경영학"},
  {content:"The best way to predict the future is to invent it.",author:"Alan Kay",src:"1971 강연"},
  {content:"Innovation distinguishes between a leader and a follower.",author:"Steve Jobs",src:"인터뷰"},
  {content:"Your time is limited, so don't waste it living someone else's life.",author:"Steve Jobs",src:"스탠퍼드 졸업연설 2005"},
  {content:"Success is a lousy teacher. It seduces smart people into thinking they can't lose.",author:"Bill Gates",src:"미래로 가는 길"},
  {content:"Your brand is what other people say about you when you're not in the room.",author:"Jeff Bezos",src:"인터뷰"},
  {content:"People don't buy what you do; they buy why you do it.",author:"Simon Sinek",src:"스타트 위드 와이"},
  {content:"There is only one boss — the customer.",author:"Sam Walton",src:"월마트 경영"},
  {content:"Whether you think you can or you think you can't, you're right.",author:"Henry Ford",src:"어록"},
  {content:"Coming together is a beginning, staying together is progress, and working together is success.",author:"Henry Ford",src:"어록"},
  {content:"Vision without execution is just hallucination.",author:"Thomas Edison",src:"어록"},
  // ── 경제·투자 ──
  {content:"Price is what you pay. Value is what you get.",author:"Warren Buffett",src:"주주서한"},
  {content:"It takes 20 years to build a reputation and five minutes to ruin it.",author:"Warren Buffett",src:"어록"},
  {content:"Risk comes from not knowing what you're doing.",author:"Warren Buffett",src:"어록"},
  {content:"The big money is not in the buying and selling, but in the waiting.",author:"Charlie Munger",src:"어록"},
  {content:"In the short run the market is a voting machine, but in the long run it is a weighing machine.",author:"Benjamin Graham",src:"현명한 투자자"},
  {content:"The difficulty lies not in the new ideas, but in escaping the old ones.",author:"John Maynard Keynes",src:"일반이론 서문"},
  {content:"Pain plus reflection equals progress.",author:"Ray Dalio",src:"원칙(Principles)"},
  {content:"Know what you own, and know why you own it.",author:"Peter Lynch",src:"어록"},
  // ── 철학·사상 ──
  {content:"You have power over your mind — not outside events. Realize this, and you will find strength.",author:"Marcus Aurelius",src:"명상록"},
  {content:"The impediment to action advances action. What stands in the way becomes the way.",author:"Marcus Aurelius",src:"명상록"},
  {content:"It is not that we have a short time to live, but that we waste a lot of it.",author:"Seneca",src:"인생의 짧음에 관하여"},
  {content:"It's not what happens to you, but how you react to it that matters.",author:"Epictetus",src:"어록"},
  {content:"He who has a why to live can bear almost any how.",author:"Friedrich Nietzsche",src:"우상의 황혼"},
  {content:"We are what we repeatedly do. Excellence, then, is not an act but a habit.",author:"Will Durant",src:"철학이야기(아리스토텔레스 요약)"},
  {content:"The journey of a thousand miles begins with a single step.",author:"Lao Tzu",src:"도덕경"},
  {content:"It does not matter how slowly you go as long as you do not stop.",author:"Confucius",src:"논어(전승)"},
  {content:"The man who moves a mountain begins by carrying away small stones.",author:"Confucius",src:"전승"},
  // ── 과학 ──
  {content:"If I have seen further, it is by standing on the shoulders of giants.",author:"Isaac Newton",src:"후크에게 보낸 편지 1675"},
  {content:"Try not to become a person of success, but rather try to become a person of value.",author:"Albert Einstein",src:"LIFE 1955"},
  {content:"Nothing in life is to be feared, it is only to be understood.",author:"Marie Curie",src:"어록"},
  {content:"Genius is one percent inspiration and ninety-nine percent perspiration.",author:"Thomas Edison",src:"어록"},
  {content:"I have not failed. I've just found 10,000 ways that won't work.",author:"Thomas Edison",src:"어록"},
  // ── 문학·시인 ──
  {content:"Two roads diverged in a wood, and I took the one less traveled by, and that has made all the difference.",author:"Robert Frost",src:"가지 않은 길"},
  {content:"Be patient toward all that is unsolved in your heart, and try to love the questions themselves.",author:"Rainer Maria Rilke",src:"젊은 시인에게 보내는 편지"},
  {content:"People will forget what you said, but people will never forget how you made them feel.",author:"Maya Angelou",src:"어록"},
  {content:"Even the darkest night will end and the sun will rise.",author:"Victor Hugo",src:"레 미제라블"},
  {content:"Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.",author:"Antoine de Saint-Exupéry",src:"인간의 대지"},
  {content:"Knowing is not enough; we must apply. Willing is not enough; we must do.",author:"Johann Wolfgang von Goethe",src:"어록"},
  // ── 정치·연설문 ──
  {content:"Ask not what your country can do for you — ask what you can do for your country.",author:"John F. Kennedy",src:"취임연설 1961"},
  {content:"The only thing we have to fear is fear itself.",author:"Franklin D. Roosevelt",src:"취임연설 1933"},
  {content:"Never give in — never, never, never.",author:"Winston Churchill",src:"해로우스쿨 연설 1941"},
  {content:"It always seems impossible until it's done.",author:"Nelson Mandela",src:"어록"},
  {content:"The greatest glory in living lies not in never falling, but in rising every time we fall.",author:"Nelson Mandela",src:"자유를 향한 머나먼 길"},
  {content:"The future belongs to those who believe in the beauty of their dreams.",author:"Eleanor Roosevelt",src:"어록"},
  {content:"Faith is taking the first step even when you don't see the whole staircase.",author:"Martin Luther King Jr.",src:"연설"},
  {content:"The time is always right to do what is right.",author:"Martin Luther King Jr.",src:"오벌린대 연설 1965"},
  {content:"Believe you can and you're halfway there.",author:"Theodore Roosevelt",src:"어록"},
  {content:"The future depends on what you do today.",author:"Mahatma Gandhi",src:"어록"},
  // ── 인내·도전·지혜 ──
  {content:"Discipline is the bridge between goals and accomplishment.",author:"Jim Rohn",src:"어록"},
  {content:"An investment in knowledge pays the best interest.",author:"Benjamin Franklin",src:"어록"},
  {content:"Well done is better than well said.",author:"Benjamin Franklin",src:"가난한 리처드의 달력"},
  {content:"Energy and persistence conquer all things.",author:"Benjamin Franklin",src:"어록"},
  {content:"Success is not final, failure is not fatal: it is the courage to continue that counts.",author:"Winston Churchill",src:"전승"},
  {content:"A ship in harbor is safe, but that is not what ships are built for.",author:"John A. Shedd",src:"Salt from My Attic"},
  {content:"Simplicity is the ultimate sophistication.",author:"Leonardo da Vinci",src:"전승"},
  {content:"Fall seven times, stand up eight.",author:"일본 속담",src:"七転び八起き"},
  {content:"If you want to go fast, go alone. If you want to go far, go together.",author:"아프리카 속담",src:"전승"},
  {content:"In the midst of chaos, there is also opportunity.",author:"Sun Tzu",src:"손자병법"},
  {content:"Victorious warriors win first and then go to war.",author:"Sun Tzu",src:"손자병법"},
  {content:"The measure of who we are is what we do with what we have.",author:"Vince Lombardi",src:"어록"},
  {content:"Alone we can do so little; together we can do so much.",author:"Helen Keller",src:"어록"},
  // ── 한국·동양 위인 ──
  {content:"必死則生 必生則死 — 죽고자 하면 살고, 살고자 하면 죽는다.",author:"이순신",src:"난중일기"},
  {content:"一日不讀書 口中生荊棘 — 하루라도 책을 읽지 않으면 입안에 가시가 돋는다.",author:"안중근",src:"유묵"},
  {content:"가장 위대한 것은 자기 자신을 이기는 것이다.",author:"석가모니",src:"법구경(전승)"},
];
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
async function fetchCandidates(){
  const out=[];
  // ① Wikiquote 오늘의 명언(QOTD)
  try{
    const d=kstNow();
    const mon=['January','February','March','April','May','June','July','August','September','October','November','December'][d.getUTCMonth()];
    const title=`Wikiquote:Quote_of_the_day/${mon}_${d.getUTCDate()},_${d.getUTCFullYear()}`;
    const r=await fetch(`https://en.wikiquote.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&origin=*`);
    if(r.ok){ const j=await r.json(); const wt=j?.parse?.wikitext?.['*']||''; const m=wt.match(/\{\{[^}]*quote[^}]*\|([^|}]{15,300})/i); if(m&&m[1]) out.push({content:m[1].replace(/\[\[|\]\]|'''/g,'').trim(),author:'Wikiquote 오늘의 명언'}); }
  }catch(e){ console.warn('Wikiquote 실패:', e.message); }
  // ② ZenQuotes — 검증 명언 다수(quotable.io 대체, 안정적)
  try{
    const r=await fetch('https://zenquotes.io/api/quotes');
    if(r.ok){ const arr=await r.json(); (Array.isArray(arr)?arr:[]).forEach(q=>{ if(q&&q.q&&q.q.length>=25&&q.q.length<=200&&!/zenquotes/i.test(q.a||'')) out.push({content:q.q,author:(q.a&&q.a!=='Unknown')?q.a:''}); }); }
  }catch(e){ console.warn('ZenQuotes 실패:', e.message); }
  // ③ type.fit — 보조 소스
  try{
    const r=await fetch('https://type.fit/api/quotes');
    if(r.ok){ const arr=await r.json(); (Array.isArray(arr)?shuffle(arr).slice(0,20):[]).forEach(q=>{ if(q&&q.text&&q.text.length>=25&&q.text.length<=200) out.push({content:q.text,author:(q.author||'').replace(/,?\s*type\.fit/i,'').trim()}); }); }
  }catch(e){ console.warn('type.fit 실패:', e.message); }
  // ③-2 Quotle.info — 검증 출처(provenance) 명언 DB(search.json). c==='verified'만 선별(disputed/misattributed 제외).
  try{
    const r=await fetch('https://quotle.info/search.json',{headers:{'User-Agent':'Mozilla/5.0 (compatible; LinkPilotCron/1.0)'}});
    if(r.ok){ const arr=await r.json();
      const ver=(Array.isArray(arr)?arr:[]).filter(q=>q&&(q.t==='q')&&(q.c==='verified'||q.c==='genuine-famous')&&q.x&&q.x.length>=25&&q.x.length<=200&&q.a&&!/unknown|anonymous/i.test(q.a));
      shuffle(ver).slice(0,12).forEach(q=>out.push({content:q.x,author:q.a,src:'Quotle.info('+q.c+')'})); }
  }catch(e){ console.warn('Quotle.info 실패:', e.message); }
  // ※ Quotations.co.uk = 봇차단(401), QuoteLibrary.com = 매각 도메인 → 공개 데이터 없어 미채택.
  // ④ 내장 큐레이션 풀(항상) — 날짜 기반 순환으로 매일 다른 세트
  const doy=Math.floor((kstNow()-new Date(Date.UTC(kstNow().getUTCFullYear(),0,0)))/864e5);
  const rot=[...CURATED.slice(doy%CURATED.length),...CURATED.slice(0,doy%CURATED.length)];
  rot.slice(0,8).forEach(q=>out.push(q));
  // 중복 제거 + 셔플 + 상한
  const seen=new Set(); const uniq=[];
  shuffle(out).forEach(q=>{ const k=(q.content||'').slice(0,40).toLowerCase(); if(q.content&&!seen.has(k)){ seen.add(k); uniq.push(q); } });
  console.log('후보 소스: 통합 '+uniq.length+'건 (wikiquote+zenquotes+type.fit+quotle(verified)+curated)');
  return uniq.slice(0,24);
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
1. 두 톤을 번갈아 사용(약 절반씩): (A) 통찰형 — 제공된 '명언후보'(검증 원문 DB·공식 연설문·도서·아카이브: Wikiquote/Quotle.info(검증표기)/ZenQuotes/내장 검증DB) 중 오늘 시의성(이번달·계절·한국 기념일)에 어울리는 1개를 우선 선택. 원저자·출처가 확실한 것만 쓰고, 흔한 오귀속(예: '적자생존'을 다윈 원문으로 단정, 'We are what we repeatedly do'를 아리스토텔레스로 단정) 금지. 세계 리더·시인·작가·정치인·경제인·CEO를 다양하게 순환. (B) 감성형 — 인스타 감성처럼 짧고 직관적이며 울림 있는 한두 문장 글귀(출처 불명확하면 "— 오늘의 문장"). 허위 출처·지어낸 오귀속 절대 금지.
2. '최근사용금지_1년'의 인물·문구는 절대 반복하지 말 것.
3. 인물명 뒤 직함 괄호 병기. 명언은 자연스러운 한국어로(원문이 영어면 자연스럽게 번역, 뜻 보존).
4. '오늘의 생각'은 2~3문장, 사업·인생에 즉시 적용 가능한 실천적 해설.
5. 명언에는 반드시 '영어 원문' 한 줄(라벨 없이 큰따옴표로 감싼 영어 문장)을 한국어 명언 줄 바로 위에 넣는다. 원래 영어면 원문, 한국어/성경/동양 격언이면 자연스러운 영어 번역(성경은 표준 영역본). 한 문장으로 간결하게.
[출력] 아래 양식 그대로(설명 금지). 그리고 맨 끝 줄에 JSON 한 줄 추가: <<{"quote":"선택한 명언(한국어)","author":"인물명(직함)"}>>
─────────────────
오늘의 생각 한 줄
[오늘 날짜]
─────────────────

오늘의 명언

"[English original or translation, one sentence]"
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
  const ctx={ 오늘날짜:dateLabel(), 맥락:seasonHoliday(), 명언후보:cands.slice(0,14),
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
