import { useEffect, useState } from "react";

const ELAPSED_TICK_MS = 1000;

/** The current time in ms, refreshed every second while a run is active. */
export function useElapsedTick(isRunActive: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunActive) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const handle = setInterval(tick, ELAPSED_TICK_MS);
    return () => clearInterval(handle);
  }, [isRunActive]);
  return nowMs;
}
