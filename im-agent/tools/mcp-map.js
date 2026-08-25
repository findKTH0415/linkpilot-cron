'use strict';
/**
 * mcp-map.js — **붙어 있는 MCP 가 어느 길에 서 있는지 한 화면으로 본다.**
 *
 *   npm run mcp:map
 *
 * ★ 등록부(`mcp/servers.js`)를 읽어서 그린다. 여기서 목록을 다시 적지 않는다 —
 *   두 벌이 되는 순간 이 화면이 옛말을 한다.
 *
 * ★ 규칙 위반이 있으면 **0 이 아닌 값으로 끝난다.** 조용히 초록으로 끝내면
 *   등록부가 깨진 채로 다음 사람에게 넘어간다.
 */

const S = require('../mcp/servers.js');
const registry = require('../core/registry');

const LANE_LABEL = {
  'out': '내보내는 길 — LinkPilot 을 꺼내 준다',
  'in.files': '자료를 들여오는 길 — 값은 02_extraction 이 만든다',
  'in.values': '값을 바로 주는 길 — 값의 길에 못 꽂는다 (D-83)',
  'side': '값의 길에 닿지 않는다',
};

const GRADE_LABEL = {
  value: '값', crosscheck: '대조용', none: '값 아님', blocked: '막힘',
};

const STATUS_LABEL = {
  connected: '붙어 있음', auth_required: '인증 필요', candidate: '검토 중',
};

function main() {
  const bad = S.check();
  const lanes = S.byLane();

  console.log('');
  console.log(`MCP 등록부 — 서버 ${S.SERVERS.length}개`);
  console.log(`이 갈래 Agent ${registry.list().length} · 배포 엔진 Agent ${S.ENGINE.agents} · 커넥터 ${S.ENGINE.connectors}`);
  console.log('');

  Object.keys(lanes).forEach((lane) => {
    const rows = lanes[lane];
    if (!rows.length) return;
    console.log(`【${LANE_LABEL[lane]}】 ${rows.length}개`);
    rows.forEach((s) => {
      const pend = (s.agentsPending || []).length ? ` (병합 대기: ${s.agentsPending.join(', ')})` : '';
      const who = (s.agents || []).length ? s.agents.join(', ') + pend : (pend.trim() || '—');
      const block = s.blockedBy ? `  ← ${s.blockedBy}` : '';
      console.log(`  ${s.id.padEnd(22)} ${GRADE_LABEL[s.grade].padEnd(6)} ${STATUS_LABEL[s.status].padEnd(8)} ${who}${block}`);
    });
    console.log('');
  });

  const need = S.needsHuman();
  if (need.length) {
    console.log(`사람이 손봐야 하는 것 — ${need.length}개`);
    need.forEach(s => console.log(`  ${s.id} · ${STATUS_LABEL[s.status]}${s.blockedBy ? ' · ' + s.blockedBy : ''}`));
    console.log('');
  }

  if (bad.length) {
    console.error(`규칙 위반 ${bad.length}건`);
    bad.forEach(b => console.error('  ' + b));
    process.exit(1);
  }
  console.log('규칙 위반 없음');
}

if (require.main === module) main();
module.exports = { main, LANE_LABEL, GRADE_LABEL, STATUS_LABEL };
