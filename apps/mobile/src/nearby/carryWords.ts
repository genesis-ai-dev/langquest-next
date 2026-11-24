import { t } from '../i18n';
import { formatDayTime } from '../i18n/format';
import type { CarryTeammate } from './readyToCarryModel';
import { SEEN_WORDS } from './shareNearbyModel';

/**
 * A teammate's line, under Ready to carry on Share nearby and in Sync and offline's Teammates fold
 * (docs/nearby-sync-plan.md 5.8, 15.4): how recent the newest work held from them is, and when they
 * made it, unless that is today.
 */
export function teammateSub(m: CarryTeammate): string {
  const seen = t(SEEN_WORDS[m.seen]);
  return m.seen !== 'today' && m.newestMs !== null ? `${seen} · ${t('nearby.carry.newest', { when: formatDayTime(m.newestMs) })}` : seen;
}
