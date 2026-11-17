import { describe, expect, it } from 'vitest';
import { elapsed, timeAgo } from './time';

describe('time helpers', () => {
  const now = Date.UTC(2026, 10, 17, 12, 0, 0);
  it('timeAgo', () => {
    expect(timeAgo(now - 30_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 30 * 3600_000, now)).toBe('yesterday');
  });
  it('elapsed', () => {
    expect(elapsed(now - 12_400, now)).toBe('12 s');
    expect(elapsed(now - 3 * 60_000 - 5_000, now)).toBe('3 min');
    expect(elapsed(now - 65 * 60_000, now)).toBe('1 h 5 min');
    expect(elapsed(now + 5_000, now)).toBe('0 s'); // clock skew never shows a negative time
  });
});
