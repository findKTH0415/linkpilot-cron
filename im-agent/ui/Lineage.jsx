import React from 'react';

/**
 * LineagePanel — 숫자를 클릭했을 때 뜨는 데이터 계보 / 변경 영향 패널.
 *
 * ★ 채택되지 않은 후보도 보여준다. 어느 값이 버려졌는지 알아야 판단할 수 있다.
 * ★ 추적이 안 되면 '추적 불가'라고 쓴다. 그럴듯한 경로를 지어내지 않는다.
 */
export function LineagePanel({ state, onClose }) {
  if (!state || !state.key) return null;

  return (
    <div className="lp-ct__modal" role="dialog" aria-modal="true" aria-labelledby="lp-lineage-title">
      <div className="lp-ct__modal-box">
        <header className="lp-ct__modal-head">
          <h2 id="lp-lineage-title">Data Lineage</h2>
          <button type="button" className="lp-ct__close" onClick={onClose} aria-label="닫기">×</button>
        </header>

        {state.loading && <p className="lp-ct__muted">불러오는 중…</p>}
        {state.error && <p className="lp-ct__error">불러오지 못했습니다: {state.error}</p>}

        {state.lineage && !state.lineage.found && (
          <p className="lp-ct__notice lp-ct__notice--warn">
            <strong>추적 불가</strong> {state.lineage.reason}
          </p>
        )}

        {state.lineage && state.lineage.found && (
          <>
            <p className="lp-ct__lineage-head">
              <strong>{state.lineage.label}</strong>
              <code>{state.lineage.key}</code>
              <span className="lp-ct__lineage-value">
                {String(state.lineage.value)}{state.lineage.unit ? ` ${state.lineage.unit}` : ''}
              </span>
              <span className={`lp-ct__grade lp-ct__grade--${state.lineage.grade}`}>{state.lineage.grade}</span>
              {state.lineage.verified
                ? <span className="lp-ct__tone--ok">검증됨</span>
                : <span className="lp-ct__tone--warn">미검증</span>}
            </p>

            {state.lineage.conflicted && (
              <p className="lp-ct__notice lp-ct__notice--bad">
                <strong>값 충돌</strong> 서로 다른 출처가 다른 값을 제시합니다. 아래에서 채택/미채택을 확인하십시오.
              </p>
            )}

            <ol className="lp-ct__chain">
              {state.lineage.chain.map((c, i) => (
                <li key={i} className={c.adopted ? '' : 'is-rejected'}>
                  <span className="lp-ct__chain-stage">{c.stage}</span>
                  <span className="lp-ct__chain-label">
                    {c.label}
                    {!c.adopted && <em> (미채택)</em>}
                  </span>
                  {c.detail && <span className="lp-ct__chain-detail">{c.detail}</span>}
                  {c.value !== null && c.value !== undefined && (
                    <span className="lp-ct__chain-value">{String(c.value)}</span>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}

        {state.impact && (
          <section className="lp-ct__impact">
            <h3>변경 영향</h3>
            <p>
              이 값을 바꾸면 <strong>{state.impact.totalAffected}개</strong> 결과물이 영향을 받습니다.
              {state.impact.requiresNewVersion && ' 이미 승인된 프로젝트이므로 새 버전이 필요합니다.'}
            </p>

            <p className="lp-ct__impact-order">
              재실행 순서: {state.impact.rerunOrder.join(' → ')}
            </p>

            {state.impact.affectedValues.length > 0 && (
              <p className="lp-ct__impact-values">
                다시 계산되는 값 {state.impact.affectedValues.length}건:{' '}
                {state.impact.affectedValues.map(v => v.label).join(', ')}
              </p>
            )}

            <ul className="lp-ct__impact-docs">
              {state.impact.affectedDocuments.map(d => <li key={d}><code>{d}</code></li>)}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

export default LineagePanel;
