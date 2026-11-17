import type { Ctx } from '../shell/ctx';

export interface DeliveryRefusal { actorId: string; reason: string }

const NONE: readonly DeliveryRefusal[] = [];

/**
 * Teammates' work the server refused whole when this phone delivered it (docs/nearby-sync-plan.md
 * section 6). Only a phone carries teammates' work (useDeliveryRefusals.native.ts); here, on the web, there
 * is none, and this bundle reads nothing for it.
 */
export function useDeliveryRefusals(_ctx: Ctx): readonly DeliveryRefusal[] {
  return NONE;
}
