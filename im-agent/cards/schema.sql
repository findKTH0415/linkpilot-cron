-- ============================================================
-- LinkPilot 명함/인맥 DB 스키마 (SQLite)
-- 적용: sqlite3 linkpilot.db < schema.sql   (또는 cards-api 가 첫 기동에 적용)
-- 설계 원칙: 명함 원본은 영구 보관, 인물-회사 분리, 이력 추적
--
-- ★ 앱 연락처의 권위는 여전히 /volume1/web/linkpilot_data.store.php (sync.php) 다.
--   이 DB 의 contacts 는 「명함 아카이브·검색·이력」 축이고, 앱 화면에 보이는 연락처는
--   confirm 응답의 appContact 를 프론트가 기존 저장 동선(로컬→sync)으로 넣는다.
--   같은 이름의 두 저장소가 서로 권위를 다투지 않도록 축을 여기 문장으로 못박는다.
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;          -- NAS 동시 접근 안정성

-- ── 회사 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,                -- 회사명(국문)
  name_en        TEXT,                         -- 회사명(영문)
  biz_reg_no     TEXT UNIQUE,                  -- 사업자등록번호 (000-00-00000)
  dart_corp_code TEXT,                         -- DART 고유번호 (공시 연동용)
  industry       TEXT,                         -- 업종
  address        TEXT,
  website        TEXT,
  status         TEXT DEFAULT 'active',        -- active / closed / merged (사업자상태 API 갱신)
  status_checked_at TEXT,                      -- 사업자상태 최종 확인 시각
  created_at     TEXT DEFAULT (datetime('now','localtime')),
  updated_at     TEXT DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name ON companies(name);

-- ── 인물 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,                  -- 이름(국문)
  name_en      TEXT,
  company_id   INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  title        TEXT,                           -- 직함 (예: 상무, 대표이사)
  department   TEXT,                           -- 부서
  mobile       TEXT,                           -- 010-0000-0000 정규화 저장
  phone        TEXT,                           -- 유선
  fax          TEXT,
  email        TEXT,
  address      TEXT,                           -- 개인 명함 주소 (회사 주소와 다를 수 있음)
  website      TEXT,
  memo         TEXT,
  source       TEXT DEFAULT 'manual',          -- card / manual / import(json 이관)
  legacy_id    TEXT,                           -- 원본 store.php contacts[].id (이관 추적용)
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now','localtime')),
  updated_at   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_mobile  ON contacts(mobile);
CREATE INDEX IF NOT EXISTS idx_contacts_email   ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_name    ON contacts(name);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_legacy  ON contacts(legacy_id);

-- ── 명함 원본 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cards (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id    INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  image_front   TEXT NOT NULL,                 -- NAS 저장 경로 (예: /volume1/docker/linkpilot/cards-images/2026/08/xxx.jpg)
  image_back    TEXT,
  parsed_json   TEXT,                          -- Claude 파싱 결과 원본(JSON 문자열)
  raw_text      TEXT,                          -- 명함 전체 텍스트 (FTS 검색용)
  confidence    REAL,                          -- 0.0~1.0 전체 신뢰도
  received_date TEXT,                          -- 명함 받은 날짜
  event_context TEXT,                          -- 어디서 받았는지 (예: "새만금 태양광 미팅")
  reviewed      INTEGER DEFAULT 0,             -- 검토 화면에서 확인 완료 여부
  created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_cards_contact ON cards(contact_id);

-- ── 태그 (딜/섹터/관계 분류) ────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL UNIQUE,               -- 예: 새만금태양광, 록키IDC, 브릿지대출, 금융기관
  category TEXT DEFAULT 'deal'                 -- deal / sector / relationship / region
);

CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);

-- ── 이력 (승진·이직·연락처 변경 추적) ───────────────────────
CREATE TABLE IF NOT EXISTS contact_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,                    -- title / company_id / mobile / email ...
  old_value  TEXT,
  new_value  TEXT,
  source     TEXT,                             -- card(새 명함) / dart / manual
  changed_at TEXT DEFAULT (datetime('now','localtime'))
);

-- ── 전문 검색 (FTS5) ────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
  name, name_en, company, title, department, memo, raw_text,
  content=''                                    -- external-content 없이 수동 동기화
);

-- ── 중복 후보 뷰 (병합 제안용) ──────────────────────────────
-- 동일 휴대폰 or (동일 이름 + 동일 회사) 조합
CREATE VIEW IF NOT EXISTS v_duplicate_candidates AS
SELECT a.id AS id_a, b.id AS id_b, a.name, a.mobile,
       'same_mobile' AS reason
FROM contacts a JOIN contacts b
  ON a.mobile = b.mobile AND a.id < b.id
WHERE a.mobile IS NOT NULL AND a.mobile != ''
UNION ALL
SELECT a.id, b.id, a.name, a.mobile, 'same_name_company'
FROM contacts a JOIN contacts b
  ON a.name = b.name AND a.company_id = b.company_id AND a.id < b.id
WHERE a.company_id IS NOT NULL;
