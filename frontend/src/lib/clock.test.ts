import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtPts, fmtTime, ordinal, syncClock, timeLeft } from './clock';
import type { TimerView } from './types';

const timer = (t: Partial<TimerView>): TimerView => ({ mode: 'q', total: 45, remaining: 45, endsAt: null, running: false, done: false, ...t });

describe('the countdown', () => {
  afterEach(() => vi.useRealTimers());

  it('counts down from the server’s end time, even if this device’s clock is wrong', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);           // this device thinks it's 1,000,000 ms
    syncClock(5_000_000);                  // the server says it's 5,000,000 ms
    const t = timer({ running: true, endsAt: 5_030_000 });
    expect(timeLeft(t)).toBeCloseTo(30);
    vi.setSystemTime(1_010_000);           // ten seconds later
    expect(timeLeft(t)).toBeCloseTo(20);
    vi.setSystemTime(1_100_000);
    expect(timeLeft(t)).toBe(0);           // never negative
  });

  it('shows the remaining time when paused', () => {
    expect(timeLeft(timer({ remaining: 12.4 }))).toBe(12.4);
    expect(timeLeft(null)).toBe(0);
  });

  it('formats times, points and places', () => {
    expect(fmtTime(45)).toBe('0:45');
    expect(fmtTime(0.2)).toBe('0:01');
    expect(fmtTime(600)).toBe('10:00');
    expect(fmtPts(2.5)).toBe('2.5');
    expect(fmtPts(null)).toBe('');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  });
});
