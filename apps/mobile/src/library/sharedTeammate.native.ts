// The Bibles other organizations share that a team reads, between teammates'
// phones (2026-11-24, review item 9). A team whose language recommends no
// Bible of its own reads other organizations' shared ones (sources/useSources.ts),
// from the list this phone keeps of what others share (`library-shared:material`,
// library/useLibrary.ts). A phone serves the rows of those in its team's
// languages, and keeps a teammate's while it has no list from the server; the
// server's read replaces them. Only a phone shares nearby, so the web carries
// none of this.
import type { LanguageState, OrgState, SourceDoc } from '@langquest-next/core';
import type { NearbyShared, NearbySharedRow } from '@langquest-next/sync/nearby';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SHARED_TEAMMATE_PREFIX } from './sharedKeys';

const KEY = 'library-shared:material';
const TEAMMATE_KEY = `${SHARED_TEAMMATE_PREFIX}material`;

/**
 * The most rows a teammate's phone may leave in the list, in all, over every session (security review, 2026-11-24): a
 * team reads a handful of other organizations' Bibles, and a hostile teammate could otherwise add rows without end.
 */
const TEAMMATE_ROWS_MAX = 200;

const fromServer = async (): Promise<boolean> => {
  const [kept, teammate] = await Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(TEAMMATE_KEY)]);
  return kept !== null && teammate === null;
};

async function readRows(): Promise<NearbySharedRow[]> {
  const raw = await AsyncStorage.getItem(KEY);
  const rows = raw ? (JSON.parse(raw) as unknown) : [];
  return Array.isArray(rows) ? (rows as NearbySharedRow[]) : [];
}

/** The shared Bibles of this organization's language, as its screens would offer them, for nearby sessions. */
export function phoneSharedFor(o: { orgId: string; languageId: string; org: () => OrgState | null; state: () => LanguageState | null }): NearbyShared {
  // Another organization's shared material whose document is a Bible in one of the team's languages, or not here to tell.
  // A teammate's row whose document came and is not one is dropped from the list (security review, 2026-11-24).
  const inTeam = async (rows: readonly NearbySharedRow[]): Promise<NearbySharedRow[]> => {
    // Read when a session asks: the app's languages and their words, and the document store, stay out of what nearby code loads at start.
    const [{ inLanguages, teamLanguages }, { heldDoc }] = await Promise.all([import('../reference/languages'), import('./docStore')]);
    const languages = teamLanguages(o.org(), o.state(), o.languageId);
    const out: NearbySharedRow[] = [];
    const wrong = new Set<NearbySharedRow>();
    for (const r of rows) {
      if (r.org_id === o.orgId || r.kind !== 'material') continue;
      const doc = (await heldDoc(r.latest_hash).catch(() => null)) as SourceDoc | null;
      if (doc && (doc.format !== 'source@1' || !inLanguages(doc.language, languages))) {
        wrong.add(r);
        continue;
      }
      out.push(r);
    }
    if (wrong.size > 0 && !(await fromServer())) {
      await AsyncStorage.setItem(KEY, JSON.stringify(rows.filter((r) => !wrong.has(r)))).catch(() => undefined);
    }
    return out;
  };
  return {
    hashes: async () => (await inTeam(await readRows())).map((r) => r.latest_hash),
    rows: async () => inTeam(await readRows()),
    fromServer,
    keep: async (got) => {
      // Asked again here: the server's list may have come while the teammate answered, and a teammate's rows never join it.
      if (await fromServer()) return;
      const have = await readRows();
      const known = new Set(have.map((r) => `${r.org_id}/${r.item_id}`));
      const add = got.filter((r) => r.org_id !== o.orgId && !known.has(`${r.org_id}/${r.item_id}`)).slice(0, Math.max(0, TEAMMATE_ROWS_MAX - have.length));
      if (add.length === 0) return;
      // Marked as not yet the server's, so the next teammate may add to it and the server's read replaces it.
      await AsyncStorage.multiSet([[KEY, JSON.stringify([...have, ...add])], [TEAMMATE_KEY, '1']]);
    },
    // Noted as an expected error; diagnostics load only when one happens, as nothing else here needs them.
    failed: (err) => { void import('../diagnostics/report').then((m) => m.noteExpected('nearby: shared bibles', err)).catch(() => undefined); }
  };
}
