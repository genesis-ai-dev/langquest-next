/** A toast: what happened, said once (CORE-5). */
export interface ToastSpec {
  id: number;
  message: string;
  /** How long it shows, for the bar that counts down to its going (the host sets it). */
  ms?: number;
  /** Something went wrong (a save refused, a fault with its code): it stays until closed. */
  tone?: 'problem';
}

/**
 * How a toast looks. Done is a green check that goes by itself. A problem is
 * an amber warning that stays until closed, so its words, and the code a
 * person reads out to support, are never gone before they are read, and a
 * failure never wears the check that says it worked (UI audit, finding 20).
 */
export function toastLook(spec: Pick<ToastSpec, 'tone'>): { icon: 'check' | 'warning'; color: 'green' | 'amber'; goesBy: boolean; live: 'polite' | 'assertive' } {
  return spec.tone === 'problem'
    ? { icon: 'warning', color: 'amber', goesBy: false, live: 'assertive' }
    : { icon: 'check', color: 'green', goesBy: true, live: 'polite' };
}
