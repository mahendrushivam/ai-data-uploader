/** "just now", "5 min ago", "3 h ago", then a date. */
export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return 'yesterday';
  return new Date(ts).toLocaleDateString();
}

/** Short elapsed time for things in progress: "12 s", "3 min", "1 h 5 min". */
export function elapsed(sinceTs: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - sinceTs) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
