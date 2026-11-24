import { useNearbyWhileOpen, useWhileOpenWanted } from '../nearby/useNearbyWhileOpen.native';
import type { Ctx } from './ctx';

/**
 * Sharing while LangQuest is open (docs/nearby-sync-plan.md 15.6), on an Android phone or an
 * iPhone: mounted once beside the screens, whatever screen is open, and drawing nothing. It reads
 * only what costs nothing (the organization's `nearby_open` as last heard, the switch, a cover, the
 * language offline); the room's own hook, which reads the radios and permissions, mounts only when
 * those say it may be wanted, and stops its room when it unmounts.
 */
export function NearbyWhileOpen(props: { ctx: Ctx }) {
  return useWhileOpenWanted(props.ctx) ? <QuietRoom ctx={props.ctx} /> : null;
}

function QuietRoom(props: { ctx: Ctx }) {
  useNearbyWhileOpen(props.ctx);
  return null;
}
