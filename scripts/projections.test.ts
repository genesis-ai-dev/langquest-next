import { isLarge, LARGE } from '../server/projectionWorker';

describe('which languages the Edge pass leaves to the scheduled job (decisions.md 103)', () => {
  it('a language is large from a 10 MB snapshot, or 25,000 events past it', () => {
    // Why: a run of the Edge Function gets 256 MB and 2 s of CPU. From
    // 15:30 on 2026-10-14 the pass died on the biggest imported languages
    // (Santhali: 225,000 events, a 61 MB state, about 850 MB to fold), and
    // every language after them waited for its Inbox rows and snapshot.
    expect(LARGE).toEqual({ chars: 10_000_000, events: 25_000 });
    expect(isLarge({ chars: 9_999_999, head: 30_000, snapshotSeq: 29_000 })).toBe(false);
    expect(isLarge({ chars: 10_000_000, head: 30_000, snapshotSeq: 30_000 })).toBe(true);
  });

  it('counts the whole log when there is no snapshot, and only the tail when there is', () => {
    // Why: a first fold reads the whole log; a later one resumes from the
    // snapshot, so a big import into a small language is large until folded.
    expect(isLarge({ chars: 0, head: 25_000, snapshotSeq: 0 })).toBe(true);
    expect(isLarge({ chars: 0, head: 24_999, snapshotSeq: 0 })).toBe(false);
    expect(isLarge({ chars: 2_000_000, head: 80_000, snapshotSeq: 50_000 })).toBe(true);
    expect(isLarge({ chars: 2_000_000, head: 80_000, snapshotSeq: 70_000 })).toBe(false);
  });
});
