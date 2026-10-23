import { useEffect, useState } from "react";

const TICK_MS = 1000;

export function useStartedAt(): number {
  const [startedAt] = useState(() => Date.now());
  return startedAt;
}

export function useElapsedSeconds(since: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - since) / 1000));
}
