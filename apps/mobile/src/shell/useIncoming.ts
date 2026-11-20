import { CommonActions } from '@react-navigation/native';
import { useCallback, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { forgetKeyInAddress } from '../web/appUrl';
import type { Ctx } from './ctx';
import { nextStep } from '../invites/heldInvite';
import { parseKey } from '../invites/inviteCode';
import { holdJoinCode } from '../invites/heldJoinCode';
import { dispatchMove, navRef, type Nav } from './nav';
import { joinLinkRoute } from './routingModel';
import { findNotification } from '../notifications/notifications';
import { notificationTarget, openAfterSwitch } from '../notifications/notificationTarget';
import { onNotificationOpened } from '../notifications/push';
import { noteExpected } from '../diagnostics/report';
import type { InviteHandle } from '../invites/useHeldInvite';
import { receiveHandedFile } from '../nearby/handedFile';
import { useHandedFile } from '../nearby/useHandedFile';
import { useGiveJoinFinder } from '../nearby/useGiveJoinFinder';

let initialLinkRead = false;

/**
 * What arrives from outside the screens: a link that opens the app (a scan,
 * docs/invites-and-accounts.md flow D, or a Forgot password email, flow G),
 * an invite nobody has claimed yet, an invite that will never work, a
 * tapped push, the install file a carrier's browser hands over with its
 * Open (docs/nearby-sync-plan.md 14.4), for Download the install file, and
 * the join link a newly installed phone finds on Give the app's Wi-Fi (14.5).
 */
export function useIncoming(o: {
  nav: Nav; invite: InviteHandle; signedIn: boolean; guest: boolean; onboardingLoaded: boolean; actorId: string; orgId: string; homeIsWork: boolean;
  toast: (message: string) => void; openTask: (languageId: string, unitId: string) => void; openOrganization: Ctx['openOrganization'];
}) {
  const { nav, invite, signedIn, onboardingLoaded, actorId, toast, homeIsWork, openTask, openOrganization, orgId: thisOrg } = o;
  const resetNav = nav.reset;
  const scanInvite = invite.scan;
  const guest = useRef(o.guest);
  guest.current = o.guest;
  const receive = useCallback((url: string, held?: { freshMs: number }) => {
    // The install file the browser downloaded for the app: held for Download the install file.
    if (receiveHandedFile(url)) return;
    const key = parseKey(url);
    if (!key) return;
    forgetKeyInAddress();
    if (key.kind === 'signin') { resetNav({ screen: 'scan_qr', params: { code: url } }); return; }
    // A Forgot password link (flow G): choose the new password, signed in or not.
    if (key.kind === 'reset') { resetNav({ screen: 'new_password', params: { code: key.code } }); return; }
    // A teammate's Let someone in code (docs/nearby-sync-plan.md 14.1, 3): never an invite, which the scan screen
    // would refuse a new person offline. It is held for joining their phone, which a phone with nobody on it opens.
    if (key.kind === 'join') { holdJoinCode(key, Date.now(), held?.freshMs); resetNav(joinLinkRoute(!guest.current, url)); return; }
    void scanInvite(key).then(() => resetNav({ screen: 'scan_qr' }));
  }, [resetNav, scanInvite]);
  useEffect(() => {
    if (!initialLinkRead) {
      initialLinkRead = true;
      void Linking.getInitialURL().then((url) => { if (url) receive(url); });
    }
    const listener = Linking.addEventListener('url', ({ url }) => receive(url));
    return () => listener.remove();
  }, [receive]);
  // A file the browser handed over opens Download the install file, which takes it (Android only).
  useHandedFile({ nav, signedIn });
  // A phone that just installed from Give the app finds the carrier's join link on its Wi-Fi, and opens it as a scanned one (Android only).
  useGiveJoinFinder({ nav, guest: o.guest, open: receive });
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
        dispatchMove(CommonActions.reset({ index: 1, routes: [{ name: 'my_work' }, { name: 'inbox_home', params: { from: 'my_work' } }] }));
      } else resetNav({ screen: 'inbox_home' });
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
  }, [signedIn, resetNav, homeIsWork, openTask, openOrganization, thisOrg, actorId]);
}
