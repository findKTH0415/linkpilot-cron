/**
 * lib.js — Control Tower 표시 로직 (순수 함수).
 *
 * ★ React 컴포넌트에서 로직을 분리한 이유: 여기가 테스트 대상이다.
 *   "제작 100%인데 전체 80%" 같은 판정이 화면에서 뒤집히면 사용자가 오해하고,
 *   오해한 채로 검증 안 된 투자문서를 배포한다.
 *
 * 의존성 없음. 브라우저·Node 양쪽에서 동작한다 (ESM).
 */

/** 트랙 표시 순서 — 제작이 먼저, 승인이 마지막 */
export const TRACK_ORDER = ['production', 'validation', 'output', 'approval'];

export const AGENT_STATUS_ICON = {
  COMPLETED: '●', WARNING: '▲', RUNNING: '▶', ERROR: '✕',
  WAITING: '○', SKIPPED: '·', BLOCKED: '■', QUEUED: '◇', APPROVED: '✓',
};

/** 상태 → CSS 변수 이름 (테마에서 색을 가져온다. 컴포넌트가 색을 하드코딩하지 않는다) */
export const AGENT_STATUS_TONE = {
  COMPLETED: 'ok', APPROVED: 'ok',
  RUNNING: 'active', QUEUED: 'active',
  WARNING: 'warn',
  ERROR: 'bad', BLOCKED: 'bad',
  WAITING: 'idle', SKIPPED: 'idle',
};

export const HEALTH_TONE = {
  HEALTHY: 'ok', ATTENTION: 'warn', 'AT RISK': 'warn', BLOCKED: 'bad',
};

/** 'm s' 형식 (18m 42s) */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-';
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

/** '+09:00' 타임스탬프 → 'HH:MM:SS' */
export function clockOf(stamp) {
  if (!stamp) return '';
  const m = String(stamp).match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : '';
}

/**
 * 트랙 배열 — 화면에 그릴 순서대로.
 * @param {object} snapshot control-tower.json
 */
export function trackList(snapshot) {
  if (!snapshot || !snapshot.tracks) return [];
  return TRACK_ORDER
    .filter(k => snapshot.tracks[k])
    .map(k => ({ key: k, ...snapshot.tracks[k] }));
}

/**
 * ★ 이 시스템에서 가장 중요한 판정.
 *
 * Agent 진행률(production)이 전체 진행률보다 크게 앞서면, 사용자가 production 을 보고
 * "거의 다 됐다"고 오해할 수 있다. 그 격차를 화면에 명시적으로 띄운다.
 *
 * @returns {{show:boolean, gap:number, message:string}|null}
 */
export function progressGapNotice(snapshot) {
  if (!snapshot || !snapshot.tracks) return null;
  const production = snapshot.tracks.production?.pct ?? 0;
  const overall = snapshot.overall ?? 0;
  const gap = production - overall;
  if (gap < 10) return null;

  const lagging = trackList(snapshot)
    .filter(t => t.key !== 'production' && t.pct < production)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 2);

  return {
    show: true,
    gap,
    message: `Agent 작업은 ${production}% 진행됐지만 프로젝트 전체는 ${overall}%다. `
      + `${lagging.map(t => `${t.label} ${t.pct}%`).join(', ')} 가 남아 있어 아직 배포할 수 없다.`,
  };
}

/** Agent 목록 — 상태별 요약 포함 */
export function agentSummary(snapshot) {
  const agents = (snapshot && snapshot.agents) || [];
  const count = s => agents.filter(a => a.status === s).length;
  return {
    agents,
    total: agents.length,
    completed: count('COMPLETED') + count('APPROVED'),
    running: count('RUNNING'),
    warning: count('WARNING'),
    error: count('ERROR') + count('BLOCKED'),
    waiting: count('WAITING') + count('QUEUED'),
    skipped: count('SKIPPED'),
  };
}

/** 위험 요약 — 검증 트랙에서만 가져온다 (Agent 진행률과 섞지 않는다) */
export function riskSummary(snapshot) {
  const v = snapshot?.tracks?.validation;
  if (!v) return { available: false };
  return {
    available: v.score !== null && v.score !== undefined,
    score: v.score,
    status: v.status,
    critical: v.critical ?? 0,
    major: v.major ?? 0,
    minor: v.minor ?? 0,
    gatesPassed: v.gatesPassed ?? 0,
    gatesTotal: v.gatesTotal ?? 8,
    detail: v.detail,
    blocked: v.status === 'DISTRIBUTION BLOCKED',
  };
}

/** 산출물 — 존재 여부로 실제 상태를 판정한다 ('생성됨' 표시만 하지 않는다) */
export function outputSummary(snapshot) {
  const o = snapshot?.tracks?.output;
  if (!o) return { files: [], ready: 0, total: 0, specLocked: false };
  const files = o.files || [];
  return {
    files,
    ready: files.filter(f => f.exists).length,
    total: files.length,
    specLocked: !!o.specLocked,
    detail: o.detail,
    manifestStatus: o.manifestStatus || null,
  };
}

/** 사용자 조치 필요 항목 */
export function userActions(snapshot) {
  const reasons = snapshot?.tracks?.approval?.reasons || [];
  return reasons.map((r, i) => ({ id: `A${i + 1}`, message: r }));
}

/** 활동 로그 필터 카테고리 */
export const ACTIVITY_FILTERS = [
  { id: 'ALL', label: '전체', match: () => true },
  { id: 'ERROR', label: '오류·경고', match: l => l.level === 'WARN' || l.level === 'ERROR' },
  { id: 'DATA', label: '데이터', match: l => /extraction|geo|project/.test(l.agent) },
  { id: 'FINANCIAL', label: '재무', match: l => /financial|appraisal/.test(l.agent) },
  { id: 'DOCUMENT', label: '문서', match: l => /writer|output_spec/.test(l.agent) },
  { id: 'QA', label: '검증', match: l => /validation/.test(l.agent) },
];

export function filterActivity(activity, filterId) {
  const f = ACTIVITY_FILTERS.find(x => x.id === filterId) || ACTIVITY_FILTERS[0];
  return (activity || []).filter(f.match);
}

/** 진행바 폭 (0~100 클램프) */
export function barWidth(pct) {
  return `${Math.max(0, Math.min(100, Number(pct) || 0))}%`;
}
