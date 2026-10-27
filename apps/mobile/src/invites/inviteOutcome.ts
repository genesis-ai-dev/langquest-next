import { failureOutcome, type AuthOutcome } from '../session/authOutcome';
import { outcomeOfError } from './heldInvite';

/** An invite that could not be used: why it never will, when the server said so, else how the call failed. */
export function inviteOutcome(e: unknown, code?: string): AuthOutcome {
  const message = e instanceof Error ? e.message : String(e);
  const said = outcomeOfError(message);
  if (said.kind === 'dead') return said.reason;
  if ((e as { needsName?: unknown } | null)?.needsName === true) return 'needs_name';
  return failureOutcome(e, code);
}
