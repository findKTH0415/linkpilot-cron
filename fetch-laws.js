/**
 * fetch-laws.js — 국가법령정보 공유서비스(law.go.kr OpenAPI) 자동 조회 → NAS(law.php) 저장
 *   GitHub Actions cron에서 실행(외부 HTTPS 가능). NAS PHP는 외부망 불가라 여기서 조회한다.
 *
 *   필요 환경변수(GitHub Secrets):
 *     LAW_OC       : open.law.go.kr 인증키(OC) — 본인 이메일 가입 후 발급
 *     NAS_BASE_URL : 예) http://100.89.242.106  (law.php 위치)
 *     LAW_TOKEN    : (선택) law_token.txt와 동일한 쓰기 토큰
 *
 *   태양광·신재생에너지 관련 법령을 검색해 최신 시행/개정을 추출·저장한다.
 */
const OC = process.env.LAW_OC;
const BASE = (process.env.NAS_BASE_URL||'').replace(/\/$/,'');
const TOKEN = process.env.LAW_TOKEN||'';
if(!OC){ console.error('LAW_OC 없음 — open.law.go.kr 인증키 필요'); process.exit(1); }
if(!BASE){ console.error('NAS_BASE_URL 없음'); process.exit(1); }

// 태양광/재생에너지 사업 인허가와 직결되는 검색어
const QUERIES = ['태양광','신에너지 및 재생에너지','전기사업법','농지법','공유수면 관리 및 매립','분산에너지','환경영향평가법'];

async function searchLaw(q){
  // DRF lawSearch — 법령 목록(JSON). display=최근 공포순 정렬(sort=ddes: 공포일 내림차순)
  const url='https://www.law.go.kr/DRF/lawSearch.do?OC='+encodeURIComponent(OC)+'&target=law&type=JSON&display=20&sort=ddes&query='+encodeURIComponent(q);
  try{
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (LinkPilotLaw/1.0)'}});
    if(!r.ok){ console.error('search fail',q,r.status); return []; }
    const j=await r.json();
    const list=(j&&j.LawSearch&&j.LawSearch.law)|| [];
    const arr=Array.isArray(list)?list:[list];
    return arr.map(x=>({
      name:(x['법령명한글']||'').trim(),
      type:(x['제개정구분명']||'').trim(),        // 제정/일부개정/전부개정 등
      promulDate:(x['공포일자']||'').toString(),   // YYYYMMDD
      enforceDate:(x['시행일자']||'').toString(),
      id:(x['법령ID']||'').toString(),
      url:x['법령상세링크']?('https://www.law.go.kr'+x['법령상세링크']):('https://www.law.go.kr/lsSc.do?query='+encodeURIComponent(x['법령명한글']||q)),
      q
    })).filter(o=>o.name);
  }catch(e){ console.error('err',q,e.message); return []; }
}

(async()=>{
  const seen=new Set(), items=[];
  for(const q of QUERIES){
    const res=await searchLaw(q);
    for(const o of res){ const k=o.id||o.name; if(!seen.has(k)){ seen.add(k); items.push(o); } }
    await new Promise(r=>setTimeout(r,400));
  }
  // 최근 공포순 정렬
  const dnum=s=>parseInt((s||'').replace(/\D/g,'').slice(0,8)||'0',10);
  items.sort((a,b)=>dnum(b.promulDate)-dnum(a.promulDate));
  // 최근 개정(제정/개정)만 별도 추림 — 최근 2년
  const cut=parseInt((new Date().getFullYear()-2)+'0101',10);
  const amendments=items.filter(o=>/개정|제정/.test(o.type)&&dnum(o.promulDate)>=cut).slice(0,20);
  const data={ items:items.slice(0,60), amendments, source:'국가법령정보 공유서비스(law.go.kr)' };
  const rr=await fetch(BASE+'/law.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN,data})});
  const t=await rr.text();
  console.log('법령 수집: 전체 '+items.length+'건, 최근개정 '+amendments.length+'건 → NAS 저장:',t);
})();
