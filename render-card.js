const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const path = require('path');
GlobalFonts.registerFromPath(path.join(__dirname,'fonts','GothicA1-Bold.ttf'),'CardB');
GlobalFonts.registerFromPath(path.join(__dirname,'fonts','GothicA1-Regular.ttf'),'CardR');
GlobalFonts.registerFromPath(path.join(__dirname,'fonts','GothicA1-Black.ttf'),'CardK');
const NATURE_IDS=[1015,1016,1018,1019,1022,1024,1036,1039,1041,1043,1061,1071,1074,1084,29,28,164,177,184,210];
async function dl(url){ try{ return await loadImage(url); }catch(_){ return null; } }
async function renderCard(text, opts){
  const W=1080,H=1440,padX=86; // 카카오 친구톡 이미지 비율(3:4) 준수
  const o=opts||{}; const name=o.name||'김태형', company=(o.company||'').trim(); const dateLabel=o.date||'';
  const ls=text.split('\n').map(s=>s.trim());
  const isDiv=l=>/^[─-]{3,}$/.test(l);
  const isClose=l=>/^["“]?\s*오늘도 /.test(l)||/바랍니다|기원합니다|드림\s*$/.test(l);
  let person='',quote='',thought='',closing='';
  ls.forEach(l=>{ if(l.indexOf('—')===0&&!person) person=l.replace(/^—\s*/,''); });
  const qline=ls.find(l=>/^["“]/.test(l)&&!/바랍니다|기원합니다|오늘도/.test(l)); if(qline) quote=qline.replace(/^["“]|["”]$/g,'');
  const ti=ls.findIndex(l=>/^오늘의 생각$/.test(l));
  if(ti>=0){ for(let i=ti+1;i<ls.length;i++){const l=ls[i];if(!l)continue;if(isDiv(l)||isClose(l)||/드림$/.test(l)||/^\d{4}년/.test(l))break;thought+=(thought?' ':'')+l;} }
  const ci=ls.findIndex(l=>/^["“]?\s*오늘도 |바랍니다|기원합니다/.test(l)); if(ci>=0) closing=ls[ci].replace(/^["“]|["”]$/g,'');
  const cv=createCanvas(W,H); const x=cv.getContext('2d');
  const GOLD='#D9B779',SILVER='#C9CDD2',WHITE='#F5F5F0',LIME='#AAE106';
  const npid=NATURE_IDS[Math.floor(Date.now()/86400000)%NATURE_IDS.length];
  let bg=await dl('https://picsum.photos/id/'+npid+'/1080/1440'); if(!bg) bg=await dl('https://picsum.photos/seed/lpprem'+(dateLabel||'x')+'/1080/1440');
  if(bg){const iw=bg.width||1,ih=bg.height||1,r=Math.max(W/iw,H/ih),dw=iw*r,dh=ih*r;x.drawImage(bg,(W-dw)/2,(H-dh)/2,dw,dh);}
  else{const g=x.createLinearGradient(0,0,0,H);g.addColorStop(0,'#14241C');g.addColorStop(1,'#1A1C18');x.fillStyle=g;x.fillRect(0,0,W,H);}
  const ov=x.createLinearGradient(0,0,0,H);ov.addColorStop(0,'rgba(6,10,8,.68)');ov.addColorStop(.5,'rgba(6,10,8,.5)');ov.addColorStop(1,'rgba(6,10,8,.74)');x.fillStyle=ov;x.fillRect(0,0,W,H);
  const wrap=(t,font,maxW)=>{x.font=font;const out=[];(t||'').split('\n').forEach(seg=>{let cur='';for(const ch of seg){if(x.measureText(cur+ch).width>maxW){out.push(cur);cur=ch;}else cur+=ch;}out.push(cur);});return out;};
  const center=(lines,font,color,startY,lh)=>{x.font=font;x.fillStyle=color;x.textAlign='center';let y=startY;lines.forEach(l=>{x.fillText(l,W/2,y);y+=lh;});return y;};
  const rule=(y)=>{x.strokeStyle='rgba(201,205,210,.4)';x.lineWidth=1.5;x.beginPath();x.moveTo(W/2-120,y);x.lineTo(W/2+120,y);x.stroke();};
  // 상단
  x.textAlign='left';x.font='44px CardK';{const lwk=x.measureText('LINK').width,pwk=x.measureText('PILOT').width,sx=W/2-(lwk+pwk)/2;x.fillStyle=WHITE;x.fillText('LINK',sx,96);x.fillStyle=LIME;x.fillText('PILOT',sx+lwk+5,96);}
  center(['오늘의 생각 한 줄'],'46px CardB',SILVER,184,0);
  center([dateLabel],'36px CardB',GOLD,238,0);
  rule(288);
  // 명언(중앙)
  let y=380;
  const qLines=wrap('“'+quote+'”','58px CardK',W-padX*2);
  center(qLines,'58px CardK',WHITE,y,76); y+=qLines.length*76+8;
  center(['— '+person],'40px CardB',GOLD,y,0); y+=64;
  rule(y); y+=64;
  // 오늘의 생각
  center(['오늘의 생각'],'36px CardB',SILVER,y,0); y+=58;
  const tLines=wrap(thought,'38px CardR',W-padX*2);
  center(tLines,'38px CardR',WHITE,y,52);
  // 하단(마무리+이름+회사)
  const hasFooter=!!company;
  const cloLines=wrap('“'+(closing||'오늘도 좋은 하루 되시길 바랍니다.')+'”','italic 36px CardR',W-padX*2);
  const cloLH=50, cloBottom=hasFooter?H-160:H-110, cloStart=cloBottom-(cloLines.length-1)*cloLH;
  center(cloLines,'italic 36px CardR',GOLD,cloStart,cloLH);
  if(hasFooter){ center([name+' 드림'],'42px CardB',WHITE,H-94,0); center([company],'34px CardB',WHITE,H-50,0); }
  else center([name+' 드림'],'42px CardB',GOLD,H-56,0);
  return cv.toBuffer('image/jpeg',0.85);
}
module.exports={renderCard};
if(require.main===module){
  const s='오늘의 생각 한 줄\n2026년 06월 24일 (수)\n\n"가장 큰 위험은 위험 없는 삶을 사는 것이다."\n— 세스 고딘 (작가, 기업가)\n\n오늘의 생각\n안전지대를 벗어나 새로운 도전을 모색하는 용기가 필요합니다. 변화를 두려워하지 않고 과감히 나설 때 비로소 성장의 기회가 열립니다.\n\n오늘도 건강과 평안 그리고 좋은 기회가 함께하는 하루 되시길 바랍니다.';
  renderCard(s,{date:'2026년 06월 24일 (수)',name:'김태형',company:'PDI Global infra structure Development'}).then(b=>{require('fs').writeFileSync('/tmp/cardtest/card.jpg',b);console.log('OK',b.length);});
}
