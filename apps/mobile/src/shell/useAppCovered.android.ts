import { useMemo } from 'react';
import { useDisguise } from '../disguise/useDisguise';

/**
 * Whether the phone's disguise stands in front of the app now (`covered`, its lock) and
 * whether it wears one at all (`worn`), for Share nearby's radios (docs/nearby-sync-plan.md
 * 5.8, decision 171): src/nearby reads only this, so the iPhone and web builds carry no
 * disguise code (useAppCovered.ts).
 */
export function useAppCovered(): { covered: boolean; worn: boolean } {
  const { locked, look } = useDisguise();
  const worn = look !== null;
  return useMemo(() => ({ covered: locked, worn }), [locked, worn]);
}
