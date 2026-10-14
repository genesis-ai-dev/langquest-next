import { useEffect, useState } from 'react';
import { currentSession, onAuthChange } from '../server/auth';

/**
 * Whether a looked-after account has a password: one made by joining has
 * none until its owner sets one (the `join` function marks it); older ones
 * chose one when they joined. Null until read from the stored session.
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
  // A password set on Edit Profile updates the user: More settings, still open under it, reads it again (ACCT-021).
  useEffect(() => {
    return onAuthChange((event) => { if (event === 'USER_UPDATED') setTick((n) => n + 1); });
  }, []);
  return [has, () => setTick((n) => n + 1)];
}
