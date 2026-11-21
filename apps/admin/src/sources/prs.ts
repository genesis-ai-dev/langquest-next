import { githubApi, type GitHubEnv } from './githubApi';

/**
 * What a pull request is about, for the box the page shows when a person
 * points at or taps "PR 596" anywhere on it (pageRefs.ts): its title without
 * the codes in it, a few plain lines from its text, and whether it merged.
 * Most numbers on the page mean nothing to a person who does not remember
 * hundreds of pull requests; this says what each one changed for people.
 * Only numbers, titles, text and times are kept, never a login.
 */

export interface PrInfo {
  number: number;
  /** The title without "release/ios: ", "(#565)", "LAN-12: " or "(LAN-12)". */
  title: string;
  /** A few plain lines from its text (prSummary); null when it has none. */
  summary: string | null;
  state: 'open' | 'merged' | 'closed';
  /** When it merged or closed, or when it was opened. */
  at: string | null;
  /** A copy onto a release branch (decisions.md 155): the platform whose public build it is for, and the pull request on main it carries. */
  copyFor: 'ios' | 'android' | null;
  copyOf: number | null;
}

interface Pull { number: number; title: string; body: string | null; state: string; merged_at: string | null; closed_at: string | null; created_at: string; base?: { ref?: string } }

const RELEASE = /^release\/(ios|android): /;

/** A title as a person reads it: no branch name, no pull request or Linear numbers. */
export function plainTitle(title: string): string {
  return title
    .replace(RELEASE, '')
    .replace(/\s*\(#\d+\)\s*$/, '')
    .replace(/^LAN-\d+\s*:?\s*/, '')
    .replace(/\s*\((?:LAN-\d+(?:,\s*)?)+\)\s*$/, '')
    .trim()
    .slice(0, 200);
}

/** The sections whose first lines say what people see, newest name first (CONTRIBUTING.md, Pull requests). */
const PLAIN_HEADING = /^#{1,4}\s*(?:What people see|What people get|What changes for people|What breaks today|What changed|What it fixes|Why)\b/i;
const MAX_LINES = 4;
const MAX_CHARS = 360;

/** Markdown to plain text: links to their words, no code marks, bold or images. */
function plain(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]{1,2}([^`*_]+)[`*_]{1,2}/g, '$1')
    .replace(/^\s*[-*+]\s+/, '• ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A few plain lines from a pull request's text: a "Plain words:" line when
 * it has one, else the start of its "What people see" section (or the
 * nearest such section), else its first paragraph. The attribution lines
 * and comments a project thread adds are left out, as are tables and code.
 */
export function prSummary(body: string | null): string | null {
  const lines = String(body ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*_Requested by\b/.test(l));
  const said = lines.map((l) => /^\s*(?:Plain words|User-facing|In plain words)\s*:\s*(.+)$/i.exec(l)?.[1]).find(Boolean);
  if (said) return cut([plain(said)]);
  const at = lines.findIndex((l) => PLAIN_HEADING.test(l));
  const from = at >= 0 ? at + 1 : 0;
  const out: string[] = [];
  let fence = false;
  for (const l of lines.slice(from)) {
    if (/^\s*```/.test(l)) { fence = !fence; continue; }
    if (fence || /^\s*\|/.test(l)) continue;
    if (/^#{1,6}\s/.test(l)) { if (out.length) break; continue; }
    if (!l.trim()) { if (out.length && at < 0) break; continue; }
    const p = plain(l);
    if (p) out.push(p);
    if (out.length >= MAX_LINES) break;
  }
  return out.length ? cut(out) : null;
}

/** "Part of LAN-316.", "Fixes LAN-12 and LAN-13." and "A follow-up to #591:" say nothing to a person: the box leaves them out. */
const NUMBERS_FIRST = /^(?:(?:Part of|Fixes|Fixed|Closes)\s+(?:LAN-\d+(?:,\s*|\s+and\s+)?)+\.?\s*)?(?:A follow-up to #\d+[:.]?\s*)?/i;

/** At most MAX_LINES lines and MAX_CHARS characters, cut at a word. */
function cut(lines: string[]): string | null {
  const first = (lines[0] ?? '').replace(NUMBERS_FIRST, '');
  lines = [first.charAt(0).toUpperCase() + first.slice(1), ...lines.slice(1)].filter(Boolean);
  let text = lines.slice(0, MAX_LINES).join('\n').trim();
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS).replace(/\s+\S*$/, '') + '…';
  return text || null;
}

export function prInfo(p: Pull): PrInfo {
  const copy = RELEASE.exec(p.title) ?? (/^release\/(ios|android)$/.exec(p.base?.ref ?? '') as RegExpExecArray | null);
  const copyOf = copy
    ? Number(/^- [0-9a-f]{40} #(\d+)/m.exec(p.body ?? '')?.[1] ?? /\(#(\d+)\)\s*$/.exec(p.title)?.[1] ?? /Merge pull request #(\d+)/.exec(p.title)?.[1] ?? NaN)
    : NaN;
  const state = p.merged_at ? 'merged' : p.state === 'open' ? 'open' : 'closed';
  return {
    number: p.number,
    title: plainTitle(p.title),
    // A copy's own text says how copies work, the same for each; the box says it in its own words.
    summary: copy ? null : prSummary(p.body),
    state,
    at: p.merged_at ?? p.closed_at ?? p.created_at ?? null,
    copyFor: copy ? (copy[1] as 'ios' | 'android') : null,
    copyOf: Number.isFinite(copyOf) ? copyOf : null
  };
}

/** How many a page may ask for at once. */
export const PRS_MAX = 40;
/** How long an open pull request's answer is kept: its title or state may change. A merged or closed one is kept for the isolate's life. */
const OPEN_MS = 5 * 60_000;
const cache = new Map<number, { info: PrInfo | null; at: number }>();

/** The numbers a page asks for, as "596,592": whole numbers only, each once, at most PRS_MAX. */
export function askedNumbers(q: string | null): number[] | null {
  const parts = String(q ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > PRS_MAX || parts.some((s) => !/^\d{1,6}$/.test(s))) return null;
  return [...new Set(parts.map(Number))];
}

/** Each asked pull request's PrInfo, null for one GitHub does not know; one that could not be read now is left out, so the page asks again later. */
export async function prInfos(env: GitHubEnv, numbers: number[], fetcher: typeof fetch = fetch, now = Date.now()): Promise<Record<string, PrInfo | null>> {
  const gh = githubApi(env, fetcher);
  const out: Record<string, PrInfo | null> = {};
  await Promise.all(numbers.map(async (n) => {
    const kept = cache.get(n);
    if (kept && (kept.info?.state !== 'open' || now - kept.at < OPEN_MS)) { out[n] = kept.info; return; }
    try {
      const info = prInfo(await gh<Pull>(`/pulls/${n}`, 'GitHub pull request'));
      cache.set(n, { info, at: now });
      out[n] = info;
    } catch (e) {
      if (/\b404\b/.test(e instanceof Error ? e.message : '')) { cache.set(n, { info: null, at: now }); out[n] = null; }
    }
  }));
  return out;
}

/** For tests: forget what was read. */
export function forgetPrs(): void { cache.clear(); }
