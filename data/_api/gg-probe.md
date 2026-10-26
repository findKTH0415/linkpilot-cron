> 판정 0 — `GG_DATADREAM_OPENDATA` 가 먹는다. 경기데이터드림 행이 왔다

# `GG_DATADREAM_OPENDATA` 가 먹는가 — 실측 진단

조회일 2026-10-26 (KST) · 경기데이터드림 openapi.gg.go.kr

- 열쇠 **`GG_DATADREAM_OPENDATA`** 로 읽었다 (길이 32자 · 값은 안 적는다)

- `경기지역화폐 가맹점 현황 RegionMnyFacltStus (시험용)` — HTTP 200 · 1135ms
  - 본문 «{"RegionMnyFacltStus":[{"head":[{"list_total_count":414057},{"RESULT":{"CODE":"INFO-000","MESSAGE":"정상 처리되었습니다."}},{"api_version":"1.0"}]},{"row":[{"CMPNM_NM":"장미주단","INDUTYPE_NM":"기타잡화/기타잡화","REFINE_LOTNO_ADDR":"경기도 수원시 팔달구 영동 9-157","REFINE_ROADNM_ADDR":"","REFINE_ZIPNO":"16262","REFINE_WGS84_LOGT» …
  - ★ 본문은 **앞 300자만** 적는다. 판정은 **본문 전체**로 했다 (D-228)
  - 행(row) 칸: **찾았다**
  - 서버 nginx
  - 결과 코드: `INFO-000`
- `일반음식점 현황 Genrestrtlist (시험용)` — HTTP 200 · 939ms
  - 본문 «{"RESULT":{"CODE":"ERROR-310","MESSAGE":"해당하는 서비스를 찾을 수 없습니다. 요청인자 중 SERVICE를 확인하십시오."}}»
  - 행(row) 칸: **못 찾았다**
  - 서버 nginx
  - 결과 코드: `ERROR-310`

> **판정 0** — **값이 왔다** — 이 후보로 배선한다