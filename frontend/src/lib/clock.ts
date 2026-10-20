// Timers are end times on the server's clock. Each view carries the server's time, so every
// screen can count down in sync even if its own clock is off.
import type { TimerView } from './types';

let offset = 0; // server clock minus this device's clock, in ms

export function syncClock(serverTime: number): void {
  if (Number.isFinite(serverTime)) offset = serverTime - Date.now();
}

export const serverNow = (): number => Date.now() + offset;

/** Seconds left on a timer right now. */
export function timeLeft(t: TimerView | null | undefined): number {
  if (!t) return 0;
  if (t.running && t.endsAt != null) return Math.max(0, (t.endsAt - serverNow()) / 1000);
  return t.remaining;
}

export const fmtTime = (sec: number): string => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const fmtPts = (n: number | null | undefined): string => (n == null ? '' : String(Math.round(n * 10) / 10));

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
