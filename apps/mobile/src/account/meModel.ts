// The words on Me (decision 71; the demo's simple Me). Pure, for tests.
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';

/**
 * "Ready for offline": how many kept passages are on this device, in the
 * fewest words (the full picture is one tap away, on the Sync screen).
 * The simple screens say "device", not "phone" (demo ADR-040).
 */
export function offlineCount(s: { kept: number; ready: number } | null): string {
  if (!s) return t('map.me.checking');
  if (s.kept === 0) return t('map.me.noneKept');
  if (s.ready === s.kept) return t('map.me.kept', { count: s.kept });
  return t('map.me.ready', { count: s.kept, ready: formatNumber(s.ready) });
}

/** What More settings holds, as Me's row says it. */
export function moreSettingsSub(): string {
  return t('map.me.moreSettingsSub');
}
