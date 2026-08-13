import React, { useState } from 'react';
import {
  AGENT_STATUS_ICON, AGENT_STATUS_TONE, agentSummary, riskSummary, outputSummary,
  userActions, filterActivity, ACTIVITY_FILTERS, formatDuration, clockOf, barWidth,
} from './lib.js';

/** ② AGENT ACTIVITY — 지금 AI가 무엇을 하고 있는가 */
export function AgentActivity({ snapshot }) {
  const s = agentSummary(snapshot);
  const bottleneck = snapshot.bottleneck;
  const waiting = snapshot.waiting || [];

  return (
    <section className="lp-ct__panel" aria-labelledby="lp-agents">
      <h2 id="lp-agents" className="lp-ct__panel-title">
        <span className="lp-ct__panel-no">02</span> Agent Activity
        <span className="lp-ct__panel-sub">{s.completed}/{s.total} 완료</span>
      </h2>

      <ul className="lp-ct__agents">
        {s.agents.map(a => (
          <li key={a.id} className={`lp-ct__agent lp-ct__tone--${AGENT_STATUS_TONE[a.status] || 'idle'}`}>
            <span className="lp-ct__agent-icon" aria-hidden="true">{AGENT_STATUS_ICON[a.status] || '·'}</span>
            <span className="lp-ct__agent-name">
              {a.label}
              <small>{a.id}</small>
            </span>
            <span className="lp-ct__agent-bar">
              <span style={{ width: barWidth(a.progress) }} />
            </span>
            <span className="lp-ct__agent-status">{a.status}</span>
            <span className="lp-ct__agent-time">{a.elapsedMs ? formatDuration(a.elapsedMs) : ''}</span>
            {a.activity && <span className="lp-ct__agent-activity" title={a.activity}>{a.activity}</span>}
          </li>
        ))}
      </ul>

      {bottleneck && (
        <p className="lp-ct__notice">
          <strong>병목</strong> {bottleneck.label} — {formatDuration(bottleneck.elapsedMs)}
          {' '}(전체의 {bottleneck.sharePct}%, 후속 {bottleneck.dependents}개, 영향 {bottleneck.impactLevel})
        </p>
      )}

      {waiting.length > 0 && (
        <p className="lp-ct__notice">
          <strong>선행 대기</strong>{' '}
          {waiting.map(w => `${w.id} ← ${w.waitingFor.join(', ')}`).join(' / ')}
        </p>
      )}
    </section>
  );
}

/** ③ VALIDATION / RISK — Agent 진행률과 무관하게 별도 집계한다 */
export function ValidationRisk({ snapshot }) {
  const r = riskSummary(snapshot);

  return (
    <section className={`lp-ct__panel ${r.blocked ? 'lp-ct__panel--blocked' : ''}`} aria-labelledby="lp-risk">
      <h2 id="lp-risk" className="lp-ct__panel-title">
        <span className="lp-ct__panel-no">03</span> Validation / Risk
      </h2>

      {!r.available ? (
        <p className="lp-ct__muted">{r.detail || '검증이 아직 실행되지 않았습니다.'}</p>
      ) : (
        <>
          <div className="lp-ct__score">
            <span className="lp-ct__score-value">{r.score}</span>
            <span className="lp-ct__score-max">/ 100</span>
            <span className={`lp-ct__score-status ${r.blocked ? 'lp-ct__tone--bad' : 'lp-ct__tone--ok'}`}>
              {r.status}
            </span>
          </div>

          <ul className="lp-ct__severity">
            <li className="lp-ct__tone--bad"><b>{r.critical}</b> CRITICAL</li>
            <li className="lp-ct__tone--warn"><b>{r.major}</b> MAJOR</li>
            <li className="lp-ct__tone--idle"><b>{r.minor}</b> MINOR</li>
            <li className="lp-ct__tone--ok"><b>{r.gatesPassed}/{r.gatesTotal}</b> GATE</li>
          </ul>

          {r.blocked && (
            <p className="lp-ct__notice lp-ct__notice--bad">
              <strong>배포 차단</strong> CRITICAL 항목이 해소되기 전에는 최종 배포할 수 없습니다.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** ④ OUTPUT STATUS — 실제 파일 존재 여부로 판정한다 */
export function OutputStatus({ snapshot }) {
  const o = outputSummary(snapshot);

  return (
    <section className="lp-ct__panel" aria-labelledby="lp-output">
      <h2 id="lp-output" className="lp-ct__panel-title">
        <span className="lp-ct__panel-no">04</span> Output Status
        <span className="lp-ct__panel-sub">{o.ready}/{o.total} 생성</span>
      </h2>

      <ul className="lp-ct__files">
        {o.files.map(f => (
          <li key={f.path} className={f.exists ? 'lp-ct__tone--ok' : 'lp-ct__tone--idle'}>
            <span aria-hidden="true">{f.exists ? '✓' : '○'}</span>
            <span className="lp-ct__file-label">{f.label}</span>
            <code>{f.path}</code>
          </li>
        ))}
      </ul>

      <p className={`lp-ct__notice ${o.specLocked ? '' : 'lp-ct__notice--warn'}`}>
        <strong>출력 사양</strong> {o.detail}
        {o.manifestStatus ? ` · 매니페스트: ${o.manifestStatus}` : ''}
      </p>
    </section>
  );
}

/** LIVE ACTIVITY — 시간순 로그 + 필터 */
export function LiveActivity({ snapshot }) {
  const [filter, setFilter] = useState('ALL');
  const rows = filterActivity(snapshot.activity, filter);

  return (
    <section className="lp-ct__panel" aria-labelledby="lp-activity">
      <h2 id="lp-activity" className="lp-ct__panel-title">
        <span className="lp-ct__panel-no">05</span> Live Activity
      </h2>

      <div className="lp-ct__filters" role="tablist">
        {ACTIVITY_FILTERS.map(f => (
          <button key={f.id} type="button" role="tab"
            aria-selected={filter === f.id}
            className={`lp-ct__filter ${filter === f.id ? 'is-active' : ''}`}
            onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="lp-ct__muted">기록된 활동이 없습니다.</p>
      ) : (
        <ol className="lp-ct__log">
          {rows.slice().reverse().map((l, i) => (
            <li key={`${l.at}-${i}`} className={l.level === 'WARN' ? 'lp-ct__tone--warn' : ''}>
              <time>{clockOf(l.at)}</time>
              <span className="lp-ct__log-agent">{l.agent}</span>
              <span className="lp-ct__log-msg">{l.message}</span>
              {l.records ? <span className="lp-ct__log-records">{l.records}건</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** 사용자 조치 필요 — 승인 버튼은 조건이 전부 해소됐을 때만 활성화한다 */
export function UserActions({ snapshot, onApprove }) {
  const actions = userActions(snapshot);
  const approval = snapshot.tracks?.approval;
  const canApprove = approval && actions.length === 0 && !approval.approved;

  if (approval?.approved) {
    return (
      <section className="lp-ct__panel lp-ct__panel--ok">
        <h2 className="lp-ct__panel-title">Approval</h2>
        <p className="lp-ct__tone--ok">{approval.detail}</p>
      </section>
    );
  }

  return (
    <section className="lp-ct__panel" aria-labelledby="lp-actions">
      <h2 id="lp-actions" className="lp-ct__panel-title">User Action Required</h2>

      {actions.length === 0 ? (
        <p className="lp-ct__muted">해소해야 할 항목이 없습니다.</p>
      ) : (
        <ul className="lp-ct__actions">
          {actions.map(a => <li key={a.id}><span>{a.id}</span>{a.message}</li>)}
        </ul>
      )}

      <button type="button" className="lp-ct__approve"
        disabled={!canApprove}
        title={canApprove ? '' : '차단 사유가 남아 있어 승인할 수 없습니다'}
        onClick={() => onApprove && onApprove(snapshot.project?.id)}>
        최종 승인
      </button>
      {!canApprove && (
        <p className="lp-ct__footnote">
          위 항목이 모두 해소되어야 승인할 수 있습니다. 승인은 사람만 할 수 있으며 기록이 남습니다.
        </p>
      )}
    </section>
  );
}
