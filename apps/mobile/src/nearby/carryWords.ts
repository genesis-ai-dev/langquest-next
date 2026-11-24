import { t } from '../i18n';
import { formatDayTime, formatTime } from '../i18n/format';
import type { CarryTeammate, TeammatesFoldLine } from './readyToCarryModel';
import { FOLD_WORDS, SEEN_WORDS } from './shareNearbyModel';

/**
 * A teammate's line, under Ready to carry on Share nearby and in Sync and offline's Teammates fold
 * (docs/nearby-sync-plan.md 5.8, 15.4): what this phone holds of their work, up to when they made
 * the newest of it ("Has their work up to 3:05 PM today"), or that nothing of theirs is newer than
 * this phone's last time online. Never when the two last shared: a teammate who did no work today
 * shows an older time though the phones met (Carl, 2026-11-24, after "Today" read as a sync).
 */
export function teammateSub(m: CarryTeammate): string {
  if (m.seen === 'today' && m.newestMs !== null) return t(SEEN_WORDS.today, { time: formatTime(m.newestMs) });
  if (m.seen === 'since-online' && m.newestMs !== null) return t(SEEN_WORDS['since-online'], { when: formatDayTime(m.newestMs) });
  return t(SEEN_WORDS['not-since-online']);
}

/** The fold's closed line: today's work from every teammate, or the teammate furthest behind and how far. */
export function teammatesFoldWords(line: TeammatesFoldLine, name: (profileId: string) => string): string {
  if (line.who === null || line.seen === 'today') return t(FOLD_WORDS.today);
  if (line.seen === 'since-online' && line.newestMs !== null) return t(FOLD_WORDS['since-online'], { name: name(line.who), when: formatDayTime(line.newestMs) });
  return t(FOLD_WORDS['not-since-online'], { name: name(line.who) });
}
