import { DAY } from '../../shared/domain';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN');
const date = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const dateYear = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const formatINR = (v: number) => inr.format(v);
export const formatCount = (v: number) => num.format(v);

/** ₹ 4.2 Cr / ₹ 12.5 L / ₹ 85K: Indian short form for totals. */
export function formatINRShort(v: number): string {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e9 ? 0 : 1)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  if (v >= 1e3) return `₹${Math.round(v / 1e3)}K`;
  return `₹${v}`;
}

export function formatDate(ts: number, now = Date.now()): string {
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return (sameYear ? date : dateYear).format(ts);
}

/** "today", "3d ago", "in 5d" */
export function relativeDays(ts: number, now = Date.now()): string {
  const d = Math.round((ts - now) / DAY);
  if (d === 0) return 'today';
  return d < 0 ? `${-d}d ago` : `in ${d}d`;
}

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const daysBetween = (a: number, b: number) => Math.floor((b - a) / DAY);
