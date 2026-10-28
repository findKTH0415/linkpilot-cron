'use strict';
/**
 * artifacts.js — Artifact Registry.
 *
 * ★ 왜 필요한가 — Agent 끼리 결과물을 **직접 주고받지 않게** 하려고.
 *
 *     나쁜 구조   Massing Agent ──→ IM Writer
 *     좋은 구조   Massing Agent ──→ [Registry] ──→ IM Writer
 *
 *   직접 넘기면 「IM 에 실린 이 도면이 어느 판인가」에 답할 수 없다. 두 Agent 가
 *   같은 파일을 서로 다른 시점에 읽으면 **문서 안에서 그림과 숫자가 어긋나는데
 *   양쪽 다 「자기 것은 맞다」**고 말한다. 실제로 이 저장소가 겪은 종류의 사고다.
 *
 * ★ 그래서 세 가지를 남긴다
 *   ① 지문(sha256) — 「같은 파일인가」를 이름이 아니라 내용으로 가린다 (M-25 와 같은 이유)
 *   ② 판(version)  — 같은 이름의 몇 번째 판인지
 *   ③ 부모(parent) — 무엇을 근거로 만들었는지
 *
 * ★ 시계는 kstStamp() 한 곳에서만 만든다 (CLAUDE.md §8 · M-10).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { kstStamp } = require('./kst');

const REGISTRY_PATH = '01_Project/artifacts.json';

function read(projectId) {
  return store.readJson(projectId, REGISTRY_PATH, null) || { projectId, artifacts: [], updatedAt: null };
}

function write(projectId, doc) {
  doc.updatedAt = kstStamp();
  store.writeJson(projectId, REGISTRY_PATH, doc);
  return doc;
}

/** 파일 내용의 지문. 없는 파일이면 null — 지어내지 않는다 */
function fingerprint(fullPath) {
  if (!fs.existsSync(fullPath)) return null;
  const st = fs.statSync(fullPath);
  if (!st.isFile()) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex').slice(0, 16);
}

/**
 * 산출물을 등록한다.
 *
 * @param {string} projectId
 * @param {object} spec
 *   relPath        프로젝트 폴더 기준 상대경로 ('09_IM/im.md') — **논리적 이름이기도 하다**
 *   taskId         만든 Task
 *   agentId        만든 Agent (사람이 올린 것이면 null)
 *   kind           'document' | 'model' | 'dataset' | 'image' | 'report' | 'source'
 *   parents        근거가 된 artifactId 배열
 *   validationScore 검증 점수 (없으면 null — 0 으로 채우지 않는다)
 *   note
 *
 * @returns {{artifactId, version, sha, changed}}  changed=false 면 내용이 그대로다
 */
function register(projectId, spec = {}) {
  if (!spec.relPath) throw new Error('artifact 등록에 relPath 가 없다');
  const doc = read(projectId);
  const full = path.join(store.projectDir(projectId), spec.relPath);
  const sha = fingerprint(full);
  const size = sha ? fs.statSync(full).size : null;

  const sameName = doc.artifacts.filter(a => a.relPath === spec.relPath);
  const latest = sameName.length ? sameName[sameName.length - 1] : null;

  // ★ 내용이 같으면 판을 올리지 않는다. 올리면 「바뀌었다」가 거짓이 되고,
  //   무엇이 실제로 달라졌는지 추적이 무의미해진다.
  if (latest && sha && latest.sha === sha) {
    latest.lastSeenAt = kstStamp();
    if (spec.taskId && !latest.taskIds.includes(spec.taskId)) latest.taskIds.push(spec.taskId);
    write(projectId, doc);
    return { artifactId: latest.artifactId, version: latest.version, sha, changed: false };
  }

  const version = latest ? latest.version + 1 : 1;
  const artifactId = `${projectId}:${spec.relPath}@v${version}`;

  doc.artifacts.push({
    artifactId,
    projectId,
    relPath: spec.relPath,
    version,
    sha,
    size,
    // ★ 파일이 실제로 없으면 그렇게 적는다. 「등록됐다」와 「파일이 있다」는 다르다
    present: Boolean(sha),
    kind: spec.kind || 'document',
    taskId: spec.taskId || null,
    taskIds: spec.taskId ? [spec.taskId] : [],
    agentId: spec.agentId || null,
    createdBy: spec.agentId || spec.createdBy || 'unknown',
    parents: Array.isArray(spec.parents) ? spec.parents.slice() : [],
    validationScore: Number.isFinite(spec.validationScore) ? spec.validationScore : null,
    note: spec.note || null,
    createdAt: kstStamp(),
    lastSeenAt: kstStamp(),
  });

  write(projectId, doc);
  return { artifactId, version, sha, changed: true };
}

/** 이름으로 최신판을 찾는다 — 후행 Task 가 입력을 집을 때 쓴다 */
function latest(projectId, relPath) {
  const doc = read(projectId);
  const same = doc.artifacts.filter(a => a.relPath === relPath);
  return same.length ? same[same.length - 1] : null;
}

function get(projectId, artifactId) {
  return read(projectId).artifacts.find(a => a.artifactId === artifactId) || null;
}

function list(projectId, { kind = null, taskId = null } = {}) {
  let out = read(projectId).artifacts;
  if (kind) out = out.filter(a => a.kind === kind);
  if (taskId) out = out.filter(a => a.taskId === taskId || (a.taskIds || []).includes(taskId));
  return out;
}

/**
 * 한 산출물이 무엇을 근거로 만들어졌는지 거슬러 올라간다.
 * ★ 기록이 없으면 '추적 불가' 로 둔다 — 그럴듯한 경로를 지어내지 않는다 (lineage.js 와 같은 규칙).
 */
function ancestry(projectId, artifactId, seen = new Set()) {
  const a = get(projectId, artifactId);
  if (!a) return { artifactId, found: false, reason: '등록부에 없다', parents: [] };
  if (seen.has(artifactId)) return { artifactId, found: true, cyclic: true, parents: [] };
  seen.add(artifactId);
  return {
    artifactId, found: true,
    relPath: a.relPath, version: a.version, sha: a.sha,
    createdBy: a.createdBy, taskId: a.taskId, createdAt: a.createdAt,
    parents: a.parents.map(p => ancestry(projectId, p, seen)),
  };
}

/**
 * 등록된 뒤 파일이 바뀌었는가 — **등록부와 디스크가 갈린 것**을 잡는다.
 * (M-25 「저장소 ≠ 디스크 ≠ HTTP」와 같은 종류의 갈림이다. 갈린 줄 모르는 것이 사고다)
 */
function drift(projectId) {
  const doc = read(projectId);
  const out = [];
  for (const a of doc.artifacts) {
    const now = fingerprint(path.join(store.projectDir(projectId), a.relPath));
    // 옛 판은 덮여 있는 것이 정상이다 — 같은 이름의 최신판만 본다
    const isLatest = latest(projectId, a.relPath);
    if (!isLatest || isLatest.artifactId !== a.artifactId) continue;
    if (now !== a.sha) out.push({ artifactId: a.artifactId, relPath: a.relPath, registered: a.sha, onDisk: now });
  }
  return out;
}

function summary(projectId) {
  const doc = read(projectId);
  const byName = new Map();
  for (const a of doc.artifacts) byName.set(a.relPath, a);
  const heads = Array.from(byName.values());
  return {
    total: doc.artifacts.length,
    distinct: heads.length,
    missing: heads.filter(a => !a.present).length,
    revised: heads.filter(a => a.version > 1).length,
    drift: drift(projectId).length,
    updatedAt: doc.updatedAt,
  };
}

module.exports = {
  REGISTRY_PATH, register, latest, get, list, ancestry, drift, summary, read, fingerprint,
};
