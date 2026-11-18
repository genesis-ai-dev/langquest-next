import { useEffect, useState } from 'react';
import { currentSession, onAuthChange } from '../server/auth';

/**
 * Whether the account has a password: a looked-after one made by joining has
 * none until its owner sets one on Edit Profile (the `join` function marks
 * it), and keeps none if it adds an email without one; every other account
 * chose one. Null until read from the stored session.
 */
export function useHasPassword(): [boolean | null, () => void] {
  const [has, setHas] = useState<boolean | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void currentSession().then((session) => {
      if (active) setHas(session?.user.user_metadata?.['has_password'] !== false);
    });
    return () => { active = false; };
  }, [tick]);
  // A password set on Edit Profile updates the user: Sign Out, opened after it, reads it again (ACCT-021).
  useEffect(() => {
    return onAuthChange((event) => { if (event === 'USER_UPDATED') setTick((n) => n + 1); });
  }, []);
  return [has, () => setTick((n) => n + 1)];
}
