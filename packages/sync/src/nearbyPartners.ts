/**
 * Which teammate to talk to next (docs/nearby-sync-plan.md 5.11, 5.12). Pure, with no
 * clock inside: `NearbyRoom` works out what depends on time and passes it in.
 */
export interface PartnerInRange {
  tag: string;
  key: string | null;
  summary: string;
  /** In `nearbyPeers`, oldest first. */
  position: number | null;
  /** Both final summaries from `nearbyPeers`. */
  finished: { mine: string; theirs: string } | null;
  /** From holdings; an unknown key counts as true. */
  hasWhatIWant: boolean;
  wantsWhatIHave: boolean;
  /** It has echoed this phone's salt; true for a phone that cannot advertise. */
  echoed: boolean;
  /** Heard under a generation below this phone's newest, so it cannot hear this phone. */
  older: boolean;
  /** Its key is on the revocation list. */
  listed: boolean;
  /** From the room's own timer: the two have not exchanged for a set time. */
  dueAnyway: boolean;
}

const lower = (a: PartnerInRange, b: PartnerInRange): number => {
  // Never met first, then the longest ago, then the lowest tag, so two phones with the same view pick the same order.
  const placeA = a.position ?? -1;
  const placeB = b.position ?? -1;
  if (placeA !== placeB) return placeA - placeB;
  return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;
};

/**
 * Null means "Up to date". `waited` is the time-out for a phone that is not the lower tag:
 * the other may only be able to scan, so nobody would otherwise connect.
 */
export function choosePartner(
  me: { tag: string; summary: string },
  inRange: readonly PartnerInRange[],
  opts: { waited?: boolean } = {}
): { partner: string; connect: boolean } | null {
  const worthIt = inRange.filter((p) => {
    if (p.listed) return false;
    // Finished with both summaries as they stand: nothing has changed since, even if the two differ, as they do when one phone has no room.
    if (p.finished && p.finished.mine === me.summary && p.finished.theirs === p.summary) return false;
    // `dueAnyway` overrides only this, because it alone rests on what others claim.
    return !(p.summary === me.summary && !p.hasWhatIWant && !p.wantsWhatIHave && !p.dueAnyway);
  });
  const [best] = [...worthIt].sort(lower);
  if (!best) return null;
  return { partner: best.tag, connect: best.echoed && (best.older || opts.waited === true || me.tag < best.tag) };
}
