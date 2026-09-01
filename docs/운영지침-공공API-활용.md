# 공공 API 활용 지침서

**대상 저장소** `findKTH0415/linkpilot-cron`
**작성일** 2026년 9월 1일
**용도** GitHub Actions Secrets에 등록된 API 키를 다른 프로젝트에서 재사용하기 위한 절차서

---

## 0. 왜 이 방식인가

Actions Secrets에 저장한 키는 **다시 읽을 수 없습니다.** 편집 화면의 연필 아이콘은 값을 덮어쓰는 버튼이지 보여 주는 버튼이 아닙니다. 저장소 소유자도 마찬가지입니다.

그래서 키를 꺼내는 대신 **키를 쓸 수 있는 곳에서 대신 호출**합니다.

```
GitHub Actions (키 보유)
   ↓ API 호출
   ↓ 결과를 data/ 에 커밋
raw.githubusercontent.com
   ↓ 공개 URL
분석 도구 · 다른 프로젝트
```

키는 저장소 밖으로 나가지 않고 로그에도 남지 않습니다. 결과 파일만 남습니다.

---

## 1. 등록된 키 목록

| Secret 이름 | 발급처 | 용도 | 검증 |
|---|---|---|---|
| `DART_API_KEY` | 금융감독원 전자공시 | 기업 개황·재무제표·감사보고서 원문 | 검증 완료 |
| `REB_API_KEY` | 한국부동산원 R-ONE | 상업용부동산 임대동향(수익률·임대료·공실률) | 검증 완료 |
| `KOSIS_API_KEY` | 통계청 | 인구·가구·사회통계 | 검증 완료 |
| `ECOS_BOK_KEY` | 한국은행 | 금리·환율·통화 | 미검증 |
| `KEPCO_BIGDATA_KEY` | 한국전력 | 전력 사용량 | 미검증 |
| `KMA_APIHUB_KEY` | 기상청 | 관측·통계(일사·일조) | 미검증 |
| `DATA_GO_KR_KEY` | 공공데이터포털 | 범용 공공데이터 | 미검증 |
| `LAW_OPEN_DATA` / `LAW_OC` | 국가법령정보센터 | 법령·판례 | 미검증 |
| `VWORLD_DOMAIN` | 브이월드 | 공간정보·지도 | 미검증 |
| `KRX_API_KEY` | 한국거래소 | 상장·코넥스 시세 | 서비스 승인 필요 |
| `GEMINI_API_KEY` ~ `_8` | 구글 | 생성형 AI | — |
| `PEXELS_API_KEY` | Pexels | 무료 이미지 | — |
| `KICT_API_KEY` | 건설기술연구원 | 건설 관련 | 미검증 |

★ **실측 보강 (2026-09-01 · `im-agent/test/api-guide.test.js` 가 찾음).**
위 표만 보고 새 저장소에 옮기면 **두 개가 빠집니다** — 커넥터는 읽는데 표에 없습니다.

| Secret 이름 | 발급처 | 용도 | 빠지면 |
|---|---|---|---|
| `VWORLD_KEY` | 브이월드 | 지오코딩·지적·토지특성 (`VWORLD_DOMAIN` 과 **짝**) | 지적도가 없어 매스가 직사각형으로 서고 조감도가 안 나온다 |
| `ECOS_API_KEY` | 한국은행 | `ECOS_BOK_KEY` 와 **같은 키의 다른 이름** | — (엔진이 둘 다 읽는다) |

★★ **한국은행과 법제처는 이름이 둘입니다.** 2026-08-26 에 실제로 사고가 났습니다 —
안내 문서는 `ECOS_API_KEY` 인데 넣으신 이름은 `ECOS_BOK_KEY` 였고, **엔진이 한 이름만
보아 넣으신 값이 죽었습니다.** 오류는 안 났습니다. 그래서 답을 **「다시 넣으시라 하지 않고
엔진이 둘 다 읽는다」**로 정했습니다 (`connectors/ecos.js` 의 `KEY_NAMES`,
`connectors/law.js` 의 `LAW_OC`/`LAW_OPEN_DATA`). 새 프로젝트에 옮기실 때도
**둘 중 아무 이름으로 넣으셔도 됩니다.**

★★★ **이 표가 코드와 갈리면 `npm test` 가 빨개집니다** (`api-guide.test.js`).
표에 없는 이름을 커넥터가 읽거나, 표에 있는 이름을 저장소가 아무 데서도 안 부르면
그 자리에서 알려 줍니다 — 이 문서 §9 점검목록 첫 줄을 사람 대신 기계가 셉니다.

---

## 2. 3단계 도입 절차

### 1단계 — 스크립트 작성

`scripts/` 에 `.mjs` 파일을 만듭니다. **확장자가 `.js`면 실행되지 않습니다.** ES 모듈이기 때문입니다.

```javascript
// scripts/example-fetch.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const KEY = process.env.MY_API_KEY;
if (!KEY) { console.error('키 없음'); process.exit(1); }

const OUT = 'data/example';
await mkdir(OUT, { recursive: true });

const r = await fetch(`https://api.example.com/data?key=${KEY}`);
const j = await r.json();

await writeFile(`${OUT}/result.json`, JSON.stringify(j, null, 2));
await writeFile(`${OUT}/_summary.md`, '# 조회 결과\n\n...');
```

### 2단계 — 워크플로 작성

`.github/workflows/` 에 `.yml` 파일을 만듭니다.

```yaml
name: 데이터 수집

on:
  workflow_dispatch:

permissions:
  contents: write

jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: 조회
        env:
          MY_API_KEY: ${{ secrets.MY_API_KEY }}
        run: node scripts/example-fetch.mjs

      - name: 결과 커밋
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/example
          git diff --staged --quiet || git commit -m "데이터 갱신 ($(date +%Y-%m-%d))"
          git push

      - name: 아티팩트 업로드
        uses: actions/upload-artifact@v4
        with:
          name: example-data
          path: data/example
```

### 3단계 — 실행 및 읽기

Actions 탭 → 워크플로 선택 → Run workflow.

결과는 이 주소로 읽습니다.

```
https://raw.githubusercontent.com/findKTH0415/linkpilot-cron/main/data/example/_summary.md
```

---

## 3. 파일 만들 때 자주 틀리는 곳

GitHub 웹에서 파일을 만들 때 **주소에 파일명을 미리 넣으면** 폴더 생성 실수가 없습니다.

```
https://github.com/findKTH0415/linkpilot-cron/new/main?filename=scripts/example-fetch.mjs
https://github.com/findKTH0415/linkpilot-cron/new/main?filename=.github/workflows/example.yml
```

기존 파일을 고칠 때는 `new` 대신 `edit` 입니다.

```
https://github.com/findKTH0415/linkpilot-cron/edit/main/scripts/example-fetch.mjs
```

**내용이 바뀌었는지 확인하는 법.** `.yml` 은 `name:` 으로 시작하고 `.mjs` 는 `//` 로 시작합니다. 첫 글자만 보면 됩니다. 두 파일의 내용이 서로 바뀌는 실수가 가장 잦습니다.

**쓰기 권한.** Settings → Actions → General → 페이지 맨 아래 **Workflow permissions** 를 **Read and write permissions** 로 설정해야 결과 커밋이 됩니다. 안 하면 마지막 단계에서 push가 거부됩니다.

---

## 4. API별 실전 사용법

### 4-1. DART 전자공시

**엔드포인트**

| 용도 | 경로 |
|---|---|
| 고유번호 전체 | `corpCode.xml` (ZIP) |
| 기업 개황 | `company.json` |
| 공시 목록 | `list.json` |
| 재무제표 | `fnlttSinglAcntAll.json` |
| 공시 원문 | `document.xml` (ZIP) |

베이스는 `https://opendart.fss.or.kr/api` 이고 인증 파라미터는 `crtfc_key` 입니다.

**함정 셋**

`pblntf_ty=A`(정기공시)로 조회하면 **비상장 외감법인의 감사보고서가 안 나옵니다.** 감사보고서는 「외부감사관련」 유형이라 걸리지 않습니다. **`pblntf_ty` 를 아예 빼면** 전부 나옵니다.

`corpCode.xml` 과 `document.xml` 은 ZIP으로 옵니다. Node 내장 `zlib.inflateRawSync` 로 풀 수 있고 외부 패키지가 필요 없습니다. 중앙 디렉터리를 읽는 최소 구현이 `scripts/dart-fetch.mjs` 에 있습니다.

`fnlttSinglAcntAll.json` 은 **사업보고서 제출법인만** 됩니다. 비상장 외감법인은 빈 응답이 오므로 감사보고서 원문 XML에서 표를 직접 파싱해야 합니다.

**조회 결과 예시** — `data/dart/_summary.md`

| 회사 | 대표자 | 사업자번호 | 확인 내용 |
|---|---|---|---|
| ㈜서영엔지니어링 | 김종흔 | 138-81-04348 | 매출 956.6억 · 자본 95.9억 (제35기) |
| ㈜엔와이컴퓨터 | 김장수 | 106-81-65222 | 2020년 이후 감사보고서 부재 |
| ㈜키예노 | 고병화 | 220-87-12585 | 매출 577.6억 (제21기) |

### 4-2. 한국부동산원 R-ONE

**엔드포인트** — 베이스 `https://www.reb.or.kr/r-one/openapi`, 인증 파라미터 `KEY`

| 용도 | 경로 |
|---|---|
| 통계표 목록 | `SttsApiTbl.do` |
| 항목·분류 메타 | `SttsApiTblItm.do` |
| 데이터 | `SttsApiTblData.do` |

**함정 넷**

응답 구조가 `[{head:[...]},{row:[...]}]` 입니다. 바깥 배열 길이를 세면 항상 2가 나옵니다. **`row` 키를 재귀로 찾아야** 합니다.

`pSize=2000`을 주면 `ERROR-336 한 번에 최대 1,000건` 이 뜹니다. **전체 결과가 1,000건을 넘어도 거부**되므로 `WRTTIME_IDTFR_ID`(기간)로 좁혀야 합니다.

`CLS_DATANO`(지역 필터)는 **서버에서 무시됩니다.** 무엇을 넣든 같은 결과가 옵니다. 기간만 고정하고 전 페이지를 받아 **클라이언트에서 걸러내야** 합니다.

`SttsApiTblItm.do` 는 한 페이지 100건 상한입니다. `pIndex`로 페이징해야 전체 분류가 보입니다.

**지역 코드** — `CLS_FULLNM` 필드에 `경기>분당역세권` 형태로 들어 있습니다.

| 코드 | 지역 |
|---|---|
| 520152 | 경기 > 분당역세권 |
| 520153 | 경기 > 성남구시가지 |
| 500010 | 경기 (광역) |

동명이의 주의 — 「울산>성남옥교동」이 문자열 필터에 걸립니다.

**핵심 통계표 ID**

| 지표 | 중대형 상가 | 집합 상가 |
|---|---|---|
| 수익률 | `T242083134887473` | `T246393134978815` |
| 임대료 | `T244363134858603` | `T244913134948657` |
| 공실률 | `T249633134845544` | `T243283134931290` |
| 층별임대료 | `T241873134863890` | `T249023134703697` |

**조회 결과 예시** — 분당역세권 2025년 2분기

| 지표 | 분당역세권 | 성남구시가지 |
|---|---:|---:|
| 집합상가 소득수익률 (분기) | 1.07% | 1.00% |
| 집합상가 임대료 | 49,980원/㎡ | 26,630원/㎡ |
| 집합상가 공실률 | 0.18% | 4.72% |

소득수익률은 **분기 기준**입니다. 연환산하려면 4배 합니다.

### 4-3. 통계청 KOSIS

**엔드포인트**

```
통계표 검색  https://kosis.kr/openapi/statisticsSearch.do?method=getList
데이터 조회  https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList
```

인증 파라미터는 `apiKey` 입니다.

**주요 파라미터**

| 이름 | 설명 |
|---|---|
| `orgId` | 기관 코드 (통계청 = 101) |
| `tblId` | 통계표 ID |
| `itmId` | 항목 코드 (`T20+` 형태, `+`가 구분자) |
| `objL1` | 분류 (`ALL` 이면 전체) |
| `prdSe` | 주기 (`Y` 연간, `Q` 분기, `M` 월간) |
| `newEstPrdCnt` | 최근 N개 시점 |

**검증된 통계표**

| tblId | 내용 |
|---|---|
| `DT_1B040A3` | 주민등록 총인구·성별 (시군구) |
| `DT_1JC1502` | 가구원수별 가구 |

**응답이 평평한 배열**로 옵니다. R-ONE과 달리 래퍼가 없습니다. 같은 파서를 쓰려면 배열 처리 분기가 필요합니다.

**조회 결과 예시** — 성남시 분당구

| 항목 | 2023 | 2024 | 2025 |
|---|---:|---:|---:|
| 총인구 | 472,957 | 471,154 | 469,833 |
| 1인 가구 | 51,155 | 52,173 | 52,677 |

### 4-4. KRX 한국거래소

**키 발급만으로는 호출되지 않습니다.** 인증키 발급 후 **서비스별 이용신청과 관리자 승인**이 별도로 필요합니다. 승인 없이 호출하면 401이 뜹니다. 데이터도 익일 오전 8시 갱신이라 실시간이 아닙니다.

비상장·외감법인 조사에는 쓸 수 없습니다. 상장사 시세와 지수 용도입니다.

---

## 5. 응답 파서 — 재사용 가능

서비스마다 응답 구조가 다릅니다. 아래 함수는 R-ONE(`row` 래퍼)과 KOSIS(평평한 배열)를 모두 처리합니다.

```javascript
function rows(o, depth = 0) {
  if (!o || depth > 8) return [];
  if (Array.isArray(o)) {
    const inner = [];
    for (const el of o) { const r = rows(el, depth + 1); if (r.length) inner.push(...r); }
    if (inner.length) return inner;
    return o.filter((x) => x && typeof x === 'object');
  }
  if (typeof o !== 'object') return [];
  if (Array.isArray(o.row)) return o.row;
  for (const [k, v] of Object.entries(o)) {
    if (k === 'head' || k === 'RESULT') continue;
    const r = rows(v, depth + 1);
    if (r.length) return r;
  }
  return [];
}
```

ZIP 해제도 외부 패키지 없이 됩니다.

```javascript
import { inflateRawSync } from 'node:zlib';

function unzip(buf) {
  const files = {};
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('ZIP EOCD 없음');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    files[name] = method === 0
      ? buf.subarray(start, start + csize)
      : inflateRawSync(buf.subarray(start, start + csize));
    p += 46 + nlen + elen + clen;
  }
  return files;
}
```

---

## 6. 진단 우선 원칙

API 규격을 모를 때 추측으로 파라미터를 넣으면 시행착오가 길어집니다. **첫 스크립트는 진단용으로 짭니다.**

- 응답 본문을 200자 이상 그대로 저장
- HTTP 상태 코드와 결과 코드·메시지를 요약에 기록
- 목록 API가 있으면 먼저 호출해 실제 존재하는 코드를 확인
- 필터가 먹지 않으면 전량 수신 후 클라이언트에서 처리

R-ONE은 이 원칙을 지키지 않아 여섯 번 재작성했습니다. `ERROR-336` 메시지 한 줄만 저장했어도 두 번이면 끝났습니다.

---

## 7. 파일 배치 규칙

```
linkpilot-cron/
├── .github/workflows/
│   ├── dart-fetch.yml          기업 조회
│   └── market-fetch.yml        시장 통계
├── scripts/
│   ├── dart-fetch.mjs
│   └── market-fetch.mjs
└── data/
    ├── dart/
    │   ├── _summary.md         사람이 읽는 요약
    │   ├── 회사명.json          원본 응답
    │   └── {고유번호}_{접수번호}_*.xml
    └── market/
        ├── _summary.md
        ├── reb_data.json
        └── kosis_data.json
```

`_summary.md` 를 반드시 만듭니다. JSON 원본은 크고 읽기 어렵습니다. 요약 파일이 있으면 결과 확인이 빠르고, 분석 도구에 넘길 때도 이 파일 하나면 됩니다.

---

## 8. 다른 프로젝트에 적용할 때

**저장소를 새로 만드는 경우** 키를 새 저장소 Secrets에도 등록해야 합니다. Secrets는 저장소 단위이므로 자동으로 공유되지 않습니다. 여러 저장소에서 같은 키를 쓰려면 **Organization Secrets** 로 올리는 편이 낫습니다.

**저장소가 비공개인 경우** `raw.githubusercontent.com` 으로 읽을 수 없습니다. 두 가지 길이 있습니다. 결과 데이터만 공개 저장소나 Gist에 두거나, Actions 실행 화면의 **Artifacts** 에서 내려받아 직접 전달하는 방법입니다.

**커밋이 거부되는 경우** 브랜치 보호 규칙이 걸려 있을 수 있습니다. 워크플로에 아티팩트 업로드 단계를 함께 두면 커밋이 실패해도 결과를 회수할 수 있습니다.

**정기 실행이 필요한 경우** `on:` 에 스케줄을 추가합니다.

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: '0 21 * * 1'   # 매주 월요일 06:00 KST (UTC 기준 표기)
```

---

## 9. 점검 목록

새 API를 붙일 때 이 순서로 확인합니다.

- [ ] Secret 이름이 워크플로의 `env:` 와 정확히 일치하는가
- [ ] 스크립트 확장자가 `.mjs` 인가
- [ ] Workflow permissions 가 Read and write 인가
- [ ] 인증 파라미터 이름이 맞는가 (`crtfc_key` · `KEY` · `apiKey` · `serviceKey`)
- [ ] 응답이 JSON인가 XML인가 ZIP인가
- [ ] 페이징 상한과 전체 결과 상한이 각각 얼마인가
- [ ] 서버 측 필터가 실제로 동작하는가
- [ ] 실패 시 응답 본문을 저장하고 있는가
- [ ] `_summary.md` 를 만들고 있는가
- [ ] 결과 파일에 개인정보나 키가 섞이지 않는가

---

## 10. 보안

**키를 코드에 직접 쓰지 않습니다.** 반드시 `process.env` 로 읽습니다. 한 번이라도 커밋되면 저장소 이력에 영구히 남습니다.

**로그에 키가 찍히지 않게 합니다.** 실패 시 URL 전체를 출력하면 쿼리스트링의 키가 노출됩니다. 경로와 상태 코드만 남기십시오.

**결과 파일을 확인하고 커밋합니다.** 응답 본문을 그대로 저장하는 진단 코드는 요청 URL을 함께 담을 수 있습니다.

키가 노출됐다고 판단되면 **발급처에서 재발급하고 Secrets를 갱신**합니다. Secrets 값만 바꾸면 워크플로는 수정할 필요가 없습니다.
