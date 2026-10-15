// How Reports writes numbers, dates and tones (reports/ui.tsx draws them).
import { bookName } from '../i18n/coreText';
import { currentLocale, t } from '../i18n';
import { formatDay, formatDayYear, formatMonthShort, formatMonthYear, formatNumber, formatPercent } from '../i18n/format';
import { C } from '../ui/theme';

export type Tone = 'brand' | 'green' | 'amber' | 'red' | 'gray';

export const TONE_FILL: Record<Tone, string> = { brand: C.primary, green: C.green, amber: C.amber, red: C.red, gray: C.faint };

/** 1234 → "1,234", in the language showing. */
export const num = (n: number) => formatNumber(n);

/** 42.5 (a percentage already) → "42.5%". */
export const pctText = (n: number) => formatPercent(n);

/** +12, -3: a change, with its sign. */
export const signed = (n: number) => `${n >= 0 ? '+' : ''}${formatNumber(n)}`;

// Dates are UTC days (`YYYY-MM-DD`) or ISO times from the server, said in the language showing.
export const utc = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00Z`);

export const intlFormats = new Map<string, Intl.DateTimeFormat>();

export function intl(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${currentLocale()}|${JSON.stringify(options)}`;
  let f = intlFormats.get(key);
  if (!f) { f = new Intl.DateTimeFormat(currentLocale(), { ...options, timeZone: 'UTC' }); intlFormats.set(key, f); }
  return f;
}

/** "Oct 3" */
export const shortDate = (day: string) => formatDay(utc(day), { utc: true });

/** "Oct 3, 2026" */
export const dayYear = (day: string) => formatDayYear(utc(day), { utc: true });

/** "Sat" */
export const weekday = (day: string) => intl({ weekday: 'short' }).format(utc(day));

/** "Saturday, Oct 3" */
export const longDay = (day: string) => intl({ weekday: 'long', month: 'short', day: 'numeric' }).format(utc(day));

/** A month ("2026-10") as "October 2026". */
export const monthName = (m: string) => formatMonthYear(m);

/** A month ("2026-10") as "Oct". */
export const monthShort = (m: string) => formatMonthShort(m);

/** `14:05 UTC` */
export const utcTime = (iso: string) => t('reports.timeUtc', { time: intl({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) });

/** `Oct 3, 2026, 14:05 UTC` */
export const dateTime = (iso: string) => t('reports.dateTimeUtc', {
  date: dayYear(iso), time: intl({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
});

/** Core's `timeAgo`: "just now", "5 minutes ago", "3 days ago". */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return t('reports.ago.justNow');
  if (s < 3600) return t('reports.ago.minutes', { count: Math.floor(s / 60) });
  if (s < 86_400) return t('reports.ago.hours', { count: Math.floor(s / 3600) });
  return t('reports.ago.days', { count: Math.floor(s / 86_400) });
}

/** "12 of 40" */
export const partOf = (part: number, total: number) => t('reports.partOf', { part: num(part), total: num(total) });

/** A book of the report by name: a Bible book in the language showing, else the label the organization gave it. */
export const bookOf = (b:{ bookId: string | null; label: string }) => (b.bookId ? bookName(b.bookId) : b.label);
