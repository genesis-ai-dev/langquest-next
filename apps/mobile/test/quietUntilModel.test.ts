import { QUIET_SOON_MS, quietLineOf, quietLinesShown, quietUntilOf, type QuietFacts } from '../src/nearby/quietUntilModel';

/**
 * The Teammates fold's line while LangQuest is open (docs/nearby-sync-plan.md 15.8). Why: a team
 * out of reach for weeks has to know when to meet on Share nearby before the mode stops taking a
 * teammate, and the date must never be later than the one Hello will hold to.
 */

const DAY = 86_400_000;
const WINDOW = 14 * DAY;
const facts = (o: Partial<QuietFacts> = {}): QuietFacts => ({ windowMs: WINDOW, mySignedAt: null, theirs: [], met: [], ...o });

describe('until when this phone shares with each teammate while LangQuest is open', () => {
  it('a pair lasts until the older of the two certificates plus the window', () => {
    const until = quietUntilOf(facts({ mySignedAt: 100 * DAY, theirs: [{ profileId: 'sam', signedAt: 90 * DAY }, { profileId: 'ana', signedAt: 105 * DAY }] }));
    expect(until.get('sam')).toBe(90 * DAY + WINDOW);
    // Ana renewed later than this phone: this phone's own certificate is the older one.
    expect(until.get('ana')).toBe(100 * DAY + WINDOW);
  });

  it('or until the start of the day met on Share nearby plus the window, whichever is later', () => {
    const until = quietUntilOf(facts({ mySignedAt: 100 * DAY, theirs: [{ profileId: 'sam', signedAt: 90 * DAY }], met: [{ profileId: 'sam', day: 98 }, { profileId: 'cy', day: 80 }] }));
    expect(until.get('sam')).toBe(98 * DAY + WINDOW);
    // Met long ago and no certificate known: only the day counts, even past.
    expect(until.get('cy')).toBe(80 * DAY + WINDOW);
  });

  it('a person with several phones gets the latest, and one this phone knows nothing of gets no date', () => {
    const until = quietUntilOf(facts({ mySignedAt: 100 * DAY, theirs: [{ profileId: 'sam', signedAt: 90 * DAY }, { profileId: 'sam', signedAt: 95 * DAY }] }));
    expect(until.get('sam')).toBe(95 * DAY + WINDOW);
    expect(until.has('ana')).toBe(false);
    // With no certificate of its own, only days met count.
    expect(quietUntilOf(facts({ theirs: [{ profileId: 'sam', signedAt: 95 * DAY }] })).size).toBe(0);
  });

  it('the line: until when, a nudge from three days before, stopped once past, nothing where nothing is known', () => {
    const now = 200 * DAY;
    expect(quietLineOf(undefined, now)).toBeNull();
    expect(quietLineOf(now + 10 * DAY, now)).toEqual({ t: 'until', at: now + 10 * DAY });
    expect(quietLineOf(now + QUIET_SOON_MS + 1, now)).toEqual({ t: 'until', at: now + QUIET_SOON_MS + 1 });
    expect(quietLineOf(now + QUIET_SOON_MS, now)).toEqual({ t: 'soon', at: now + QUIET_SOON_MS });
    expect(quietLineOf(now + 1, now)).toEqual({ t: 'soon', at: now + 1 });
    expect(quietLineOf(now, now)).toEqual({ t: 'lapsed' });
  });

  it('shows only offline where the mode may run here', () => {
    expect(quietLinesShown({ notesMet: true, offline: true })).toBe(true);
    expect(quietLinesShown({ notesMet: false, offline: true })).toBe(false);
    expect(quietLinesShown({ notesMet: true, offline: false })).toBe(false);
  });
});
