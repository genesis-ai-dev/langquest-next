import { CommandError } from '@langquest-next/core';

// The one place faults are reported (error-tracking skill). No tracker is
// chosen yet (a docs/decisions.md entry when one is), so this logs a
// content-free line and hands back a short id the user can read to support.
// Never pass user content in `where`; the error's message is not logged,
// only its type and stack, because messages can carry what people typed.

let counter = 0;

/** A short id a tester can read out over a call ("E-7K2Q"). */
function errorId(): string {
  counter = (counter + 1) % 1296;
  const t = (Date.now() % 1_679_616).toString(36).toUpperCase().padStart(4, '0');
  return `E-${t}${counter.toString(36).toUpperCase().padStart(2, '0')}`;
}

/** Report a fault; returns the id shown to the user. */
export function reportError(where: string, error: unknown): string {
  const id = errorId();
  const e = error instanceof Error ? error : new Error('non-error thrown');
  console.error(`[error ${id}] ${where}: ${e.name}`, e.stack ?? '');
  return id;
}

/** A failure that is expected and already shown to the user: count it, do not report it as a fault. */
export function noteExpected(where: string, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  console.warn(`[expected] ${where}: ${name}`);
}

let installed = false;

/**
 * Route uncaught JS errors and unhandled promise rejections to the same
 * reporter as the error boundaries, keeping React Native's own handler.
 */
export function installGlobalHandlers(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as unknown as {
    ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void };
    addEventListener?: (type: string, listener: (event: { reason?: unknown }) => void) => void;
  };
  const previous = g.ErrorUtils?.getGlobalHandler();
  g.ErrorUtils?.setGlobalHandler((e, fatal) => {
    reportError(fatal ? 'global (fatal)' : 'global', e);
    previous?.(e, fatal);
  });
  g.addEventListener?.('unhandledrejection', (event) => { reportError('unhandled promise', event.reason); });
}

/**
 * What to tell someone when an action failed: a command's own reason when
 * core refused it (an expected outcome), otherwise a reported fault with its
 * code and the reassurance that nothing was lost.
 */
export function failureMessage(where: string, e: unknown): string {
  if (e instanceof CommandError) return e.message;
  return `Something went wrong (code ${reportError(where, e)}). Nothing was lost.`;
}
