import type { ReactNode } from 'react';

/** A browser wears no disguise (decisions.md 169): DisguiseGate.tsx is the phones'. */
export function DisguiseGate(props: { children: ReactNode }) {
  return <>{props.children}</>;
}
