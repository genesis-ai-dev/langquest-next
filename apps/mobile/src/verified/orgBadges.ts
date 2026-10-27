// Which organizations have a blue check (decisions.md 172), for every place
// that shows an organization's name: asked of the server for the names on
// screen, a few at a time, and kept on the phone so the checks show offline.
// A check is public, so it is kept across sign-outs; it is asked again after
// ten minutes.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { noteExpected } from '../diagnostics/report';
import { orgBadges } from '../server/verification';

export interface OrgBadge { domain: string; grantedAt: string }

// i18n-ignore: a storage key
const KEY = 'org-badges-v1';
const FRESH_MS = 10 * 60_000;

const known = new Map<string, { badge: OrgBadge | null; at: number }>();
const listeners = new Set<() => void>();
let version = 0;
let restored: Promise<void> | null = null;
const wanted = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function changed() {
  version++;
  for (const l of listeners) l();
}

function restore(): Promise<void> {
  restored ??= AsyncStorage.getItem(KEY).then((raw) => {
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, { badge: OrgBadge | null; at: number }>;
    for (const [id, v] of Object.entries(saved)) if (!known.has(id)) known.set(id, v);
    changed();
  }).catch((e) => noteExpected('org badges restore', e));
  return restored;
}

function save() {
  AsyncStorage.setItem(KEY, JSON.stringify(Object.fromEntries(known))).catch((e) => noteExpected('org badges save', e));
}

async function ask() {
  timer = null;
  const ids = [...wanted];
  wanted.clear();
  if (!ids.length) return;
  const { data, error } = await orgBadges(ids);
  if (error) { noteExpected('org badges', error); return; }
  const now = Date.now();
  const rows = (data ?? []) as { org_id: string; domain: string; granted_at: string }[];
  for (const id of ids) known.set(id, { badge: null, at: now });
  for (const r of rows) known.set(r.org_id, { badge: { domain: r.domain, grantedAt: r.granted_at }, at: now });
  save();
  changed();
}

/** Ask the server about these organizations soon, unless it was asked lately. `force` asks now (after a grant). */
export function refreshOrgBadges(ids: readonly (string | null | undefined)[], force = false) {
  void restore().then(() => {
    const now = Date.now();
    for (const id of ids) {
      if (!id) continue;
      const k = known.get(id);
      if (force || !k || now - k.at > FRESH_MS) wanted.add(id);
    }
    if (wanted.size && !timer) timer = setTimeout(() => void ask(), force ? 0 : 60);
  });
}

export function subscribeOrgBadges(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** A number that changes whenever a check is learnt, for React to notice (useSyncExternalStore). */
export function orgBadgesVersion(): number { return version; }

/** What the phone knows of an organization's check now. */
export function orgBadgeOf(orgId: string | null | undefined): OrgBadge | null {
  return orgId ? known.get(orgId)?.badge ?? null : null;
}
