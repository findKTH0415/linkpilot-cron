# LinkPilot 최종 배포 전 교차검증 및 API 관리 운영지침

> 문서 목적: LinkPilot 플랫폼의 최종 배포 전에 기능·데이터·API·보안·디자인·인프라를 독립적으로 교차검증하고, 배포 승인 및 장애 복구 책임을 명확히 정의한다.

- 적용 대상: AI Project Manager Orchestrator, Platform Manager, Engine Agent, Engineering Agent, MCP Manager, API Manager, Validation & Release Manager, Design/UX QA, Security QA
- 적용 환경: Synology NAS, LinkPilot Platform, linkpilot-cron, 모바일 및 데스크톱 브라우저
- 문서 상태: 최종 배포 전 운영 기준안
- 핵심 원칙: 개발·검증·배포·최종 승인을 서로 분리한다.

---

## 1. 최종 권고사항

현재 LinkPilot 구조에는 다음 두 가지 보완이 필요하다.

1. **API Manager를 별도 역할로 신설한다.**
2. 기존 Handover Acceptance Manager를 **Validation & Release Manager**로 확대한다.

API Manager는 외부 API와 내부 API의 계약·인증·비용·호출량·장애대응을 담당한다. 다만 API Manager에게 전체 배포 승인권을 부여해서는 안 된다.

Validation & Release Manager는 개발 조직과 독립적으로 모든 검증 증빙을 확인하고, 배포 가능 또는 배포 차단 의견을 Orchestrator에게 제출한다.

---

## 2. 권장 조직구조

### 2.1 총괄 구조

~~~text
AI Project Manager Orchestrator
├─ Build 책임군
│  ├─ Platform Manager
│  ├─ Engine Agent
│  ├─ Engineering Agent
│  └─ Design Manager Agent
├─ Integration 책임군
│  ├─ MCP Manager
│  └─ API Manager
├─ 독립 검증군
│  └─ Validation & Release Manager
│     ├─ Functional/Data QA
│     ├─ Security QA
│     └─ Design/UX QA
└─ 실행환경
   ├─ LinkPilot Staging
   └─ LinkPilot Production
~~~

### 2.2 구조 해석

- **AI Project Manager Orchestrator**는 업무를 배분하고 충돌을 조정하며 최종 사용자 승인을 요청한다.
- **Build 책임군**은 기능을 설계·개발·수정한다.
- **Integration 책임군**은 Agent·MCP·API가 안정적으로 연결되도록 관리한다.
- **독립 검증군**은 개발 결과를 별도의 기준과 테스트 데이터로 재검증한다.
- **LinkPilot Platform**은 승인 역할이 아니라 Staging/Production 실행환경으로 구분한다.

---

## 3. 역할 및 책임

## 3.1 AI Project Manager Orchestrator

### 책임

- 업무 요청을 기능 단위로 분해한다.
- 각 업무에 담당 Agent와 완료 기준을 지정한다.
- Agent 간 우선순위와 인터페이스 충돌을 조정한다.
- Release Candidate 범위를 확정한다.
- 검증보고서를 취합한다.
- READY_TO_DEPLOY 상태를 확인한다.
- 사용자에게 최종 배포 승인을 요청한다.
- 배포 이후 안정화 보고를 받는다.

### 금지사항

- 직접 수정한 코드를 스스로 승인하지 않는다.
- 검증 증빙 없이 완료 처리하지 않는다.
- CRITICAL 또는 HIGH 오류를 임의로 예외 승인하지 않는다.
- 사용자 승인 없이 main 병합 또는 Production 배포를 지시하지 않는다.

### 필수 산출물

- 업무배분표
- 요구사항 추적표
- Release Candidate 범위표
- 최종 승인요청서

---

## 3.2 Platform Manager

### 책임

- 사용자 요구사항과 실제 업무흐름을 정의한다.
- 기능별 Acceptance Criteria를 작성한다.
- UI·Engine·API·DB·Storage 통합상태를 관리한다.
- 실제 데이터 연결 여부를 확인한다.
- 모바일과 데스크톱의 데이터 일관성을 확인한다.
- 배포 후보 버전을 Staging에 전달한다.

### 중점 검증사항

- Galaxy S22와 Mac Safari 간 데이터·이미지 동기화
- iOS Safari와 데스크톱 Chrome 간 동기화
- 프로젝트 수정·삭제 결과의 DB 반영
- 이미지 업로드·수정·삭제·재접속 결과
- 일정·할일·프로젝트 검색 및 필터 기능
- 외출모드 및 네트워크 단절 후 재동기화 〈D-121·D-124·D-135 — 외출모드는 **만들지 않기로** 정해져 있다. 부록 A-10〉

### 필수 산출물

- 요구사항 명세서
- 화면 및 업무흐름 명세서
- 기능별 완료기준표
- Staging 인계서

---

## 3.3 Engine Agent

### 책임

- IM·보고서·사업분석 등 업무 엔진을 개발한다.
- Agent 호출 순서와 업무 로직을 관리한다.
- 입력값·출력값·상태값의 표준을 준수한다.
- 근거자료·출처·계산결과·산출물을 연결한다.
- 오류 시 재시도·대체 엔진 전환·실패상태를 기록한다.

### 금지사항

- 근거 없는 값을 정상 결과처럼 출력하지 않는다.
- UNVERIFIED 결과를 VERIFIED로 표시하지 않는다.
- Mock 데이터 또는 하드코딩 데이터를 Production 결과에 포함하지 않는다.
- 자신의 산출물을 최종 승인하지 않는다.

### 필수 산출물

- Engine 인터페이스 정의서
- 정상·오류·Timeout 응답 명세
- 단위 테스트 결과
- 산출물 근거 추적정보

---

## 3.4 Engineering Agent

### 책임

- Synology NAS와 실행환경을 관리한다.
- Staging과 Production을 분리한다.
- DB·파일·이미지 저장소를 관리한다.
- 인증·권한·Secret·Backup·Restore를 관리한다.
- 빌드·배포·Rollback 절차를 자동화한다.
- 서버 또는 컨테이너 재시작 후 자동복구를 검증한다.
- 장애 발생 시 검증된 이전 버전으로 복구한다.

### 필수 통제

- main 직접 수정 금지
- feature 브랜치 또는 별도 worktree 사용
- 병합 전 자동 테스트 통과
- DB 변경 전 백업 및 Migration 검증
- Production Secret의 개발환경 사용 금지
- 배포본의 버전·소스·의존성 추적

### 필수 산출물

- Build Manifest
- 배포 스크립트
- Backup & Restore 보고서
- Rollback 실행계획
- 운영환경 구성표

---

## 3.5 MCP Manager

### 핵심 질문

> 어떤 MCP와 도구를 선택하고 어떤 Agent에 연결할 것인가?

### 책임

- MCP 등록·권한·사용범위를 관리한다.
- 업무별 주 MCP와 대체 MCP를 지정한다.
- Agent와 MCP 간 입력·출력 연결을 표준화한다.
- 중복·미사용·위험 MCP를 정리한다.
- 장애 시 대체 도구로 전환한다.
- MCP 호출기록·오류·비용을 수집한다.

### API Manager와의 경계

- MCP Manager: 도구 선택, 기능 연결, 호출경로 관리
- API Manager: API 계약, 인증, 쿼터, 비용, 안정성, 장애대응 관리

---

## 3.6 API Manager

### 신설 필요성

LinkPilot은 V-WORLD, 공공데이터, 지도, 뉴스, AI 모델, Gemini 다중 키 등 다양한 API를 사용한다. MCP Manager에게 API 운영까지 모두 맡기면 다음 문제가 발생할 수 있다.

- API Key와 권한관리 사각지대
- 호출량 초과 및 예상하지 못한 과금
- 외부 API 버전 변경 대응 지연
- Timeout·중복호출·재시도 폭주
- Mock 데이터와 실데이터 혼입
- 장애 발생 시 대체 API 전환 실패
- 개인정보 또는 Secret의 로그 노출

### 핵심 질문

> 이 API를 안전하고 안정적이며 비용 통제된 상태로 호출할 수 있는가?

### 책임

1. API Inventory와 API Registry를 관리한다.
2. 각 API의 Owner와 사용 Agent를 지정한다.
3. Endpoint·Method·Request·Response Schema를 관리한다.
4. API 인증방식과 권한범위를 관리한다.
5. 개발·Staging·Production Key를 분리한다.
6. Key·Token·Secret을 소스코드와 로그에 남기지 않는다.
7. Rate Limit·Quota·비용한도를 관리한다.
8. Timeout·Retry·Backoff·Circuit Breaker 정책을 정의한다.
9. 정상·빈값·오류·인증만료 응답을 표준화한다.
10. API 버전 변경과 폐기 일정을 관리한다.
11. 장애 시 대체 API·캐시·수동절차를 지정한다.
12. Gemini 다중 Key의 순환·차단·복구를 관리한다.
13. API 성공률·응답시간·오류율·비용을 보고한다.
14. 개인정보와 민감정보를 로그에서 마스킹한다.
15. API 계약 테스트와 실제 호출 검증을 수행한다.

### API Manager가 가져서는 안 되는 권한

- 전체 Production 배포 최종 승인
- 보안 예외의 단독 승인
- 검증되지 않은 API의 정상 등록
- 비용한도 초과의 단독 승인
- 실패로그 삭제 또는 검증결과 변경

### API Registry 필수 필드

| 구분 | 필수 내용 |
|---|---|
| API ID | API 고유 식별자 |
| API 명칭 | 서비스 및 공급자 명칭 |
| Owner | 내부 관리 책임자 |
| Consumer | 사용하는 Agent 또는 기능 |
| 환경 | Development / Staging / Production |
| Endpoint | Base URL 및 주요 경로 |
| 인증 | API Key / OAuth / Token 등 |
| Secret 위치 | Secret 저장소의 참조 위치 |
| 요청·응답 | Schema 및 필수 필드 |
| 제한 | Rate Limit·일/월 Quota |
| 비용 | 무료한도·단가·예산 |
| Timeout | 연결 및 응답 제한시간 |
| Retry | 횟수·간격·Backoff |
| Fallback | 대체 API·캐시·수동처리 |
| 개인정보 | 수집·전송·저장 여부 |
| 모니터링 | 성공률·오류율·응답시간 |
| 상태 | ACTIVE / DEGRADED / BLOCKED / RETIRED |

### 표준화 기준

API 계약은 가능한 한 OpenAPI 형식으로 관리한다. OpenAPI는 사람과 시스템이 소스코드를 직접 확인하지 않고도 API의 기능과 입출력을 이해할 수 있도록 하는 표준 인터페이스 명세다.

- 공식 기준: [OpenAPI Specification](https://spec.openapis.org/oas/v3.2.0.html)

---

## 3.7 Validation & Release Manager

### 조직상 위치

- Orchestrator에게 직접 보고한다.
- Platform Manager·Engine Agent·Engineering Agent로부터 독립한다.
- 개발 코드를 직접 수정하지 않는 것을 원칙으로 한다.
- 오류는 원 담당 Agent에게 반려하고 수정 후 다시 검증한다.

### 책임

- 요구사항 대비 완료 여부 확인
- 실제 화면·API·DB·Storage 결과 교차확인
- Agent 간 입력·출력과 상태값 일치 확인
- 모바일·데스크톱·브라우저 동기화 검증
- 보안·성능·회귀·복원·Rollback 검증
- 검증 증빙과 미해결 문제 관리
- 배포 가능 또는 배포 차단 의견 제출

### 상태 정의

- VERIFIED: 객관적 증빙으로 정상 확인
- PARTIAL: 일부만 확인
- UNVERIFIED: 검증되지 않음
- BLOCKED: 선행조건 또는 오류로 검증 불가
- FAILED: 요구사항 또는 테스트 실패

PARTIAL, UNVERIFIED, BLOCKED, FAILED 상태를 VERIFIED로 간주하지 않는다.

---

## 4. 교차검증 기본원칙

### 4.1 자기검증 금지

기능을 만든 Agent는 해당 기능을 최종 승인할 수 없다.

### 4.2 독립 기준 사용

두 Agent가 같은 답을 출력했다고 검증된 것으로 판단하지 않는다. 다음 네 가지를 독립적으로 대조한다.

1. 요구사항 문서
2. 실제 화면 동작
3. API·DB·Storage의 실제 값
4. 사용자 업무흐름의 최종 결과

### 4.3 단일 진실원천

DB를 Single Source of Truth로 지정한다. 브라우저 캐시·Local Storage·임시파일이 DB보다 우선해서는 안 된다.

### 4.4 식별자 일관성

모든 시스템은 다음 공통 식별자를 사용한다.

- project_id
- request_id
- task_id
- agent_id
- source_id
- artifact_id
- version
- status
- created_at
- updated_at

### 4.5 추적 가능성

하나의 사용자 요청이 어느 Agent·MCP·API·DB·파일·산출물을 거쳤는지 request_id로 추적할 수 있어야 한다.

---

## 5. 최종 배포 전 검증영역

## 5.1 기능 검증

- [ ] 요구사항별 고유 ID가 부여되었다.
- [ ] 기능별 담당 Agent가 지정되었다.
- [ ] 정상 시나리오가 통과했다.
- [ ] 빈값·중복값·잘못된 값이 처리된다.
- [ ] 수정·삭제·취소·재실행이 정상 작동한다.
- [ ] 권한 없는 사용자의 기능 접근이 차단된다.
- [ ] 오류 메시지가 사용자 행동방법을 안내한다.
- [ ] 새 기능으로 기존 기능이 손상되지 않았다.

## 5.2 데이터 무결성 검증

- [ ] 화면 표시값과 DB 값이 일치한다.
- [ ] API 원본값과 저장값이 일치한다.
- [ ] linkpilot-cron과 linkpilot-platform의 데이터가 일치한다.
- [ ] 중복 저장이 발생하지 않는다.
- [ ] 삭제 데이터가 화면·DB·Storage에 일관되게 반영된다.
- [ ] 수정 충돌 시 최신 버전과 충돌정보가 보존된다.
- [ ] 타임존과 날짜·시간 표시가 일치한다.
- [ ] 데이터 출처와 생성시각을 추적할 수 있다.

## 5.3 기기·브라우저 동기화 검증

다음 조합은 실제 기기에서 검증한다.

| 테스트 항목 | Galaxy S22 | Mac Safari | iOS Safari | Desktop Chrome |
|---|:---:|:---:|:---:|:---:|
| 로그인·로그아웃 | □ | □ | □ | □ |
| 프로젝트 생성 | □ | □ | □ | □ |
| 프로젝트 수정 | □ | □ | □ | □ |
| 프로젝트 삭제 | □ | □ | □ | □ |
| 이미지 업로드 | □ | □ | □ | □ |
| 이미지 수정·삭제 | □ | □ | □ | □ |
| 새로고침 후 유지 | □ | □ | □ | □ |
| 다른 기기 실시간 반영 | □ | □ | □ | □ |
| 네트워크 단절 후 복구 | □ | □ | □ | □ |
| 외출모드 〈D-135 — 만들지 않기로 정해짐 · A-10〉 | □ | □ | □ | □ |

추가 확인:

- [ ] 이미지 URL 또는 파일 ID가 기기별로 달라지지 않는다.
- [ ] 캐시 갱신 후 오래된 이미지가 재등장하지 않는다.
- [ ] 삭제 후 다른 기기에서 삭제 전 데이터가 복원되지 않는다.
- [ ] 동일 항목의 동시 수정 시 충돌정책이 적용된다.

## 5.4 API·MCP 검증

각 API에 대해 다음 상황을 강제로 테스트한다.

- [ ] 정상 응답
- [ ] 빈 응답
- [ ] 잘못된 Schema
- [ ] HTTP 오류
- [ ] Timeout
- [ ] 인증 만료
- [ ] Rate Limit 초과
- [ ] 일·월 Quota 초과
- [ ] 유료한도 초과
- [ ] 외부 서비스 장애
- [ ] 대체 API 전환
- [ ] 중복 호출 방지
- [ ] 재시도 폭주 방지
- [ ] 캐시 데이터의 유효기간
- [ ] 개인정보 및 Secret 로그 마스킹

## 5.5 보안 검증

- [ ] 객체별 접근권한이 적용된다.
- [ ] 관리자 기능에 별도 권한이 적용된다.
- [ ] 인증 Token 만료와 재발급이 정상 작동한다.
- [ ] 다른 사용자의 project_id를 이용한 접근이 차단된다.
- [ ] 업로드 파일 형식·크기·실행 가능성이 제한된다.
- [ ] Secret이 코드·브라우저·로그에 노출되지 않는다.
- [ ] 외부 API 응답을 신뢰하지 않고 검증한다.
- [ ] 과도한 호출로 인한 자원·비용 소모가 제한된다.
- [ ] 사용 중인 API와 폐기 API 목록이 최신 상태다.
- [ ] 보안 설정 오류와 기본계정이 제거되었다.

API 보안검증에는 OWASP API Security Top 10을 기준으로 객체권한, 인증, 속성별 권한, 자원소모, 기능권한, 민감업무흐름, SSRF, 설정오류, API Inventory 및 외부 API 안전성을 확인한다.

- 공식 기준: [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)

## 5.6 성능·안정성 검증

- [ ] 주요 화면 응답시간이 허용기준 이내다.
- [ ] 동시 사용자 증가 시 오류율이 급증하지 않는다.
- [ ] 대용량 PDF·이미지 업로드가 제한 또는 처리된다.
- [ ] API Timeout이 전체 업무를 무한대기시키지 않는다.
- [ ] 재시도 횟수와 대기시간이 제한된다.
- [ ] NAS CPU·메모리·저장공간 임계값이 설정되었다.
- [ ] 로그 파일이 무제한 증가하지 않는다.
- [ ] 서비스 재시작 후 작업상태가 복구된다.

## 5.7 Backup·Restore·Rollback 검증

- [ ] 배포 직전 DB 백업이 생성되었다.
- [ ] 파일·이미지 저장소 백업이 생성되었다.
- [ ] 백업파일의 생성시각과 해시를 기록했다.
- [ ] 별도 환경에서 Restore가 실제 성공했다.
- [ ] DB Migration 이전 버전으로 복구할 수 있다.
- [ ] 이전 애플리케이션 버전으로 전환할 수 있다.
- [ ] Rollback 예상시간과 담당자가 지정되었다.
- [ ] Rollback 후 데이터 손실범위가 명확하다.

---

## 6. Release Gate 절차

## Gate 0. 요구사항 고정

통과조건:

- 요구사항 ID 확정
- 담당 Agent 지정
- 완료기준 확정
- 테스트 방법 확정
- 영향범위 확인

## Gate 1. Feature 개발완료

통과조건:

- feature 브랜치 또는 worktree에서 개발
- 단위 테스트 통과
- 하드코딩·Mock 데이터 제거
- 인터페이스 명세 갱신
- 변경사항 기록

## Gate 2. 자동검사

통과조건:

- 단위 테스트 통과
- 통합 테스트 통과
- API 계약 테스트 통과
- 인증·권한 테스트 통과
- DB Migration 테스트 통과
- 기본 보안검사 통과

## Gate 3. Staging 실환경 검증

통과조건:

- 실제 DB·Storage 연결
- 실제 API 연결
- 실제 NAS 환경 검증
- 모바일·데스크톱·브라우저 검증
- Backup·Restore 검증
- 서버 재시작 및 복구 검증
- 장애·Timeout·Rate Limit 검증

## Gate 4. 독립 Release 검증

READY_TO_DEPLOY 조건:

- CRITICAL 오류 0건
- HIGH 오류 0건
- 핵심 업무 시나리오 100% 통과
- 미검증 필수항목 0건
- 보안정보 노출 0건
- Backup·Restore 성공
- Rollback 성공
- API 비용·Quota 확인
- 기능 및 디자인 검증 완료
- 모든 증빙에 담당자·날짜·버전 기록

MEDIUM 또는 LOW 문제를 남길 경우 반드시 다음 내용을 기록한다.

- 영향범위
- 임시 대응방법
- 담당자
- 수정기한
- 완료기준
- 사용자 또는 승인권자의 위험수용 여부

## Gate 5. 사용자 승인

- Orchestrator가 검증요약을 제출한다.
- 사용자에게 변경사항·잔여위험·Rollback 계획을 보고한다.
- 사용자가 Production 배포를 승인한다.
- 승인 전에는 main 병합 및 Production 배포를 금지한다.

## Gate 6. Production 배포 및 안정화

- main 병합
- 배포본 버전기록
- Production 배포
- 핵심 Smoke Test
- 최소 1시간 집중 모니터링
- 24시간 안정성 관찰
- 장애 시 즉시 Rollback
- 배포결과 보고

---

## 7. 오류 등급 및 차단기준

| 등급 | 판단기준 | 배포처리 |
|---|---|---|
| CRITICAL | 데이터 손실, 인증 우회, 전체 서비스 중단, 복구 불가 | 무조건 배포 차단 |
| HIGH | 핵심기능 실패, 개인정보 노출, 주요 동기화 오류, Rollback 실패 | 배포 차단 |
| MEDIUM | 우회 가능하지만 업무효율 또는 일부 데이터에 영향 | 위험수용 승인 필요 |
| LOW | 경미한 표시·문구·비핵심 개선사항 | 기록 후 제한적 허용 |

다음 문제는 최소 HIGH로 분류한다.

- S22·Safari·Chrome 간 이미지 또는 프로젝트 데이터 불일치
- 프로젝트 삭제 후 데이터 재등장
- 다른 사용자의 데이터 접근
- Production Secret 노출
- 백업은 있으나 실제 복원 실패
- Rollback 실행 불가
- API 과금폭주 또는 호출제한 통제 실패

---

## 8. 모니터링 및 관찰 가능성

모든 사용자 요청과 Agent·MCP·API 호출에 공통 request_id를 사용한다.

### 필수 수집정보

- Trace: 요청이 어느 Agent·MCP·API·DB·파일을 거쳤는지
- Metric: 성공률·오류율·응답시간·호출량·비용
- Log: 요청·응답상태·오류코드·재시도·Fallback

### 필수 대시보드

- 서비스 상태
- Agent별 성공률
- API별 성공률·응답시간
- API별 호출량·비용·Quota
- 동기화 실패 건수
- CRITICAL/HIGH 오류
- Storage 사용량
- Backup 성공 여부
- 최근 배포 버전 및 Rollback 가능 버전

OpenTelemetry의 Trace·Metric·Log 개념을 기준으로 통합 관찰체계를 구성하는 것을 권장한다.

- 공식 기준: [OpenTelemetry Observability Primer](https://opentelemetry.io/docs/concepts/observability-primer/)

---

## 9. 배포 필수 산출물

배포 전 다음 자료가 모두 있어야 한다.

1. Release Manifest
2. 요구사항 추적표
3. API Registry
4. MCP Registry
5. 자동 테스트 보고서
6. 기기·브라우저 교차검증표
7. 보안검증 보고서
8. Known Issues 목록
9. Backup & Restore 보고서
10. Rollback 계획
11. 배포 승인서
12. 배포 후 안정화 보고서

Build Manifest에는 다음 정보를 포함한다.

- Release ID
- Source 브랜치와 Commit
- Build 일시
- Build 담당자
- 주요 의존성
- DB Schema Version
- API Schema Version
- 배포 대상환경
- Artifact 해시
- 이전 복구 가능 버전

소프트웨어가 어떤 소스와 의존성으로 어떻게 만들어졌는지 추적할 수 있도록 Build Provenance를 관리한다.

- 공식 기준: [SLSA Specification](https://slsa.dev/spec/v1.2/)

---

## 10. 최종 배포 승인서 양식

### Release 기본정보

- Release ID:
- 버전:
- 배포 예정일:
- 대상환경:
- 주요 변경사항:
- 담당 Platform Manager:
- 담당 Engineering Agent:
- 담당 API Manager:
- 담당 Validation & Release Manager:

### 검증결과

- 기능검증: PASS / FAIL / BLOCKED
- 데이터검증: PASS / FAIL / BLOCKED
- 기기·브라우저검증: PASS / FAIL / BLOCKED
- API·MCP검증: PASS / FAIL / BLOCKED
- 보안검증: PASS / FAIL / BLOCKED
- 성능검증: PASS / FAIL / BLOCKED
- Backup·Restore: PASS / FAIL / BLOCKED
- Rollback: PASS / FAIL / BLOCKED
- 디자인·UX검증: PASS / FAIL / BLOCKED

### 미해결 문제

| ID | 등급 | 내용 | 영향 | 담당자 | 수정기한 | 위험수용 |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

### 승인 의견

- Validation & Release Manager: READY_TO_DEPLOY / BLOCKED
- Orchestrator 검토: 승인요청 / 재검증요청
- 사용자 최종승인: 승인 / 보류 / 반려
- 승인일시:
- 승인자:

---

## 11. 배포 후 안정화 보고 양식

- Release ID:
- 실제 배포시각:
- 배포 담당자:
- Smoke Test 결과:
- 1시간 집중 모니터링 결과:
- 24시간 안정성 결과:
- 오류 및 장애:
- API 호출량 및 비용 변화:
- 동기화 오류:
- Rollback 여부:
- 후속조치 담당자:
- 후속조치 기한:

---

## 12. 최종 운영원칙

1. 개발한 Agent는 자기 결과를 최종 승인할 수 없다.
2. MCP Manager와 API Manager의 책임을 분리한다.
3. API Manager는 API 안정성은 관리하지만 전체 배포를 승인하지 않는다.
4. Validation & Release Manager는 개발조직과 독립한다.
5. CRITICAL/HIGH 문제가 있으면 배포를 차단한다.
6. 확인되지 않은 사항은 UNVERIFIED 또는 BLOCKED로 표시한다.
7. 실제 기기·실제 브라우저·실제 API·실제 DB로 검증한다.
8. 사용자 승인 전 main 병합과 Production 배포를 금지한다.
9. Backup은 존재 여부가 아니라 실제 Restore 성공으로 검증한다.
10. 모든 배포는 이전 버전으로 복구할 수 있어야 한다.

> 최종 판단기준: “기능이 돌아간다”가 아니라 “문제가 발생해도 원인을 추적하고, 데이터를 보호하며, 즉시 복구할 수 있다”는 상태에서만 배포한다.

---

# 부록 A. 코드·다른 지침과의 대조 〈2026-09-01 · Orchestrator 실측〉

> **이 부록은 원문이 아니다.** 위 §1~§12 는 사장님이 주신 지침 그대로이고, 여기부터는
> **이 저장소에서 실제로 재 본 결과**다. 두 벌이 되지 않게 원문은 **두 곳에만** 손댔다 —
> 「외출모드」 두 줄에 **결정 번호를 덧붙였다.** 지운 것이 아니라 **가리킨 것**이고, 그 이유는 A-10 이다.
>
> 왜 붙이나 — 지침은 **지켜지는지 잴 수 있어야** 지침이다. 잴 수 없는 줄은 반년 뒤에
> 「적혀 있었는데 아무도 안 했다」로 끝난다. `docs/오케스트레이터-운영지침.md` 의
> 부록 A 와 같은 방식이다.

## A-1. 같은 이름이 다른 뜻으로 쓰인다 — **셋** 🔴

이 지침의 상태 낱말이 **이미 쓰이고 있는 낱말과 겹친다.** 겹치는 것 자체는 사고가
아니지만, **어느 뜻인지 안 적히면** 「VERIFIED 입니다」가 두 가지를 뜻하게 된다.

| 낱말 | 이 지침(§3.7 · §6) | 이미 있던 곳 | 무엇이 갈리나 |
|---|---|---|---|
| `VERIFIED` | **검증 판정** — 객관적 증빙으로 정상 확인 | 오케스트레이터 §7 — **작업 진행 단계** (`REVIEW` 다음, `APPROVED` 앞) | 하나는 「됐다」, 하나는 「여기까지 왔다」 |
| `BLOCKED` | **검증 불가** — 선행조건·오류로 못 쟀다 | 오케스트레이터 §7 — **작업 중단** (자료·권한·도구 부족) | 하나는 검사가 막힌 것, 하나는 일이 막힌 것 |
| `FAILED` | **검증 실패** — 요구사항·테스트 불합격 | 오케스트레이터 §7 — **실행 오류** | 하나는 「틀렸다」, 하나는 「죽었다」 |

★★ 그리고 **`READY_TO_DEPLOY` 는 이미 코드에 있다.**
`im-agent/core/design-gate.js` 의 **디자인 게이트 마지막 칸**이다
(`DESIGN_BRIEF → WIREFRAME_APPROVED → DESIGN_READY → DEVELOPING → FUNCTION_VERIFIED
→ DESIGN_VERIFIED → READY_TO_DEPLOY`). 이 지침의 `READY_TO_DEPLOY` 는 **Gate 4 의
릴리스 판정**이다 — **디자인 하나만 끝나도 그 칸이 켜지는데**, 이 지침을 읽는 사람은
그것을 「배포해도 된다」로 읽는다.

**정한 것** — 이름을 바꾸지 않는다(코드 여러 곳에 박혀 있다). 대신 **어느 게이트인지
접두어로 부른다**: 디자인 쪽은 `DESIGN:READY_TO_DEPLOY`, 릴리스 쪽은
`RELEASE:READY_TO_DEPLOY`. 그리고 **새로 겹치는 낱말이 생기면 검사가 빨개진다**
(`im-agent/test/role-guide.test.js`).

## A-2. 조직도에는 있는데 책임이 없는 역할 — **Design Manager Agent** 🟡

§2.1 조직도의 Build 책임군에 `Design Manager Agent` 가 있는데, **§3 에 그 역할의
책임·금지사항·산출물이 없다.** 문서 머리의 「적용 대상」 목록에도 없다.

이 역할은 **이 저장소에 실재한다** — `docs/디자인-Agent-지시서.md` 가 그것이고,
`core/design-gate.js` 의 일곱 칸이 그 역할의 상태기계다. 그러니 없는 역할을 그린 것이
아니라 **있는 역할의 책임이 이 지침에서만 빠진** 것이다.

**정한 것** — 아래 A-6 에 책임을 적는다. 원문 §3 은 안 고친다.

## A-3. 「기존 Handover Acceptance Manager」가 없다 🟡

§1 은 「**기존** Handover Acceptance Manager 를 Validation & Release Manager 로
확대한다」고 적는다. 그런데 그 이름은 **이 문서에도, 이 저장소 어디에도 없다**
(`docs/` 전체 검색 0건). 확대할 원본이 없다.

**정한 것** — 「확대」가 아니라 **신설**로 읽는다. 그러면 「누가 인계를 받았는가」가
비는데, 그 자리는 지금 `docs/인수인계-관리대장.md` 가 대신하고 있다. 그 대장은
**10건 전부 인계자·인수자가 공란**이고 `npm run guard` 가 매번 그것을 짚는다.
Validation & Release Manager 를 세우는 첫 일은 **그 열 칸을 채우는 것**이다.

## A-4. Staging 이 없다 🔴 — Gate 3 가 통째로 못 돈다

§2.1 조직도와 Gate 3 는 `LinkPilot Staging` 을 전제한다. **이 시스템에 Staging 은
없다.** 저장소 전체 검색 0건이고, NAS 는 한 대이며 `deploy-nas` 는 **`main` 푸시에
곧바로 운영 자리로 나간다** (D-88).

★ 그래서 Gate 3 의 통과조건 일곱은 지금 **한 칸도 못 잰다.** 「못 잰 것은 통과가
아니다」(CLAUDE.md §8)이므로 이 상태에서 Gate 3 을 초록으로 적으면 안 된다.

**정한 것** — 둘 중 하나다. ⓐ NAS 안에 `staging/` 자리를 하나 더 두고 배포를 두 단으로
가른다, ⓑ Staging 없이 가되 **Gate 3 을 `UNVERIFIED` 로 못박고** 그 위험을 §10 승인서에
매번 적는다. **사장님 결정 사항**으로 올린다 (`docs/미결정-사항.md`).

## A-5. 이 지침이 요구하는데 지금 없는 장치 — **넷**

| 요구 | 어디 | 지금 상태 | 근거 |
|---|---|---|---|
| Trace·Metric·Log 통합 관찰 | §8 | **없음** | 대시보드 0개 · OpenTelemetry 미도입 |
| API Registry (17개 필드) | §3.6 · §9 | **부분** | 열쇠 표는 `운영지침-공공API-활용.md` 에 있으나 Quota·비용·Timeout·Fallback·상태 칸이 없다 |
| 실기기 교차검증표 | §5.3 | **못 잼** | 이 자리에 기기가 없다. `probe:viewport` 는 **폭만** 재고 실기기가 아니다 |
| Gate 6 의 1시간·24시간 관찰 | §6 | **없음** | 배포 후 자동 관찰 장치가 없다 |

★ `request_id` 는 **있다** (`im-agent/core/request.js`). §4.5 추적성의 뼈대는 이미 섰다.
★ Backup·Restore 는 **있다** (`H-1` · `backup:write` · `backup:drill`). §5.7 은 이미 돈다.

## A-6. 빠진 역할을 채운다 — **여섯**

원문 §3 은 일곱 역할을 정의한다. 실제로 돌려 보니 **주인이 없는 일이 여섯** 남는다.
새 조직을 만들지 않고 **기존 역할에 붙인다** — 역할을 늘리면 그만큼 비는 자리도 는다.

### A-6-1. Design Manager Agent 〈Build 책임군 · A-2 의 빈칸〉

- **책임** — 화면·산출물의 디자인 규격(`디자인-Agent-지시서.md`)을 지키고,
  `core/design-gate.js` 의 일곱 칸을 **한 칸씩** 전진시킨다.
- **금지** — 승인 칸 둘(`WIREFRAME_APPROVED` · `DESIGN:READY_TO_DEPLOY`)을
  **기계가 스스로 켜지 않는다** (D-135). 칸을 건너뛰지 않는다.
- **산출물** — 와이어프레임 · 디자인 검증 보고 · 게이트 이력.

### A-6-2. 비용 승인권자 = **사용자(사장님)** 〈§3.6 이 비운 자리〉

§3.6 은 「API Manager 는 비용한도 초과를 **단독 승인할 수 없다**」고만 적고
**누가 승인하는지**를 안 적는다. 그러면 한도를 넘긴 순간 **아무도 못 멈춘다.**

- 한도 초과·유료 전환·새 유료 API 도입은 **사장님 승인**으로 못박는다 (§10 과 같은 줄).
- API Manager 는 **한도의 80% 에서 미리 알린다** — 넘긴 뒤 알리는 것은 보고가 아니다.

### A-6-3. 장애 지휘(Incident Commander) 〈Gate 6 이 비운 자리〉

「장애 시 즉시 Rollback」의 **지휘 주체**가 없다. 새벽에 나면 누가 판단하는가.

- 평시 지휘는 **Engineering Agent**, 판단이 갈리면 **Orchestrator** 가 정하고
  **사장님께 사후 보고**한다. Rollback 은 **사전 승인 없이 실행한다** —
  되돌리는 것은 지키는 일이라 승인을 기다리는 동안 손해가 는다.
- ★ 다만 **되돌렸어도 빨갛게 끝난다** — 되돌린 것은 서비스를 살린 것이지 배포가 된
  것이 아니다 (CLAUDE.md §8 · `deploy/engine.sh` 와 같은 규칙).

### A-6-4. 기록 주인(Records Owner) 〈A-3 이 드러낸 자리〉

미결정 등록부·결정 기록·인수인계 관리대장의 주인이 없다. 지금 **10건 전부
인계자·인수자가 공란**이다.

- **Validation & Release Manager** 가 갖는다. 배포 승인의 근거가 그 기록이기 때문이다.
- 목표일 없는 항목은 **완료로 판정하지 않는다** (정기점검 지침과 같은 규칙).

### A-6-5. 모델 주인(Model Owner) 〈API Manager 와 갈라 둔다〉

§3.6 은 「AI 모델」을 API Manager 에 넣는데, **모델은 계약이 아니라 결과가 바뀐다.**
같은 키로 같은 호출을 해도 세대가 바뀌면 그림과 문장이 달라진다.

- **표준 세대**는 `core/outputspec.js` 의 `RENDER_STANDARD` 한 곳에만 둔다
  (실사 렌더 = Veras 4.0). 비표준 도구·세대는 `RENDER_TOOL_NONSTANDARD` 로 표시된다.
- 키의 순환·차단·복구(Gemini 다중 키)는 **API Manager**, 세대·프롬프트·결과 회귀는
  **Engine Agent** 다. 갈라 두지 않으면 「키가 멀쩡한데 결과가 나빠진 것」을 아무도 안 본다.

### A-6-6. 독립 검증의 **실체** 〈§4.1 이 지금 지켜지지 않는다〉

§4.1 은 「만든 Agent 는 자기 기능을 최종 승인할 수 없다」다. 그런데 지금 이 저장소는
**만드는 자리와 재는 자리가 같다** — 같은 세션이 코드를 쓰고 `guard` 를 돌리고 내보낸다.

- `guard` 는 **검사이지 승인이 아니다.** 초록은 「낼 수 있다」이지 「내도 된다」가 아니다.
- 승인은 **사장님**이 한다 (§6 Gate 5 · CLAUDE.md §10). 그 사이에 Validation &
  Release Manager 가 서면 좋지만, **지금은 없다는 사실을 적어 둔다.**
  없는 것을 있는 것처럼 그리면 §4.1 이 장식이 된다.

## A-7. 어긋나지 않은 것 — 확인만 하고 지나간다

- §4.3 단일 진실원천 · §4.4 식별자 10개 — 오케스트레이터 §6 과 **같은 말**이다.
- §5.7 Backup·Restore 「존재가 아니라 실제 복원 성공으로」 — `backup:drill` 이 그렇게 잰다.
- §12-6 「확인되지 않은 것은 UNVERIFIED」 — `guard` 의 「못 잰 것은 통과가 아니다」와 같다.
- §12-8 「사용자 승인 전 main 병합 금지」 — 이 세션의 「초안 PR 까지」와 같다 (CLAUDE.md §8-2).

## A-8. 이 부록이 지켜지는지 재는 자리

`im-agent/test/role-guide.test.js` — 넷을 잰다.

1. 조직도에 나오는 역할이 **§3 또는 이 부록에 책임 절을 갖는가** (A-2 가 다시 나지 않게)
2. 상태 낱말이 **새로 겹치지 않는가** — A-1 의 표에 없는 겹침이 생기면 빨개진다
3. CLAUDE.md 가 **이 지침서를 가리키는가** (원문은 한 곳에)
4. 이 지침서의 표가 **CLAUDE.md 로 통째로 복사되지 않았는가** (두 벌 금지)

## A-9. 조직도 역할 대조표 — **어느 역할의 책임이 어디에 적혀 있는가**

§2.1 조직도에 그려진 역할은 **빠짐없이 이 표에 있어야 한다.** 조직도에 이름을 더하고
책임을 안 적으면 그 역할은 **아무도 안 맡은 채로 그림에만 있게 된다** (A-2 가 그랬다).
`role-guide.test.js` 가 이 표와 조직도를 대 본다.

| 조직도의 역할 | 책임이 적힌 곳 | 비고 |
|---|---|---|
| AI Project Manager Orchestrator | §3.1 | |
| Platform Manager | §3.2 | |
| Engine Agent | §3.3 | 모델 세대·결과 회귀도 여기 (A-6-5) |
| Engineering Agent | §3.4 | 장애 지휘도 여기 (A-6-3) |
| Design Manager Agent | **A-6-1** | 원문 §3 에 없어 부록에서 채웠다 |
| MCP Manager | §3.5 | 필수 산출물 절이 없다 — MCP Registry(§9-4)가 그것이다 |
| API Manager | §3.6 | 필수 산출물 절이 없다 — API Registry(§9-3)가 그것이다 |
| Validation & Release Manager | §3.7 | **지금 실체가 없다** (D-202) · 기록 주인도 여기 (A-6-4) |
| Functional/Data QA | §3.7 | Validation 의 하위 — 별도 절 없음 |
| Security QA | §3.7 | 같음 |
| Design/UX QA | §3.7 | 같음 |

★ **환경은 역할이 아니다** — `LinkPilot Staging` · `LinkPilot Production` 은 이 표에
넣지 않는다. 다만 **Staging 은 실재하지 않는다** (A-4 · D-201).

## A-10. 이 지침이 **이미 정해진 결정과 부딪히는 곳** — 하나 🔴

§3.2 중점 검증사항과 §5.3 기기표에 **「외출모드」**가 있다. 그런데 이 기능은
**만들지 않기로 이미 정해져 있다** — D-121(만들지 않는다) · D-124 · D-135(문서에서
실제로 지웠다). 즉 **없앤 기능이 검증 항목으로 되살아났다.**

★★ 이것을 **내가 찾은 것이 아니다.** `npm test` 의 `decision-conflict` 검사가 지침서를
넣자마자 빨개졌다 — 「지웠던 「외출모드」가 지침에 다시 나왔다」. D-135 때
「결정이 있는데 반영이 없으면 결정이 없는 것과 같다」로 만든 장치가
**반대 방향(새 문서가 결정을 되돌리는 것)에서도 작동했다.**

**어느 쪽도 고치지 않는다.** 사양과 결정이 다를 때는 **먼저 등록부에 올린다**
(CLAUDE.md §9 · D-203). 원문의 두 줄에는 **결정 번호만 덧붙였다** — 검사도
「결정을 가리키는 줄」은 위반으로 세지 않는다.

**사장님께 여쭙는 것 — 셋 중 하나입니다.**

| | 뜻 | 딸려 오는 일 |
|---|---|---|
| ⓐ 결정을 유지한다 | 외출모드는 안 만든다 · 이 두 줄을 지운다 | 없음 — 지금 그대로 |
| ⓑ 결정을 뒤집는다 | 외출모드를 만든다 | D-121·D-124·D-135 를 **되돌린 이유와 함께** 다시 연다 · 오프라인 저장과 충돌 정책이 새로 필요하다 |
| ⓒ 뜻이 다른 것이다 | 「네트워크 단절 후 재동기화」를 뜻하신 것이라면 그것은 **이미** 검증 항목이다 | 낱말만 바꾼다 — 가장 값이 싸다 |

★ **ⓒ 로 짚습니다.** §3.2 의 그 줄은 「외출모드 **및** 네트워크 단절 후 재동기화」로
둘을 나란히 적고 있고, §5.3 표에도 「네트워크 단절 후 복구」 줄이 **따로** 있습니다.
겹치는 것이 아니라 **한 낱말이 남아 있는 것**으로 보입니다.
