# 〈전달용 · 코드〉 로그인 화면에서 기기 자리를 비울 수 있게 하는 패치

> **이 파일을 `linkpilot-platform` 을 만지는 분께 그대로 전달해 주십시오.**
>
> 대상 파일: `linkpilot-platform.deploy.html` (기기 표식·로그인 게이트가 여기에만 있습니다.
> `linkpilot-platform.html` 에는 `lp_device_id` 가 한 번도 나오지 않습니다 — 실측)
>
> 왜 필요한지·무엇이 틀렸는지는 `전달-platform-기기-3대-제한-…` 문서를 먼저 보십시오.

〈2026-08-30〉

---

## 이 패치가 하는 일

기기 3대가 꽉 찼을 때 **로그인 화면에서 바로 자리를 비우고 그대로 로그인**할 수
있게 합니다. 지금은 목록만 보여 주고 단추가 없어, 세 자리가 모두 손댈 수 없는
기기가 되면 계정 주인이 영영 못 들어옵니다.

**보안이 약해지지 않습니다.** 한도 검사는 비밀번호 검증을 통과한 뒤에만 오므로,
이 화면에서 해제를 허용하는 것은 앱 안의 [등록 기기] 해제와 권한이 같습니다.

## 바꾸는 곳 다섯

파일이 한 줄로 아주 긴 압축본이라, **찾을 글자(앵커)를 그대로 적습니다.**
다섯 앵커 모두 파일 안에 **정확히 한 번씩** 나옵니다(실측).

### ① 상태를 하나 더 둡니다

**찾을 글자**

    const[devList,sDevList]=useState(null);

**바꿀 글자** — 위 글자 **뒤에** 아래를 이어 붙입니다.

    const[devPend,sDevPend]=useState(null);

주석을 함께 남겨 주십시오: 「한도 초과로 멈춘 로그인 — 비밀번호는 이미 확인됐다.
자리를 비우면 그대로 이어서 끝낸다(다시 입력받지 않는다)」

### ② 한도 초과 분기에서 멈춘 로그인을 기억합니다

**찾을 글자** (한 줄입니다)

    const dv=lpRegisterDevice(base);if(dv.over){sErr('이 계정은 기기 '+LP_MAX_DEVICES+'대까지만 사용할 수 있습니다. 기존 기기에서 [내 정보 → 로그인 → 등록 기기]로 해제한 뒤 다시 시도하세요.');sDevList(dv.devices);return;}

**바꿀 글자**

    const dv=lpRegisterDevice(base);if(dv.over){sErr('이 계정은 기기 '+LP_MAX_DEVICES+'대까지만 사용할 수 있습니다. 쓰지 않는 기기를 아래에서 [비우기] 한 뒤 바로 로그인하세요.');sDevList(dv.devices);sDevPend({base:base,legacy:legacy,bootstrap:bootstrap});return;}

### ③ 성공 경로에서도 그 기억을 지웁니다

**찾을 글자**

    sErr('');sFailCount(0);sDevList(null);onLogin({...base

**바꿀 글자**

    sErr('');sFailCount(0);sDevList(null);sDevPend(null);onLogin({...base

### ④ 자리를 비우고 로그인을 끝내는 함수를 넣습니다

**찾을 글자**

    const[loginBusy,sLoginBusy]=useState(false);

**바꿀 글자** — 위 글자 **앞에** 아래 함수를 넣습니다.

    const releaseSlot=async i=>{
      const p=devPend;if(!p||!Array.isArray(devList))return;
      const gone=devList[i];if(!gone)return;
      if(!window.confirm('['+(gone.name||'기기')+'] 자리를 비우고 이 기기로 로그인할까요?'))return;
      const kept=devList.filter((_,j)=>j!==i);
      kept.push({id:lpDeviceId(),name:lpDeviceName(),firstSeen:lpPwStamp(),lastSeen:lpPwStamp()});
      let cred=null;if(p.legacy||p.bootstrap){try{cred=await lpMakePw(pw);}catch(_){cred=null;}}
      sErr('');sFailCount(0);sDevList(null);sDevPend(null);
      onLogin({...p.base,...(cred||{}),role:lpIsAdmin(p.base)?'admin':'user',devices:kept,_pwUpgraded:!!cred});
    };

★ 저장은 `onLogin`(=`handleLogin`) 이 합니다 — 회원 레코드의 `devices` 를 덮고
  `__lpNasSync` 로 동기화하는 길이 이미 그것뿐입니다. 따로 저장하지 마십시오.

### ⑤ 목록의 각 줄에 [비우기] 단추를 답니다

**찾을 글자** (한도 초과 안내 상자 안, 목록을 그리는 자리)

    devList.map((d,i)=>/*#__PURE__*/React.createElement("p",{key:i,style:{fontSize:11.5,color:'#7F1D1D',fontWeight:'700',lineHeight:1.6}},"\xB7 ",d.name||'기기'," ",/*#__PURE__*/React.createElement("span",{style:{color:'#B91C1C',fontWeight:'600'}},(d.lastSeen||'').slice(0,10))))

**바꿀 글자** — 줄을 가로 배치로 바꾸고 오른쪽에 단추를 답니다.

    devList.map((d,i)=>/*#__PURE__*/React.createElement("div",{key:i,style:{display:'flex',alignItems:'center',gap:8,padding:'3px 0'}},/*#__PURE__*/React.createElement("p",{style:{flex:1,minWidth:0,fontSize:11.5,color:'#7F1D1D',fontWeight:'700',lineHeight:1.6,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},"\xB7 ",d.name||'기기'," ",/*#__PURE__*/React.createElement("span",{style:{color:'#B91C1C',fontWeight:'600'}},(d.lastSeen||'').slice(0,10))),devPend&&/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>releaseSlot(i),style:{flexShrink:0,fontSize:11,fontWeight:'900',borderRadius:8,padding:'5px 10px',border:'1px solid #FCA5A5',background:'#fff',color:'#B91C1C',cursor:'pointer'}},"비우기")))

★ 마지막 글자 `비우기` 는 「비우기」입니다. 이 파일은 한글을
  이스케이프로 적는 자리가 많아 그 관례를 따랐습니다.

## 확인 절차

1. 기기 3대를 채운 계정으로 **네 번째** 자리(시크릿 창이 가장 쉽습니다)에서 로그인합니다.
2. 한도 초과 상자에 줄마다 **[비우기]** 가 보이는지 봅니다.
3. 하나를 눌러 되묻는 창에서 확인 → **그대로 앱으로 들어가야** 합니다.
4. [내 정보 → 로그인 → 등록 기기] 에서 목록이 **3/3** 이고, 비운 기기가 사라지고
   지금 기기가 「현재 기기」로 표시되는지 봅니다.
5. 다른 기기에서도 같은 목록이 보이는지 봅니다(NAS 동기화가 됐다는 뜻입니다).

## 함께 봐 주시면 좋은 것 — 급하지 않습니다

- 한도 초과 목록에서 **마지막 접속이 가장 오래된 줄**에 「가장 오래됨」을
  표시해 주십시오. 어느 것을 비울지 고르기 쉬워집니다.
- **자동으로 밀어내지는 마십시오.** 남의 기기가 조용히 끊기면 그쪽에서는
  원인을 알 수가 없습니다.
