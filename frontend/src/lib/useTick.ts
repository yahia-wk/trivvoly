import { useEffect, useState } from 'react';

/** Re-render every `ms` milliseconds (for countdowns). */
export function useTick(ms: number, active = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setN(x => x + 1), ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
  return n;
}
