import { CommonActions } from '@react-navigation/native';
import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { forgetKeyInAddress } from '../appUrl';
import type { Ctx } from '../ctx';
import { nextStep } from '../heldInvite';
import { parseKey } from '../inviteCode';
import { navRef, type Nav } from '../nav';
import { findNotification } from '../notifications';
import { notificationTarget, openAfterSwitch } from '../notificationTarget';
import { onNotificationOpened } from '../push';
import { noteExpected } from '../report';
import type { InviteHandle } from '../useHeldInvite';

let initialLinkRead = false;

/**
 * What arrives from outside the screens: a link that opens the app (a scan,
 * docs/invites-and-accounts.md flow D), an invite nobody has claimed yet, an
 * invite that will never work, and a tapped push.
 */
export function useIncoming(o: {
  nav: Nav; invite: InviteHandle; signedIn: boolean; onboardingLoaded: boolean; actorId: string; orgId: string; homeIsWork: boolean;
  toast: (message: string) => void; openTask: (languageId: string, unitId: string) => void; openOrganization: Ctx['openOrganization'];
}) {
  const { nav, invite, signedIn, onboardingLoaded, actorId, toast, homeIsWork, openTask, openOrganization, orgId: thisOrg } = o;
  useEffect(() => {
    const receive = (url: string) => {
      const key = parseKey(url);
      if (!key) return;
      forgetKeyInAddress();
      if (key.kind === 'signin') { nav.reset({ screen: 'scan_qr', params: { code: url } }); return; }
      void invite.scan(key).then(() => nav.reset({ screen: 'scan_qr' }));
    };
    if (!initialLinkRead) {
      initialLinkRead = true;
      void Linking.getInitialURL().then((url) => { if (url) receive(url); });
    }
    const listener = Linking.addEventListener('url', ({ url }) => receive(url));
    return () => listener.remove();
  }, [nav.reset, invite.scan]);
  // An invite nobody has claimed is shown to whoever is signed in, once, to
  // ask "Join as you?"; it never joins on its own (heldInvite.ts).
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!signedIn || !onboardingLoaded || !invite.held) return;
    const step = nextStep(invite.held, actorId, Date.now());
    if (step.step !== 'ask' || asked.current === invite.held.token) return;
    asked.current = invite.held.token;
    if (nav.current.screen !== 'scan_qr') nav.reset({ screen: 'scan_qr' });
  }, [signedIn, onboardingLoaded, invite.held, actorId, nav]);
  // An invite that will never work says so wherever this person is. "Join your
  // team" and the scan screen show it themselves; anyone with a home of their
  // own never saw why nothing happened (AUTH-043).
  const toldDead = useRef<string | null>(null);
  useEffect(() => {
    if (invite.status.kind !== 'dead' || !signedIn) return;
    if (['intent_chooser', 'scan_qr'].includes(nav.current.screen) || toldDead.current === invite.status.message) return;
    toldDead.current = invite.status.message;
    toast(invite.status.message);
  }, [invite.status, signedIn, nav, toast]);
  useEffect(() => {
    if (!signedIn) return;
    // People with a My Work reach the Inbox from its bell, so it opens over My Work with Back (no Inbox tab).
    const inbox = () => {
      if (homeIsWork && navRef.isReady()) {
        navRef.dispatch(CommonActions.reset({ index: 1, routes: [{ name: 'my_work' }, { name: 'inbox_home', params: { from: 'my_work' } }] }));
      } else nav.reset({ screen: 'inbox_home' });
    };
    // The push names only its Inbox row; the row says what it is about, and that opens (design principle 11).
    return onNotificationOpened((id) => {
      void findNotification(actorId, id).then(async (row) => {
        const to = row ? notificationTarget(row) : null;
        if (to && to.orgId !== thisOrg) await openOrganization(to.orgId, openAfterSwitch(to));
        else if (to?.kind === 'passage') openTask(to.languageId, to.unitId);
        else inbox();
      }).catch((e: unknown) => { noteExpected('open pushed notification', e); inbox(); });
    });
  }, [signedIn, nav.reset, homeIsWork, openTask, openOrganization, thisOrg, actorId]);
}
