import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { recordUserEvent } from '../accountData';
import { userState } from '../server/account';

/**
 * The first sign-in welcome (ADR-022), shown once per account. The flag is
 * the one the vision screen used to set, so people already past onboarding
 * are not welcomed again. `loaded` is false until that is known.
 */
export function useOnboarding(actorId: string, signedIn: boolean) {
  const [welcomed, setWelcomed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [local, joined] = await Promise.all([AsyncStorage.getItem(`vision:${actorId}`), AsyncStorage.getItem(`joined:${actorId}`)]);
      // Joining by invite always gets the welcome (ADR-022): who invited
      // you and your role on which team are new even to a returning account.
      let seen = local === '1' && joined !== '1';
      // A device new to this account asks the server before routing, or a person
      // welcomed on another device was welcomed again (AUTH-058). Offline, or slow,
      // it goes on after a few seconds as before.
      if (!seen && signedIn && joined !== '1') {
        const asked = userState().then(({ data, error }) => !error && !!data?.visionSeen, () => false);
        const timeout = new Promise<boolean>((done) => setTimeout(() => done(false), 4000));
        if (await Promise.race([asked, timeout])) {
          await AsyncStorage.setItem(`vision:${actorId}`, '1');
          seen = true;
        } else {
          // A late answer still counts, from the next screen on.
          void asked.then(async (yes) => {
            if (!yes) return;
            await AsyncStorage.setItem(`vision:${actorId}`, '1');
            if (active) setWelcomed(true);
          });
        }
      }
      if (active) { setWelcomed(seen); setLoaded(true); }
    })().catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [actorId]);
  const markWelcomed = useCallback(async () => {
    await recordUserEvent(actorId, 'v1.VisionSeen');
    await AsyncStorage.multiSet([[`vision:${actorId}`, '1'], [`joined:${actorId}`, '0']]);
    setWelcomed(true);
  }, [actorId]);
  return { welcomed, loaded, markWelcomed };
}
