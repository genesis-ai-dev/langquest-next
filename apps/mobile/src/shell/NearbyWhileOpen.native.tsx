import { usePublishNearbyCanRun } from '../nearby/useNearbyCanRun';
import { useNearbyWhileOpen, useNoMetUnderCover, useWhileOpenWanted } from '../nearby/useNearbyWhileOpen.native';
import type { Ctx } from './ctx';

/**
 * Sharing while LangQuest is open (docs/nearby-sync-plan.md 15.6), on an Android phone or an
 * iPhone: mounted once beside the screens, whatever screen is open, and drawing nothing. It reads
 * only what costs nothing (the organization's `nearby_open` as last heard, the switch, a cover, the
 * language offline); the room's own hook, which reads the radios and permissions, mounts only when
 * those say it may be wanted, and stops its room when it unmounts. Under a cover it forgets the
 * days teammates were met on Share nearby, which only the mode reads.
 */
export function NearbyWhileOpen(props: { ctx: Ctx }) {
  useNoMetUnderCover();
  // Whether Share nearby can run here, for every download button: offline they offer keeping a passage, which a teammate fills (2026-11-25).
  usePublishNearbyCanRun(props.ctx);
  return useWhileOpenWanted(props.ctx) ? <QuietRoom ctx={props.ctx} /> : null;
}

function QuietRoom(props: { ctx: Ctx }) {
  useNearbyWhileOpen(props.ctx);
  return null;
}
