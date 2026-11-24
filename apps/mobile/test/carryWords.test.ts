import '../src/nearby/nearbyWords';
import { teammatesFoldWords, teammateSub } from '../src/nearby/carryWords';
import { formatDayTime, formatTime } from '../src/i18n/format';

/**
 * The Teammates fold's words (docs/nearby-sync-plan.md 15.4). Why: "Today" alone read as "we
 * shared today" (Carl, 2026-11-24), but it means the newest work this phone holds from that
 * teammate is from today; no phone keeps when two last shared (decision 230).
 */

const TUESDAY = new Date(2026, 10, 24, 15, 5).getTime();
const names = (id: string) => ({ sam: 'Sam', joe: 'Joe' })[id] ?? id;

describe('the teammates\' words', () => {
  it('a row says what this phone holds of their work, up to when, or that nothing is new since it was last online', () => {
    expect(teammateSub({ profileId: 'sam', seen: 'today', newestMs: TUESDAY })).toBe(`Has their work up to ${formatTime(TUESDAY)} today`);
    expect(teammateSub({ profileId: 'sam', seen: 'since-online', newestMs: TUESDAY })).toBe(`Has their work up to ${formatDayTime(TUESDAY)}`);
    expect(teammateSub({ profileId: 'joe', seen: 'not-since-online', newestMs: null })).toBe('Nothing new from them since you were last online');
  });

  it('folded, it says every teammate\'s work from today is here, or names the one furthest behind and how far', () => {
    expect(teammatesFoldWords({ who: null, seen: 'today', newestMs: TUESDAY }, names)).toBe('Has today\'s work from every teammate');
    expect(teammatesFoldWords({ who: 'sam', seen: 'since-online', newestMs: TUESDAY }, names)).toBe(`Furthest behind: Sam, work up to ${formatDayTime(TUESDAY)}`);
    expect(teammatesFoldWords({ who: 'joe', seen: 'not-since-online', newestMs: null }, names)).toBe('Furthest behind: Joe, nothing new since you were last online');
  });
});
