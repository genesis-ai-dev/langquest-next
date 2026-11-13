import type { FirstContactStatus } from './firstContactModel';

/**
 * First contact in words (docs/nearby-sync-plan.md 14.1, 6 "After"), for Me and Scan a code: the
 * catalog key for each state and for each reason the join route gives when it refuses. Pure, so
 * the web bundle carries only these few names.
 */

const REFUSALS = {
  expired: 'account.me.local.refused.expired',
  used: 'account.me.local.refused.used',
  off: 'account.me.local.refused.off',
  not_found: 'account.me.local.refused.notFound',
  retired: 'account.me.local.refused.retired',
  taken: 'account.me.local.refused.other',
  deleted: 'account.me.local.refused.other',
  chain: 'account.me.local.refused.other',
  proof: 'account.me.local.refused.other'
} as const;

type RefusalKey = (typeof REFUSALS)[keyof typeof REFUSALS];

/** Why the join route refused, in words; any reason it may add later reads as the general one. */
export function refusalWords(status: string): RefusalKey {
  return Object.prototype.hasOwnProperty.call(REFUSALS, status) ? REFUSALS[status as keyof typeof REFUSALS] : 'account.me.local.refused.other';
}

/** The line Me shows for first contact; null when there is nothing to say. */
export function firstContactWords(s: FirstContactStatus): RefusalKey | 'account.me.local.waiting' | 'account.me.local.joining' | 'account.me.local.finishing' | 'account.me.local.needsCode' | 'account.me.local.keyLost' | 'account.me.local.otherAccount' | null {
  switch (s.kind) {
    case 'none': return null;
    case 'waiting': return 'account.me.local.waiting';
    case 'joining': return 'account.me.local.joining';
    case 'finishing': return 'account.me.local.finishing';
    case 'refused': return refusalWords(s.status);
    case 'needsCode': return 'account.me.local.needsCode';
    case 'blocked': return s.why === 'keyLost' ? 'account.me.local.keyLost' : 'account.me.local.otherAccount';
  }
}
