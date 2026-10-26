import { useState } from 'react';
import type { AuthResult } from './signInFlow';

/**
 * A way in being tried (signInFlow.ts): busy while it runs, the words for
 * its refusal, and whether an address has to be confirmed first.
 */
export function useAuthStep(): { busy: boolean; error: string; checkEmail: boolean; run: (step: () => Promise<AuthResult>) => Promise<void> } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkEmail, setCheckEmail] = useState(false);
  async function run(step: () => Promise<AuthResult>) {
    setBusy(true);
    setError('');
    try {
      const result = await step();
      if (result.kind === 'error') setError(result.text);
      if (result.kind === 'check-email') setCheckEmail(true);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, checkEmail, run };
}
