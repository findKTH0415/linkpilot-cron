import React, { useState } from 'react';
import {
  trackList, progressGapNotice, formatDuration, HEALTH_TONE, barWidth,
} from './lib.js';
import { AgentActivity, ValidationRisk, OutputStatus, LiveActivity, UserActions } from './Panels.jsx';
import { LineagePanel } from './Lineage.jsx';
import { useControlTower, useLineage } from './useControlTower.js';
import './controlTower.css';

/**
 * ControlTower — LinkPilot 프로젝트 제작 현황 화면.
 *
 * ★ 화면 설계 원칙: Agent 진행률을 프로젝트 진행률처럼 보이게 하지 않는다.
 *   전체 진행률을 가장 크게 두되, 바로 아래에 4개 트랙을 분해해서 보여주고,
 *   Agent 진행률이 전체보다 크게 앞서면 그 사실을 경고로 띄운다.
 *
 * 사용:
 *   <ControlTower projectId="LP-DC-2026-001" />
 *   <ControlTower snapshot={json} />          // 폴링 없이 주입
 */
export default function ControlTower({ projectId, snapshot: injected, baseUrl, onApprove }) {
  const live = useControlTower(projectId, { baseUrl, enabled: !injected });
  const snapshot = injected || live.snapshot;
  const lineage = useLineage(projectId, { baseUrl });

  if (!snapshot) {
    return (
      <div className="lp-ct lp-ct--empty">
        {live.error
          ? <p className="lp-ct__error">현황을 불러오지 못했습니다: {live.error}</p>
          : <p className="lp-ct__muted">현황을 불러오는 중…</p>}
      </div>
    );
  }

  const tracks = trackList(snapshot);
  const gap = progressGapNotice(snapshot);
  const healthTone = HEALTH_TONE[snapshot.health?.level] || 'idle';
  const running = !snapshot.timing?.finishedAt;

  return (
    <div className="lp-ct">
      <Header snapshot={snapshot} healthTone={healthTone} running={running}
        stale={live.error} lastUpdated={live.lastUpdated} onRefresh={live.refresh} />

      <section className="lp-ct__panel" aria-labelledby="lp-overall">
        <h2 id="lp-overall" className="lp-ct__panel-title">
          <span className="lp-ct__panel-no">01</span> Overall Progress
        </h2>

        <div className="lp-ct__overall">
          <div className="lp-ct__overall-value">{snapshot.overall}<span>%</span></div>
          <div className="lp-ct__overall-bar" role="progressbar"
            aria-valuenow={snapshot.overall} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: barWidth(snapshot.overall) }} />
          </div>
        </div>

        {gap && (
          <p className="lp-ct__notice lp-ct__notice--warn">
            <strong>진행률 해석 주의</strong> {gap.message}
          </p>
        )}

        <ul className="lp-ct__tracks">
          {tracks.map(t => (
            <li key={t.key} className={`lp-ct__track lp-ct__track--${t.key}`}>
              <div className="lp-ct__track-head">
                <span className="lp-ct__track-label">{t.label}</span>
                <span className="lp-ct__track-weight">비중 {t.weight}%</span>
                <span className="lp-ct__track-pct">{t.pct}%</span>
              </div>
              <div className="lp-ct__track-bar">
                <span style={{ width: barWidth(t.pct) }} />
              </div>
              {t.detail && <p className="lp-ct__track-detail">{t.detail}</p>}
            </li>
          ))}
        </ul>

        <p className="lp-ct__footnote">
          전체 진행률은 4개 트랙의 가중합입니다. Agent 작업이 모두 끝나도 검증·승인 전이면 100%가 되지 않습니다.
        </p>
      </section>

      <div className="lp-ct__grid">
        <AgentActivity snapshot={snapshot} />
        <ValidationRisk snapshot={snapshot} />
        <OutputStatus snapshot={snapshot} />
        <LiveActivity snapshot={snapshot} />
      </div>

      <UserActions snapshot={snapshot} onApprove={onApprove} />

      <LineagePanel state={lineage} onClose={lineage.close} />

      <footer className="lp-ct__footer">
        <span>{snapshot.generatedAt}</span>
        <button type="button" className="lp-ct__link" onClick={() => lineage.open('building.gfa_sqm')}>
          데이터 계보 보기
        </button>
      </footer>
    </div>
  );
}

function Header({ snapshot, healthTone, running, stale, lastUpdated, onRefresh }) {
  const t = snapshot.timing || {};
  return (
    <header className="lp-ct__header">
      <div>
        <p className="lp-ct__eyebrow">LinkPilot Project Control Tower</p>
        <h1 className="lp-ct__title">{snapshot.project?.name || snapshot.project?.id}</h1>
        <p className="lp-ct__meta">
          {snapshot.project?.id}
          {snapshot.project?.assetType ? ` · ${snapshot.project.assetType}` : ''}
        </p>
      </div>

      <div className="lp-ct__header-right">
        <span className={`lp-ct__health lp-ct__tone--${healthTone}`}>
          {snapshot.health?.level}
          <small>{snapshot.health?.reason}</small>
        </span>
        <p className="lp-ct__timing">
          {running ? '실행 중' : '실행 완료'} · 경과 {formatDuration(t.elapsedMs)}
          {running && t.estimatedRemainingMs
            ? ` · 남은 예상 ${formatDuration(t.estimatedRemainingMs)} (참고값)`
            : ''}
        </p>
        {stale && (
          <p className="lp-ct__stale">
            갱신 실패 — 마지막 수신 {lastUpdated ? lastUpdated.toLocaleTimeString('ko-KR') : '알 수 없음'} 기준 화면입니다.
            <button type="button" className="lp-ct__link" onClick={onRefresh}>다시 시도</button>
          </p>
        )}
      </div>
    </header>
  );
}

export { ControlTower };
