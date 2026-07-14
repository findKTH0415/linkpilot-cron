const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const path = require('path');
GlobalFonts.registerFromPath(path.join(__dirname,'fonts','GothicA1-Bold.ttf'),'CardB');
GlobalFonts.registerFromPath(path.join(__dirname,'fonts','GothicA1-Regular.ttf'),'CardR');
GlobalFonts.registerFromPath(path.join(__dirname,'fonts','GothicA1-Black.ttf'),'CardK');
// ★ 밝고 환한 '아침 분위기' 큐레이션 사진 풀(자연·풍경·아침호수·아침식사·반려동물·꽃·맑은하늘) — 매일 순환
//   어둡고 우울한 사진 배제, 청정하고 명랑한 톤만 선별.
const BRIGHT_MORNING=[
  '1470770903676-69b98201ea1c','1441974231531-c6227db76b6e','1501854140801-50d01698950b',
  '1464822759023-fed622ff2c3b','1490750967868-88aa4486c946','1495197359483-d092478c170a',
  '1533089860892-a7c6f0a88666','1525351484163-7529414344d8','1548199973-03cce0bbc87b',
  '1514888286974-6c03e2ca1dba','1470252649378-9c29740c9fa8','1444927714506-8492d94b5ba0',
  '1470071459604-3b5ec3a7fe05','1418065460487-3e41a6c84dc5','1500534623283-312aade485b7',
  '1508672019048-805c876b67e2'
];
const uUrl=(id,w,h)=>'https://images.unsplash.com/photo-'+id+'?w='+w+'&h='+h+'&fit=crop&crop=entropy&q=85&auto=format';
async function dl(url){ try{ return await loadImage(url); }catch(_){ return null; } }
async function renderCard(text, opts){
  const W=1080,H=1440,padX=86; // 카카오 친구톡 이미지 비율(3:4) 준수
  const o=opts||{}; const name=o.name||'김태형', company=(o.company||'').trim(); const dateLabel=o.date||'';
  const ls=text.split('\n').map(s=>s.trim());
  const isDiv=l=>/^[─-]{3,}$/.test(l);
  const isClose=l=>/^["“]?\s*오늘도 /.test(l)||/바랍니다|기원합니다|드림\s*$/.test(l);
  let person='',quote='',quoteEn='',thought='',closing='';
  ls.forEach(l=>{ if(l.indexOf('—')===0&&!person) person=l.replace(/^—\s*/,''); });
  // 명언 인용줄(닫는인사 제외) — 영문(한글 없음)=quoteEn, 한글=quote
  const qcands=ls.filter(l=>/^["“]/.test(l)&&!/바랍니다|기원합니다|오늘도/.test(l));
  const enline=qcands.find(l=>!/[가-힣]/.test(l)); if(enline) quoteEn=enline.replace(/^["“]|["”]$/g,'').trim();
  const kline=qcands.find(l=>/[가-힣]/.test(l)); if(kline) quote=kline.replace(/^["“]|["”]$/g,'');
  const ti=ls.findIndex(l=>/^오늘의 생각$/.test(l));
  if(ti>=0){ for(let i=ti+1;i<ls.length;i++){const l=ls[i];if(!l)continue;if(isDiv(l)||isClose(l)||/드림$/.test(l)||/^\d{4}년/.test(l))break;thought+=(thought?' ':'')+l;} }
  const ci=ls.findIndex(l=>/^["“]?\s*오늘도 |바랍니다|기원합니다/.test(l)); if(ci>=0) closing=ls[ci].replace(/^["“]|["”]$/g,'');
  const cv=createCanvas(W,H); const x=cv.getContext('2d');
  const GOLD='#D9B779',SILVER='#C9CDD2',WHITE='#F5F5F0',LIME='#AAE106';
  const di=Math.floor(Date.now()/86400000);
  // ★ 테마별 배경: 성경말씀(경건·일출·빛·잔잔한물) / 명언(계절 부합 상쾌한 아침)
  const SCRIPTURE_MORNING=['1508672019048-805c876b67e2','1500534623283-312aade485b7','1441974231531-c6227db76b6e','1501854140801-50d01698950b','1418065460487-3e41a6c84dc5','1464822759023-fed622ff2c3b','1470252649378-9c29740c9fa8','1470770903676-69b98201ea1c'];
  const _mon=(new Date()).getMonth()+1;
  const _season=(_mon>=3&&_mon<=5)?'spring':(_mon>=6&&_mon<=8)?'summer':(_mon>=9&&_mon<=11)?'autumn':'winter';
  const SEASON_MORNING={
    spring:['1464822759023-fed622ff2c3b','1490750967868-88aa4486c946','1470252649378-9c29740c9fa8','1501854140801-50d01698950b','1418065460487-3e41a6c84dc5'],
    summer:['1500534623283-312aade485b7','1501854140801-50d01698950b','1508672019048-805c876b67e2','1418065460487-3e41a6c84dc5','1470770903676-69b98201ea1c'],
    autumn:['1441974231531-c6227db76b6e','1470071459604-3b5ec3a7fe05','1470252649378-9c29740c9fa8','1444927714506-8492d94b5ba0','1418065460487-3e41a6c84dc5'],
    winter:['1508672019048-805c876b67e2','1470770903676-69b98201ea1c','1444927714506-8492d94b5ba0','1500534623283-312aade485b7','1441974231531-c6227db76b6e'],
  };
  // 성경말씀 감지: 인물칸이 성경 장절(예 빌립보서 4:13) 또는 종교 키워드
  const isScr = /\d+\s*:\s*\d+/.test(person) || /(성경|말씀|장|절|시편|복음|서\b)/.test(person) || /(주님|하나님|여호와|예수|은혜|믿음|성령)/.test(quote+' '+thought);
  const POOL = isScr ? SCRIPTURE_MORNING : (SEASON_MORNING[_season]||BRIGHT_MORNING);
  const bpid=POOL[di%POOL.length];
  let bg=await dl(uUrl(bpid,W,H));
  if(!bg) bg=await dl(uUrl(POOL[(di+3)%POOL.length],W,H));
  if(!bg) bg=await dl(uUrl(BRIGHT_MORNING[(di+7)%BRIGHT_MORNING.length],W,H));
  if(!bg) bg=await dl('https://picsum.photos/seed/lpprem'+(dateLabel||'x')+'/1080/1440');
  if(bg){const iw=bg.width||1,ih=bg.height||1,r=Math.max(W/iw,H/ih),dw=iw*r,dh=ih*r;x.drawImage(bg,(W-dw)/2,(H-dh)/2,dw,dh);}
  else{const g=x.createLinearGradient(0,0,0,H);g.addColorStop(0,'#3A5A72');g.addColorStop(.5,'#4A6B6A');g.addColorStop(1,'#3E5545');x.fillStyle=g;x.fillRect(0,0,W,H);}
  // 스크림(밝은 아침 사진 톤 유지 + 흰 글씨 가독성) — 상·하단만 은은하게
  const ov=x.createLinearGradient(0,0,0,H);ov.addColorStop(0,'rgba(6,10,8,.44)');ov.addColorStop(.42,'rgba(6,10,8,.18)');ov.addColorStop(.6,'rgba(6,10,8,.2)');ov.addColorStop(1,'rgba(6,10,8,.52)');x.fillStyle=ov;x.fillRect(0,0,W,H);
  x.shadowColor='rgba(0,0,0,.55)';x.shadowBlur=10;x.shadowOffsetY=1;
  const wrap=(t,font,maxW)=>{x.font=font;const out=[];(t||'').split('\n').forEach(seg=>{let cur='';for(const ch of seg){if(x.measureText(cur+ch).width>maxW){out.push(cur);cur=ch;}else cur+=ch;}out.push(cur);});return out;};
  const center=(lines,font,color,startY,lh)=>{x.font=font;x.fillStyle=color;x.textAlign='center';let y=startY;lines.forEach(l=>{x.fillText(l,W/2,y);y+=lh;});return y;};
  const rule=(y)=>{x.strokeStyle='rgba(201,205,210,.4)';x.lineWidth=1.5;x.beginPath();x.moveTo(W/2-120,y);x.lineTo(W/2+120,y);x.stroke();};
  // 상단
  x.textAlign='left';x.font='44px CardK';{const lwk=x.measureText('LINK').width,pwk=x.measureText('PILOT').width,sx=W/2-(lwk+pwk)/2;x.fillStyle=WHITE;x.fillText('LINK',sx,96);x.fillStyle=LIME;x.fillText('PILOT',sx+lwk+5,96);}
  center(['오늘의 생각 한 줄'],'46px CardB',SILVER,184,0);
  center([dateLabel],'36px CardB',GOLD,238,0);
  rule(288);
  // 명언(중앙) — 영문 원문(위) + 한글, 진한 검은 그림자(박스 대신)
  const enLines=quoteEn?wrap('“'+quoteEn+'”','italic 34px CardR',W-padX*2):[];
  const qLines=wrap('“'+quote+'”','58px CardK',W-padX*2);
  const enLH=46, qLH=76;
  const enH=enLines.length?(enLines.length*enLH+18):0;
  const enFirst=380;
  const qFirst=380+enH+(enLines.length?10:0);
  const personY=qFirst+(qLines.length-1)*qLH+64;
  // ★ 명언 글자에 진한 검은 그림자 — 밝은 배경에서도 하얀 글씨 또렷하게
  x.save();x.shadowColor='rgba(0,0,0,.85)';x.shadowBlur=16;x.shadowOffsetY=2;
  if(enLines.length){center(enLines,'italic 34px CardR',SILVER,enFirst,enLH);}
  center(qLines,'58px CardK',WHITE,qFirst,qLH);
  center(['— '+person],'40px CardB',GOLD,personY,0);
  x.restore();
  x.shadowColor='rgba(0,0,0,.55)';x.shadowBlur=10;x.shadowOffsetY=1;
  let y=personY+64;
  rule(y); y+=64;
  // 오늘의 생각
  center(['오늘의 생각'],'36px CardB',SILVER,y,0); y+=58;
  const tLines=wrap(thought,'38px CardR',W-padX*2);
  center(tLines,'38px CardR',WHITE,y,52);
  // 하단(마무리+이름만 — 회사명 제거)
  const cloLines=wrap('“'+(closing||'오늘도 좋은 하루 되시길 바랍니다.')+'”','italic 36px CardR',W-padX*2);
  const cloLH=50, cloBottom=H-110, cloStart=cloBottom-(cloLines.length-1)*cloLH;
  center(cloLines,'italic 36px CardR',GOLD,cloStart,cloLH);
  center([name+' 드림'],'42px CardB',WHITE,H-56,0);
  return cv.toBuffer('image/jpeg',0.72); // ★ 초경량화(0.85→0.72) — pcard 뷰어 빠른 스트리밍
}
module.exports={renderCard};
if(require.main===module){
  const s='오늘의 생각 한 줄\n2026년 06월 24일 (수)\n\n"가장 큰 위험은 위험 없는 삶을 사는 것이다."\n— 세스 고딘 (작가, 기업가)\n\n오늘의 생각\n안전지대를 벗어나 새로운 도전을 모색하는 용기가 필요합니다. 변화를 두려워하지 않고 과감히 나설 때 비로소 성장의 기회가 열립니다.\n\n오늘도 건강과 평안 그리고 좋은 기회가 함께하는 하루 되시길 바랍니다.';
  renderCard(s,{date:'2026년 06월 24일 (수)',name:'김태형',company:'PDI Global infra structure Development'}).then(b=>{require('fs').writeFileSync('/tmp/cardtest/card.jpg',b);console.log('OK',b.length);});
}
