import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useControlTower — control-tower.json 폴링 훅.
 *
 * ★ 폴링 규칙:
 *   - 실행 중(finishedAt 없음)이면 2초, 끝났으면 15초. 끝난 프로젝트를 계속 두드리지 않는다.
 *   - 탭이 백그라운드면 멈춘다. 안 보이는 화면 때문에 API를 때리지 않는다.
 *   - 실패해도 마지막 스냅샷을 지우지 않는다. 화면이 빈 채로 남으면 사용자가
 *     "작업이 사라졌다"고 오해한다.
 *
 * @param {string} projectId
 * @param {object} opts { baseUrl, enabled, activeIntervalMs, idleIntervalMs, fetchImpl }
 */
export function useControlTower(projectId, opts = {}) {
  const {
    baseUrl = '/api/linkpilot',
    enabled = true,
    activeIntervalMs = 2000,
    idleIntervalMs = 15000,
    fetchImpl = typeof fetch === 'function' ? fetch : null,
  } = opts;

  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const timer = useRef(null);
  const aborter = useRef(null);

  const load = useCallback(async () => {
    if (!projectId || !fetchImpl) return null;
    if (aborter.current) aborter.current.abort();
    const controller = new AbortController();
    aborter.current = controller;

    setLoading(true);
    try {
      const res = await fetchImpl(`${baseUrl}/projects/${encodeURIComponent(projectId)}/control-tower`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setSnapshot(json);
      setError(null);
      setLastUpdated(new Date());
      return json;
    } catch (e) {
      if (e.name !== 'AbortError') {
        // 마지막 스냅샷은 유지한다 — 화면을 비우면 '작업이 사라진' 것처럼 보인다
        setError(e.message);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId, baseUrl, fetchImpl]);

  useEffect(() => {
    if (!enabled || !projectId) return undefined;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) {
        timer.current = setTimeout(tick, idleIntervalMs);
        return;
      }
      const data = await load();
      if (cancelled) return;
      const running = data ? !data.timing?.finishedAt : true;
      timer.current = setTimeout(tick, running ? activeIntervalMs : idleIntervalMs);
    };
    tick();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      if (aborter.current) aborter.current.abort();
    };
  }, [enabled, projectId, load, activeIntervalMs, idleIntervalMs]);

  return { snapshot, error, loading, lastUpdated, refresh: load };
}

/** 데이터 계보 / 변경 영향 — 숫자를 클릭했을 때만 부른다 (상시 폴링 대상이 아니다) */
export function useLineage(projectId, opts = {}) {
  const { baseUrl = '/api/linkpilot', fetchImpl = typeof fetch === 'function' ? fetch : null } = opts;
  const [state, setState] = useState({ key: null, lineage: null, impact: null, loading: false, error: null });

  const open = useCallback(async (key) => {
    if (!projectId || !key || !fetchImpl) return;
    setState(s => ({ ...s, key, loading: true, error: null }));
    try {
      const url = `${baseUrl}/projects/${encodeURIComponent(projectId)}`;
      const [lRes, iRes] = await Promise.all([
        fetchImpl(`${url}/lineage/${encodeURIComponent(key)}`),
        fetchImpl(`${url}/impact/${encodeURIComponent(key)}`),
      ]);
      if (!lRes.ok) throw new Error(`HTTP ${lRes.status}`);
      setState({
        key,
        lineage: await lRes.json(),
        impact: iRes.ok ? await iRes.json() : null,
        loading: false, error: null,
      });
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e.message }));
    }
  }, [projectId, baseUrl, fetchImpl]);

  const close = useCallback(() => setState({ key: null, lineage: null, impact: null, loading: false, error: null }), []);

  return { ...state, open, close };
}
