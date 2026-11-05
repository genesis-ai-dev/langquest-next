// Dates, numbers and sizes in the language showing, through Intl (LAN-42).
// Hermes has Intl.NumberFormat and Intl.DateTimeFormat on both platforms; it
// lacks RelativeTimeFormat, ListFormat and DisplayNames, so "5 min ago" and
// lists are catalog strings and country names come from reports/countries.ts.
import { currentLocale, t } from './index';

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function numberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = currentLocale();
  const key = `${locale}|${JSON.stringify(options ?? {})}`;
  let f = numberFormats.get(key);
  if (!f) { f = new Intl.NumberFormat(locale, options); numberFormats.set(key, f); }
  return f;
}

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = currentLocale();
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = dateFormats.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, options); dateFormats.set(key, f); }
  return f;
}

/** 1234 → "1,234" (English), "1.234" (Portuguese), "١٬٢٣٤" (Arabic). */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return numberFormat(options).format(n);
}

/** 42.5 (a percentage already) → "42.5%"; whole numbers keep no decimals. */
export function formatPercent(percent: number): string {
  return numberFormat({ style: 'percent', maximumFractionDigits: Number.isInteger(percent) ? 0 : 1 }).format(percent / 100);
}

type DateLike = Date | number | string;
const asDate = (d: DateLike) => (d instanceof Date ? d : new Date(d));

/** "Oct 1" */
export function formatDay(d: DateLike, options: { utc?: boolean } = {}): string {
  return dateFormat({ month: 'short', day: 'numeric', ...(options.utc ? { timeZone: 'UTC' } : {}) }).format(asDate(d));
}

/** "Oct 1, 2025" */
export function formatDayYear(d: DateLike, options: { utc?: boolean } = {}): string {
  return dateFormat({ month: 'short', day: 'numeric', year: 'numeric', ...(options.utc ? { timeZone: 'UTC' } : {}) }).format(asDate(d));
}

/** "10/1/2025", the short date people write. */
export function formatShortDate(d: DateLike): string {
  return dateFormat({ year: 'numeric', month: 'numeric', day: 'numeric' }).format(asDate(d));
}

/** "Oct 1, 3:05 PM" */
export function formatDayTime(d: DateLike): string {
  return dateFormat({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(asDate(d));
}

/** "3:05 PM" */
export function formatTime(d: DateLike, options: { seconds?: boolean } = {}): string {
  return dateFormat({ hour: 'numeric', minute: '2-digit', ...(options.seconds ? { second: '2-digit' } : {}) }).format(asDate(d));
}

/** A month ("2025-10") as "October 2025". */
export function formatMonthYear(month: string): string {
  return dateFormat({ month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month.slice(0, 7)}-15T12:00:00Z`));
}

/** A month ("2025-10") as "Oct". */
export function formatMonthShort(month: string): string {
  return dateFormat({ month: 'short', timeZone: 'UTC' }).format(new Date(`${month.slice(0, 7)}-15T12:00:00Z`));
}

/** How long ago, as people say it: "Just now", "5 min ago", "3 h ago", then the day. */
export function formatAgo(ms: number, now = Date.now()): string {
  const ago = now - ms;
  if (ago < 60_000) return t('time.justNow');
  if (ago < 3_600_000) return t('time.minutesAgo', { count: Math.floor(ago / 60_000) });
  if (ago < 86_400_000) return t('time.hoursAgo', { count: Math.floor(ago / 3_600_000) });
  return new Date(ms).getFullYear() === new Date(now).getFullYear() ? formatDay(ms) : formatDayYear(ms);
}

/** A length of audio: 74 500 ms → "1:14". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return t('time.clock', { minutes: formatNumber(minutes), seconds: formatNumber(seconds, { minimumIntegerDigits: 2 }) });
}

/** Bytes as "512 KB", "3.4 MB", "1.2 GB" (Hermes has no unit style, so the units are catalog strings). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return t('units.gigabytes', { value: formatNumber(bytes / 1024 ** 3, { maximumFractionDigits: 1 }) });
  if (bytes >= 1024 ** 2) return t('units.megabytes', { value: formatNumber(bytes / 1024 ** 2, { maximumFractionDigits: 1 }) });
  return t('units.kilobytes', { value: formatNumber(bytes / 1024, { maximumFractionDigits: 0 }) });
}
