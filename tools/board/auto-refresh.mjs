// Poll the existing MD-backed API; no second store or status protocol.
export function autoRefresh({ refresh, paused, schedule = setTimeout, cancel = clearTimeout, onError = console.warn, interval = 2000 }) {
  let stopped = false;
  let timer;
  async function tick() {
    try {
      if (!paused()) await refresh();
    } catch (error) {
      onError('看板自动刷新失败，将自动重试', error);
    } finally {
      if (!stopped) timer = schedule(tick, interval);
    }
  }
  timer = schedule(tick, interval);
  return () => { stopped = true; cancel(timer); };
}
