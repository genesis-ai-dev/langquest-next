// Whether Sync shows the Share nearby row (docs/nearby-sync-plan.md 5.8), as a pure rule. Only
// the phone's hook reads it (useNearby.native.ts, `useNearbyOffered`), so the web carries none of
// it. Tested in test/shareNearbyModel.test.ts.

/** What the row lacks, where it shows disabled: the server's limit on new keys, or the certificate itself. */
export type NearbyRowMissing = 'limited' | 'no-certificate';

/**
 * The Share nearby row on Sync:
 * - shown, with nothing missing, once this phone holds a certificate for the organization and a
 *   discovery key for the language (`offered`);
 * - shown disabled, saying what is missing, where the organization has nearby on (`orgOn`) and the
 *   phone holds neither yet: the server would sign no new key for this person today (`limited`;
 *   it signs at most five a day), or the phone has not fetched them. Before 2026-11-19 the row
 *   vanished then, with nothing saying why (Carl);
 * - hidden where nearby is off for the organization, before the server has said this run, and for
 *   someone who only views organizations, who never shares nearby.
 */
export function nearbyRowShown(o: { offered: boolean; orgOn: boolean | null; limited: boolean; readOnly: boolean }): { shown: boolean; missing: NearbyRowMissing | null } {
  if (o.offered) return { shown: true, missing: null };
  if (o.orgOn !== true || o.readOnly) return { shown: false, missing: null };
  return { shown: true, missing: o.limited ? 'limited' : 'no-certificate' };
}
