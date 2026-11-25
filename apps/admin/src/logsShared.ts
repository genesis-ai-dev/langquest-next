/**
 * What the log gate's readers share (logs.ts, logsApis.ts): limits, the
 * error a reader throws, fetching, and taking personal data out of a line.
 */

/** Lines one answer holds at most; the newest are kept, where the failure usually is. */
export const LOGS_MAX_LINES = 2_000;
export const LOGS_MAX_LINE = 2_000;
export const LOGS_MAX_MINUTES = 24 * 60;

/** `first`: the lines are the first of the answer (`head`), not the newest (`tail`). */
export interface LogAnswer { lines: string[]; truncated: boolean; note?: string; first?: boolean }

export class Refused extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:){2,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?(?![\w:])/gi;
const PHONE = /\+\d[\d ().-]{6,}\d/g;

/**
 * A line with personal data taken out: emails, IP addresses and
 * international phone numbers. Ids, codes, hashes and times stay. Every
 * login gets this on the provider APIs (logsApis.ts); agent_reader gets
 * `redact` on log lines.
 */
export function maskPersonal(line: string): string {
  return line.replace(EMAIL, '[email]').replace(IPV4, '[ip]').replace(IPV6, '[ip]').replace(PHONE, '[number]');
}

/**
 * A log line for agent_reader: personal data out (`maskPersonal`), and what
 * could open something too: bearer tokens and JWTs, `key=` and the like, and
 * long hex or base64 runs that are not a uuid. Ids (uuids), codes and times
 * stay, as agent_reader reads them in the database.
 */
export function redact(line: string): string {
  return line
    .replace(EMAIL, '[email]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .replace(/\bbearer\s+[^\s"',}]+/gi, 'Bearer [hidden]')
    .replace(/\b(token|key|secret|password|apikey|authorization|code)(["']?\s*[:=]\s*["']?)[^\s"',}&]+/gi, '$1$2[hidden]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[A-Za-z])[A-Za-z0-9+_-]{32,}={0,2}/g, (m) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m) ? m : '[long value]'))
    .replace(IPV4, '[ip]').replace(IPV6, '[ip]')
    .replace(PHONE, '[number]');
}

/** The newest LOGS_MAX_LINES lines, each cut to LOGS_MAX_LINE characters. */
export function tail(lines: string[], note?: string): LogAnswer {
  const cut = lines.length > LOGS_MAX_LINES;
  const kept = (cut ? lines.slice(-LOGS_MAX_LINES) : lines).map((l) => (l.length > LOGS_MAX_LINE ? `${l.slice(0, LOGS_MAX_LINE)}…` : l));
  return { lines: kept, truncated: cut, ...(note ? { note } : {}) };
}

/** The first LOGS_MAX_LINES lines: for an API's answer, which reads from the top. */
export function head(lines: string[], note?: string): LogAnswer {
  const cut = lines.length > LOGS_MAX_LINES;
  const kept = (cut ? lines.slice(0, LOGS_MAX_LINES) : lines).map((l) => (l.length > LOGS_MAX_LINE ? `${l.slice(0, LOGS_MAX_LINE)}…` : l));
  return { lines: kept, truncated: cut, first: true, ...(note ? { note } : {}) };
}

export const str = (v: unknown, name: string, pattern: RegExp): string => {
  if (typeof v !== 'string' || !pattern.test(v)) throw new Refused(`${name} is missing or not well formed`);
  return v;
};
export const num = (v: unknown, fallback: number, max: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.max(1, Math.min(n, max));
};
export const need = (token: string | undefined, name: string, what: string): string => {
  if (!token) throw new Refused(`The admin Worker has no ${name}, so it cannot read ${what} (docs/admin.md).`, 503);
  return token;
};
export const ISO = (ms: number) => new Date(ms).toISOString();

/**
 * The gate's answer when a provider refuses a read. A refusal of what was
 * asked (a run, job or path it does not have, a query it does not take,
 * its rate limit) is the caller's to change, so it stays that 4xx. A key the
 * provider refuses (401, 403) and the provider's own fault are this
 * Worker's: 502. Every refusal was a 502 before, so an agent that asked for
 * a run GitHub does not have counted as a server error of the ops dashboard
 * in the watch for user issues (LAN-327).
 */
export const providerStatus = (status: number): number =>
  status >= 400 && status < 500 && status !== 401 && status !== 403 ? status : 502;

export async function getJson<T>(fetcher: typeof fetch, url: string, init: RequestInit, what: string): Promise<T> {
  const res = await fetcher(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? ' (the token is refused or lacks a permission)' : '';
    const detail = (await res.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
    throw new Refused(`${what}: HTTP ${res.status}${hint}${detail ? `: ${maskPersonal(detail)}` : ''}`, providerStatus(res.status));
  }
  return (await res.json()) as T;
}
