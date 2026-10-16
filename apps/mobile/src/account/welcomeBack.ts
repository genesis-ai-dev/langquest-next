/**
 * Welcome back (demo ADR-043, docs/v2-import.md section 3): someone who
 * signed in with their account from the old LangQuest (v2) is told which of
 * their v2 projects have come over, as languages, and which are still on
 * their way. The server answers for the person signed in (`v2_welcome`,
 * read by useWelcomeBack.ts); this is what the answer means. Kept free of
 * React Native so the tests can load it.
 */

/** One of their v2 projects, here now as a language they can open. */
export interface ArrivedLanguage {
  languageId: string;
  orgId: string;
  orgName: string;
  /** The language's name here. */
  name: string;
  /** Their v2 project's name. */
  was: string;
  /** What they recorded in it, and in how many passages. */
  recordings: number;
  passages: number;
  /** The passage they recorded last, and when (an HLC, which sorts as text). */
  lastUnitId: string | null;
  lastAt: string | null;
}

export interface V2Welcome {
  here: ArrivedLanguage[];
  /** v2 projects not moved yet, by their v2 name. */
  onTheirWay: { id: string; name: string }[];
}

/** Did this account come from v2? Set by the v2-sign-in function when it made the account. */
export function isFromV2(user: { user_metadata?: Record<string, unknown> } | null | undefined): boolean {
  return user?.user_metadata?.['from_v2'] === true;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The server's answer, or a cached one, read defensively: anything odd is left out. */
export function parseWelcome(raw: unknown): V2Welcome | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { here?: unknown; onTheirWay?: unknown };
  const here = (Array.isArray(r.here) ? r.here : []).flatMap((x: Record<string, unknown>) =>
    x && str(x['languageId']) && str(x['orgId']) ? [{
      languageId: str(x['languageId']), orgId: str(x['orgId']), orgName: str(x['orgName']) || str(x['orgId']),
      name: str(x['name']) || str(x['was']), was: str(x['was']), recordings: num(x['recordings']), passages: num(x['passages']),
      lastUnitId: str(x['lastUnitId']) || null, lastAt: str(x['lastAt']) || null
    }] : []);
  const onTheirWay = (Array.isArray(r.onTheirWay) ? r.onTheirWay : []).flatMap((x: Record<string, unknown>) =>
    x && str(x['id']) ? [{ id: str(x['id']), name: str(x['name']) }] : []);
  return { here, onTheirWay };
}

/** Is there anything to welcome them back to? Someone whose v2 projects all stay behind is welcomed as anyone new. */
export function hasWelcome(w: V2Welcome | null): w is V2Welcome {
  return !!w && w.here.length + w.onTheirWay.length > 0;
}

/** The language they recorded in last, among those in the organization open. */
export function lastWork(w: V2Welcome, orgId: string): ArrivedLanguage | undefined {
  return w.here.filter((l) => l.orgId === orgId && l.lastUnitId)
    .sort((a, b) => ((a.lastAt ?? '') < (b.lastAt ?? '') ? 1 : -1))[0];
}
