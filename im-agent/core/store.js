'use strict';
/**
 * store.js — Project Data Room (파일시스템 기반).
 *
 * 프로젝트 1건 = 폴더 1개. 13개 표준 폴더를 자동 생성한다.
 * (NAS/DB 연동은 이 인터페이스만 바꾸면 되도록 입출력을 한 곳에 모았다)
 */

const fs = require('fs');
const path = require('path');
const { kstStamp, kstYear } = require('./kst');

const FOLDERS = [
  '01_Project', '02_Source_Data', '03_Legal', '04_Property', '05_Market',
  '06_Technical', '07_Financial', '08_DD', '09_IM', '10_Teaser',
  '11_QC', '12_Final', '13_Distribution',
];

const ASSET_CODE = {
  datacenter: 'DC', solar: 'SOL', realestate: 'RE', generic: 'GEN',
};

function root() {
  return process.env.IM_AGENT_ROOT || path.join(process.cwd(), 'im-projects');
}

/** LP-DC-2026-001 (연도는 KST 기준) */
function nextProjectId(templateId, when = new Date()) {
  const code = ASSET_CODE[templateId] || 'GEN';
  const year = kstYear(when);
  const prefix = `LP-${code}-${year}-`;
  let max = 0;
  if (fs.existsSync(root())) {
    for (const name of fs.readdirSync(root())) {
      if (name.startsWith(prefix)) {
        const seq = Number(name.slice(prefix.length).split('_')[0]);
        if (Number.isFinite(seq)) max = Math.max(max, seq);
      }
    }
  }
  return prefix + String(max + 1).padStart(3, '0');
}

function projectDir(projectId) {
  return path.join(root(), projectId);
}

function createProjectDirs(projectId) {
  const dir = projectDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FOLDERS) fs.mkdirSync(path.join(dir, f), { recursive: true });
  return dir;
}

function exists(projectId) {
  return fs.existsSync(projectDir(projectId));
}

function writeJson(projectId, relPath, data) {
  const full = path.join(projectDir(projectId), relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2), 'utf8');
  return full;
}

function readJson(projectId, relPath, fallback = null) {
  const full = path.join(projectDir(projectId), relPath);
  if (!fs.existsSync(full)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeText(projectId, relPath, text) {
  const full = path.join(projectDir(projectId), relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text, 'utf8');
  return full;
}

/**
 * 02_Source_Data 안의 원본 파일 목록.
 *
 * ★★ **숨김 이름(`.`)은 건너뛴다.** 이 폴더에는 보관 계층(core/vault.js)이
 *   `.trash/`(휴지통) · `.vault.json`(장부) · `.tmp/`(쓰는 중)를 둔다.
 *   여기를 재귀로 훑으면서 걸러내지 않으면 **버린 자료가 다시 추출되어
 *   보고서에 실린다.** 지운 사람은 지운 줄 알고 있으므로 아무도 눈치채지 못한다.
 *   (`.DS_Store`·`._foo` 같은 macOS 부산물도 지금까지 추출 대상이었다)
 *
 * ★ 건너뛴 것을 **셀 수 있게** `listExcludedSourceFiles()` 를 따로 둔다 —
 *   조용히 빠지면 「올렸는데 안 읽혔다」의 원인이 어디에도 안 남는다.
 */
function listSourceFiles(projectId) {
  const dir = path.join(projectDir(projectId), '02_Source_Data');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = d => {
    for (const name of fs.readdirSync(d)) {
      if (name.startsWith('.')) continue;   // 휴지통·장부·임시 — 위 주석 참조
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else out.push({ name, path: full, size: st.size, ext: path.extname(name).toLowerCase() });
    }
  };
  walk(dir);
  return out;
}

/**
 * 추출에서 빠진 것 — 왜 빠졌는지와 함께.
 *
 * 휴지통은 「버린 것이라 안 읽는다」가 정상이고, 그 밖의 숨김 파일은
 * 「모르고 안 읽히고 있다」일 수 있다. **둘을 구분해서 낸다.**
 */
function listExcludedSourceFiles(projectId) {
  const dir = path.join(projectDir(projectId), '02_Source_Data');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith('.')) continue;
    const full = path.join(dir, name);
    let st; try { st = fs.statSync(full); } catch (_) { continue; }
    const why = name === '.trash' ? '휴지통 — 버린 자료라 읽지 않습니다'
      : name === '.vault.json' ? '보관 장부'
        : name === '.vault-log.jsonl' ? '보관 기록'
          : name === '.tmp' ? '저장하다 만 조각'
            : '숨김 파일 — 원본자료로 보지 않습니다';
    if (st.isDirectory()) {
      let files = 0, bytes = 0;
      for (const n of fs.readdirSync(full)) {
        try { const s2 = fs.statSync(path.join(full, n)); if (s2.isFile()) { files += 1; bytes += s2.size; } } catch (_) { /* 사라졌으면 넘어간다 */ }
      }
      out.push({ name, kind: 'dir', files, size: bytes, why });
    } else {
      out.push({ name, kind: 'file', files: 1, size: st.size, why });
    }
  }
  return out;
}

/** 실행 로그 append (JSONL) */
function appendRunLog(projectId, entry) {
  const full = path.join(projectDir(projectId), '01_Project', 'run-log.jsonl');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.appendFileSync(full, JSON.stringify({ at: kstStamp(), ...entry }) + '\n', 'utf8');
}

function readRunLog(projectId) {
  const full = path.join(projectDir(projectId), '01_Project', 'run-log.jsonl');
  if (!fs.existsSync(full)) return [];
  return fs.readFileSync(full, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch (_) { return null; }
  }).filter(Boolean);
}

function listProjects() {
  if (!fs.existsSync(root())) return [];
  return fs.readdirSync(root())
    .filter(n => /^LP-[A-Z]+-\d{4}-\d{3}/.test(n))
    .map(id => ({ id, project: readJson(id, '01_Project/project.json', {}) }));
}

module.exports = {
  FOLDERS, ASSET_CODE, root, nextProjectId, projectDir, createProjectDirs, exists,
  writeJson, readJson, writeText, listSourceFiles, listExcludedSourceFiles,
  appendRunLog, readRunLog, listProjects,
};
