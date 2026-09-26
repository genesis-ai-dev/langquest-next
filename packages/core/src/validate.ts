import type { AnyEvent } from './events';
import { isObject, registryEntry } from './eventRegistry';
import { validateObt } from './obt';

/**
 * Shape checks for envelopes and known payloads. The server runs the same
 * rules in SQL (validate_payload) before an event enters the append-only
 * log; the client runs them again so an event that slipped through can
 * never throw inside the fold. Payload rules live in EVENT_REGISTRY.
 * Unknown types pass: an older app must keep folding when a newer app emits
 * events it does not know.
 */
export function validateEvent(e: AnyEvent): string | null {
  for (const k of ['id', 'type', 'orgId', 'projectId', 'actorId', 'deviceId', 'hlc'] as const) {
    if (typeof e[k] !== 'string' || e[k] === '') return `${k} must be a non-empty string`;
  }
  if (!isObject(e.payload)) return 'payload must be an object';
  const p = e.payload as Record<string, unknown>;
  const entry = registryEntry(e.type);
  if (entry) return entry.validate(p);
  // Historic behaviour for OBT types this client does not know: the shared
  // OBT identifier rules still apply. Kept so fold output is unchanged.
  if ((e.type as string).startsWith('v1.Obt')) return validateObt(e.type, p);
  return null;
}
