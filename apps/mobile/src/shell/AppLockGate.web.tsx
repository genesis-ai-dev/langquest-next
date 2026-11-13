import type { ReactNode } from 'react';

/**
 * The web has no app lock (decisions.md 200): a browser forgets everything
 * on sign-out (decision 11), and none of the lock's code is in its bundle.
 * Phones take AppLockGate.tsx.
 */
export function AppLockGate(props: { actorId: string | null | undefined; children: ReactNode }) {
  return <>{props.children}</>;
}
