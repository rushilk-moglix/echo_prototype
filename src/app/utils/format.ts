/** Shared formatters — kept in one place so units read the same on every page. */

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

/** Seconds as m:ss — call lengths are read as durations, not decimals. */
export function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds && seconds !== 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay
    ? time
    : `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${time}`;
}

export function clock(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) { const d = Math.floor(s / 86400); return `${d} day${d === 1 ? '' : 's'} ago`; }
  return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Seconds as m:ss (or h:mm:ss), for ring and talk time. */
export function fmtSecs(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  const n = Math.round(s), h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), x = n % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}
