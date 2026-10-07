// Getting in and having no organization yet. Ports the demo's
// src/screens/entry.tsx (SignInScreen, TermsPrivacyScreen, VisionScreen,
// ExploreHomeScreen, ScanQrScreen) and the no-org half of
// src/screens/onboarding.tsx (IntentChooserScreen, CreateAccountScreen,
// CreateOrgScreen, RequestAccessScreen).
// Requirements AUTH-1..6, ONB-2, ONB-6 (creating an organization), NAV-2.
// ADR-022 (terms are a line under Sign In; three Vision cards), ADR-023
// (creating an org is celebrated), ADR-028 (the invite says who it is for;
// here only what the phone knows, since a link's claims are unchecked).
import { CommandError, DEFAULT_LICENSE, isLicense, LICENSE_INFO, type License } from '@langquest-next/core';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  cachedListedOrganizations, cachedPublicLanguages, listedOrganizations, publicLanguages, queueAccountAction, TERMS_VERSION,
  type ListedOrganization
} from '../accountData';
import { firstName, VISION_STEPS } from '../accountText';
import { isSignInName, signInAddress, signInName } from '../accounts';
import { recordHelp } from '../signInHelp';
import { deadMessage, inviteCard, type DeadReason, type InvitePreview } from '../heldInvite';
import { parseKey } from '../inviteCode';
import type { Ctx } from '../ctx';
import { DEV_PASSWORD, ensurePersonaAccount, personasAvailable } from '../dev';
import { previewInvite, redeemSignInCode, useRequestOutcome } from '../invites';
import {
  Badge, Banner, Card, EmptyState, Field, GhostBtn, Group, Header, Ico, LinkBtn, OrDivider, PrimaryBtn, ProgressBar, Screen, SectionLabel,
  Segments, ShowMore, SmallBtn, txt, type IconName
} from '../kit';
import { PRIVACY_URL } from '../legal';
import { LicenseRow, LicenseSheet } from '../licenseSheet';
import { noteExpected, reportError, failureMessage } from '../report';
import { createOrganization } from '../createOrg';
import { contractsFor } from '../screenContracts';
import { FORGETS_ON_SIGN_OUT, forgetThisBrowser } from '../forgetBrowser';
import { supabase } from '../supabase';
import { lift } from '../shadow';
import { C, radius, space, tile, type as T, withAlpha } from '../theme';
import { useAccountActions, useDisplayNames } from '../useAccount';

/**
 * What to say when something fails (error-tracking): a command's own reason,
 * or, for a fault, a code a tester can read out, having reported it.
 */
const failure = failureMessage;

// ---- Sign In (AUTH-1) ----------------------------------------------------------------------

/**
 * Email and password; accepting the terms is the line under Sign In, with the
 * terms one tap away (ADR-022). Where to go afterwards is App's routing: a
 * first sign-in gets the welcome.
 */
export function SignIn(ctx: Ctx) {
  const [email, setEmail] = useState(ctx.isDev ? (process.env.EXPO_PUBLIC_DEV_EMAIL ?? '') : '');
  const [password, setPassword] = useState(ctx.isDev ? (process.env.EXPO_PUBLIC_DEV_PASSWORD ?? '') : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError('');
    try {
      // One field: an email, or a looked-after account's sign-in name (accounts.ts).
      let { data, error } = await supabase.auth.signInWithPassword({ email: signInAddress(email), password });
      // Dev on a local server: `npm run db:test` wipes auth users. Recreate
      // the dev account instead of stranding the developer at sign-in.
      if (error && ctx.isDev && personasAvailable().ok && email.trim() === process.env.EXPO_PUBLIC_DEV_EMAIL && password === DEV_PASSWORD) {
        await ensurePersonaAccount({ id: 'dev', email: email.trim() });
        ({ data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }));
      }
      // A wrong password or no connection: the server's words are the answer.
      if (error) { noteExpected('sign in', error); setError(error.message); return; }
      // Signing in accepts the terms (AUTH-1). The session this screen was
      // given belongs to the guest, so record it for the account that just
      // signed in; the account outbox delivers (and retries) it once the new
      // session is up.
      if (data.user) await recordTerms(data.user.id);
    } catch (e) {
      setError(failure('sign in', e));
    } finally {
      setBusy(false);
    }
  }

  /** Queue the terms for this account; a failure to queue is a fault, reported, never a reason to block sign-in. */
  async function recordTerms(userId: string) {
    try {
      await ctx.acceptTerms(userId);
    } catch (e) {
      ctx.toast(failure('accept terms', e));
    }
  }

  const ready = (email.trim().includes('@') || isSignInName(email)) && password.length > 0;
  const joining = ctx.invite.held?.claim.kind === 'next-account';
  return (
    <Screen bodyStyle={styles.signInBody}>
      <View style={styles.brand}>
        <View style={styles.logo}><Ico name="book" size={32} color={C.white} /></View>
        <Text style={styles.wordmark} accessibilityRole="header">LangQuest</Text>
        <Text style={[txt.smMuted, { textAlign: 'center' }]}>Coordinating Bible translation — draft to approval</Text>
      </View>
      {joining ? <Banner icon="people" title="Sign in to join" body="Your invite is saved. You'll join as soon as you sign in." /> : null}
      {/* Two ways in that never combine (the demo's ADR-031): the fields, or a code. */}
      <Card>
        <Field value={email} onChangeText={setEmail} placeholder="Email or sign-in name" keyboardType="email-address" autoCapitalize="none" />
        <Field value={password} onChangeText={setPassword} placeholder="Password" secure autoCapitalize="none" />
        {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
        <PrimaryBtn label={busy ? 'Signing in…' : 'Sign In'} onPress={() => void signIn()} disabled={!ready || busy} />
        <Pressable onPress={() => ctx.go('terms_privacy')} accessibilityRole="link" style={({ pressed }) => [styles.termsLine, pressed && { opacity: 0.7 }]}>
          <Text style={[txt.xs, { textAlign: 'center' }]}>
            By signing in you accept the <Text style={styles.termsLink}>Terms of Use and Privacy Policy</Text>
          </Text>
        </Pressable>
      </Card>
      <OrDivider />
      <GhostBtn label="Scan a code" icon="qr" onPress={() => ctx.go('scan_qr')} />
      <Text style={[txt.xs, { textAlign: 'center' }]}>An invite, or a code from someone helping you sign in</Text>
      <View style={styles.inline}>
        <Text style={txt.smMuted}>Don't have an account?</Text>
        <LinkBtn label="Create Account" onPress={() => ctx.go('create_account')} />
      </View>
      <GhostBtn label="Browse public work" icon="globe" onPress={() => ctx.go('explore_home')} />
      {ctx.canSwitchPersona ? (
        <LinkBtn label="Switch persona" color={C.muted} onPress={ctx.openDev} style={{ alignSelf: 'center' }} />
      ) : null}
    </Screen>
  );
}

// ---- Terms & Privacy (AUTH-1) ----------------------------------------------------------------

/**
 * What is not allowed, as the terms list it. Google Play asks that terms
 * forbid objectionable content and are accepted before anyone posts
 * (decisions.md 48); signing in accepts them (TERMS_VERSION).
 */
const NOT_ALLOWED = [
  'Hate: attacking people for their ethnicity, nationality, religion, disability, sex, gender or sexual orientation.',
  'Harassment, bullying, threats or intimidation.',
  'Sexual content or nudity. Anything sexual involving a child is never allowed, and we report it to the authorities.',
  'Content that encourages violence, self-harm or terrorism.',
  'Anything illegal, or that uses someone else\'s work without the right to.',
  'Someone else\'s private information, such as their address or phone number, without their permission.',
  'Pretending to be someone else.',
  'Spam, advertising, or anything unrelated to translation work.',
  'Trying to break into LangQuest or another person\'s account, or harm the service.'
];

/** A page to read; accepting is the line under Sign In (ADR-022). */
export function TermsPrivacy(ctx: Ctx) {
  return (
    <Screen header={<Header title="Terms & Privacy" onBack={ctx.back} />}>
      <Card>
        <Text style={txt.h3}>Terms of Use</Text>
        <Text style={txt.xs}>Updated {TERMS_VERSION}</Text>
        <Text style={txt.bodyMuted}>
          LangQuest is for translation teams to record, review and organize their work. By creating an account or signing in, you agree to these terms. You must be 18 or older. Use your own account and keep your password private.
        </Text>
        <Text style={txt.bodyMuted}>
          What you record and write is part of your organization's work, shared under its license. Your organization's members can see it.
        </Text>
      </Card>
      <Card>
        <Text style={txt.h3}>Not allowed</Text>
        <Text style={txt.bodyMuted}>Do not record, write or share:</Text>
        {NOT_ALLOWED.map((rule) => (
          <View key={rule} style={styles.rule}>
            <Text style={txt.bodyMuted}>{'\u2022'}</Text>
            <Text style={[txt.bodyMuted, { flex: 1 }]}>{rule}</Text>
          </View>
        ))}
      </Card>
      <Card>
        <Text style={txt.h3}>Reporting and blocking</Text>
        <Text style={txt.bodyMuted}>
          Tap the flag on a note, recording or review to report it, or to report or block the person who made it. Blocking hides what they add, for you only, and they are not told. Your organization's admins and the LangQuest team see reports. We act on them within 24 hours.
        </Text>
        <Text style={txt.bodyMuted}>
          Content that breaks these terms is removed. People who break them may be removed from their organization, and their account suspended or deleted. Questions or reports by email: admin@frontierrnd.com.
        </Text>
      </Card>
      <Card>
        <Text style={txt.h3}>Privacy Policy</Text>
        <Text style={txt.bodyMuted}>
          LangQuest keeps your email, your name and the work you do, so your team can work together, even offline. Your organization's members see your work; the public sees only what your organization chooses to share. No ads and no tracking. Speed and error reports can be turned off in Settings, and you can delete your account there. Recordings you made stay with your organization.
        </Text>
        <LinkBtn label="Read the full privacy policy" onPress={() => void Linking.openURL(PRIVACY_URL)} />
      </Card>
    </Screen>
  );
}

// ---- What is LangQuest? (ONB-2) ---------------------------------------------------------------

/**
 * Three cards of one sentence each, reached from the welcome or Settings;
 * Done goes back to whichever. No Listen button: there is no text-to-speech
 * here, and the real app will play prompts recorded in the team's language.
 */
export function Vision(ctx: Ctx) {
  const [step, setStep] = useState(0);
  const current = VISION_STEPS[step]!;
  const last = step === VISION_STEPS.length - 1;
  return (
    <Screen
      header={<Header title="What is LangQuest?" sub={`${step + 1} of ${VISION_STEPS.length}`} onBack={step === 0 ? ctx.back : () => setStep(step - 1)} />}
      footer={<PrimaryBtn label={last ? 'Done' : 'Next'} onPress={last ? ctx.back : () => setStep(step + 1)} />}
      bodyStyle={styles.visionBody}
    >
      <Segments total={VISION_STEPS.length} done={(i) => i < step} current={step} />
      <View style={styles.visionCard}>
        <View style={styles.visionIcon}><Ico name={current.icon} size={48} color={C.primary} /></View>
        <Text style={[txt.h2, { textAlign: 'center' }]} accessibilityRole="header">{current.title}</Text>
        <Text style={[txt.bodyMuted, { textAlign: 'center' }]}>{current.body}</Text>
      </View>
    </Screen>
  );
}

// ---- Explore (AUTH-6) --------------------------------------------------------------------

const EXPLORE_STEP = 25;

/**
 * A server list shown at once from what this device saved, then refreshed.
 * The message is what to say over it: loading, or that it could not refresh.
 */
function useRefreshed<T>(where: string, cached: () => Promise<T[]>, fresh: () => Promise<T[]>, enabled = true): [T[], string] {
  const [rows, setRows] = useState<T[]>([]);
  const [message, setMessage] = useState(enabled ? 'Loading…' : '');
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      const saved = await cached().catch((e: unknown) => { reportError(`${where} cache`, e); return []; });
      if (active) setRows(saved);
      try {
        const latest = await fresh();
        if (active) { setRows(latest); setMessage(''); }
      } catch (e) {
        // Offline or the server is away: expected, and said on screen.
        noteExpected(`${where} refresh`, e);
        if (active) setMessage('Unable to refresh. Showing what was saved on this device.');
      }
    })();
    return () => { active = false; };
    // The loaders are module functions; only whether to load can change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return [rows, message];
}

/** Organizations that list their work publicly, without an account: name, languages, progress. */
export function ExploreHome(ctx: Ctx) {
  const [listed, message] = useRefreshed('explore', cachedPublicLanguages, publicLanguages);
  const [shown, setShown] = useState(EXPLORE_STEP);
  const guest = ctx.session.isGuest;
  return (
    <Screen header={<Header title="Explore" onBack={ctx.back}
      action={guest ? <SmallBtn label="Sign In" tone="primary" onPress={() => ctx.go('sign_in')} /> : undefined} />}>
      {message ? <Banner icon="cloud" title={message} /> : null}
      {listed.length ? <SectionLabel label="Listed publicly" /> : null}
      {listed.slice(0, shown).map((p) => {
        const pct = Math.round(p.translated_pct);
        // A license this build does not know yet is simply not shown.
        const license = isLicense(p.license) ? LICENSE_INFO[p.license] : null;
        return (
          <Card key={`${p.org_id}:${p.language_id}`} accessibilityLabel={`${p.name}, ${pct}%`}
            onPress={guest ? () => ctx.go('sign_in') : () => ctx.go('request_access', { orgId: p.org_id, orgName: p.name })}>
            <View style={{ gap: 2 }}>
              <Text style={txt.h3}>{p.name}</Text>
              {p.code ? <Text style={txt.smMuted}>{p.code}</Text> : null}
            </View>
            {license ? <View style={{ flexDirection: 'row' }}><Badge label={`${license.name} · ${license.short}`} tone={license.terms.outsidersMayView ? 'green' : 'default'} /></View> : null}
            <ProgressBar value={pct} />
            <View style={styles.between}>
              <Text style={txt.xs}>Recorded</Text>
              <Text style={[txt.xsStrong, { color: C.primary }]}>{pct}%</Text>
            </View>
          </Card>
        );
      })}
      <ShowMore remaining={listed.length - shown} step={EXPLORE_STEP} onMore={() => setShown(shown + EXPLORE_STEP)} />
      {!listed.length && !message ? <EmptyState icon="globe" title="Nothing listed yet" sub="Organizations appear here when they list their work publicly." /> : null}
    </Screen>
  );
}

// ---- Create Account (AUTH-2) ------------------------------------------------------------------------

export function CreateAccount(ctx: Ctx) {
  // Joining by invite as a new person, when the invite needs a name (a group invite).
  if (ctx.params['as'] === 'new') return <NewPerson {...ctx} />;
  return <EmailAccount {...ctx} />;
}

/**
 * A new person joining by an invite that does not name them (a group invite,
 * or an older one): their name, and nothing else. No email, no password: the
 * invite makes the account and the phone stays signed in (decisions.md 59).
 */
function NewPerson(ctx: Ctx) {
  const [name, setName] = useState(ctx.params['name'] ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setError('');
    // Joining accepts the terms, as creating an account does (AUTH-1).
    const refused = await ctx.invite.joinAsNew(name.trim(), (id) => ctx.acceptTerms(id));
    // Signed in: the session starts the app over as this account.
    if (refused) { setError(refused.message); setBusy(false); }
  }

  return (
    <Screen
      header={<Header title="Join with your invite" onBack={ctx.back} />}
      footer={<PrimaryBtn label={busy ? 'Joining…' : 'Join'} icon="check" onPress={() => void join()} disabled={!name.trim() || busy} />}
    >
      <Text style={txt.bodyMuted}>
        No email or password needed. Your team sees you by this name.
      </Text>
      <Field label="Your name" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
      <Pressable onPress={() => ctx.go('terms_privacy')} accessibilityRole="link" style={({ pressed }) => [styles.termsLine, pressed && { opacity: 0.7 }]}>
        <Text style={[txt.xs, { textAlign: 'center' }]}>
          Joining accepts the <Text style={styles.termsLink}>Terms of Use and Privacy Policy</Text>
        </Text>
      </Pressable>
    </Screen>
  );
}

/**
 * An account with an email, or an invite instead: two doors that never
 * combine (the demo's ADR-031). The fields and their button come first, then
 * "or", then the scanner. Scanning takes nothing typed above it.
 */
function EmailAccount(ctx: Ctx) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const emailOk = email.trim().includes('@');
  const matches = password.length >= 6 && password === confirm;

  async function create() {
    setBusy(true);
    setError('');
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) { noteExpected('sign up', error); setError(error.message); return; }
      // Creating the account accepts the terms (AUTH-1). With a session they
      // are recorded now (the account outbox retries until delivered) and the
      // app routes on by itself; without one the address has to be confirmed
      // first, and signing in records them.
      if (data.session && data.user) {
        try {
          await ctx.acceptTerms(data.user.id);
        } catch (e) {
          ctx.toast(failure('accept terms', e));
        }
      } else {
        setCheckEmail(true);
      }
    } catch (e) {
      setError(failure('sign up', e));
    } finally {
      setBusy(false);
    }
  }

  if (checkEmail) {
    return (
      <Screen header={<Header title="Create Account" onBack={ctx.back} />}>
        <EmptyState icon="check" title="Account created" sub={`Open the link we sent to ${email.trim()}, then sign in. You can create an organization, ask to join one, or scan an invite when you are ready.`} />
      </Screen>
    );
  }

  return (
    <Screen header={<Header title="Create Account" onBack={ctx.back} />}>
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
      <Field label="Password" value={password} onChangeText={setPassword} placeholder="Choose a password (6 or more characters)" secure autoCapitalize="none" />
      <Field label="Confirm password" value={confirm} onChangeText={setConfirm} placeholder="Re-enter password" secure autoCapitalize="none" />
      {confirm.length > 0 && password !== confirm ? <Text style={txt.error}>Passwords do not match.</Text> : null}
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
      <PrimaryBtn label={busy ? 'Creating…' : 'Create Account'} onPress={() => void create()} disabled={!emailOk || !matches || busy} />
      <Pressable onPress={() => ctx.go('terms_privacy')} accessibilityRole="link" style={({ pressed }) => [styles.termsLine, pressed && { opacity: 0.7 }]}>
        <Text style={[txt.xs, { textAlign: 'center' }]}>
          Creating an account accepts the <Text style={styles.termsLink}>Terms of Use and Privacy Policy</Text>
        </Text>
      </Pressable>
      <OrDivider />
      <GhostBtn label="Scan an invite" icon="qr" onPress={() => ctx.go('scan_qr')} />
      <Text style={[txt.xs, { textAlign: 'center' }]}>No email or password needed. The invite makes your account and puts you on the team.</Text>
    </Screen>
  );
}

// ---- Scan QR (AUTH-3, ADR-028) -------------------------------------------------------------------------

/**
 * The one scanner (docs/invites-and-accounts.md). It reads both kinds of
 * key: an invite, which it holds and then asks who is joining, and a helper's
 * sign-in key, which signs the person straight in (decisions.md 59). It never
 * remembers an invite itself: the held invite (ctx.invite) survives this
 * screen, sign-up and restarts. What the card says comes from the server's
 * preview only. On a phone the camera starts by itself.
 */
export function ScanQr(ctx: Ctx) {
  const { invite } = ctx;
  const [signinCode, setSigninCode] = useState<string | null>(() => {
    const k = parseKey(ctx.params['code'] ?? '');
    return k?.kind === 'signin' ? k.code : null;
  });
  const [text, setText] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const scanned = useRef(false);
  const autoStarted = useRef(false);
  const [error, setError] = useState('');
  const guest = ctx.session.isGuest;
  const held = invite.held ?? null;

  // What the server says about the held key; null when it cannot be asked.
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  useEffect(() => {
    let active = true;
    setPreview(null);
    if (!held) return;
    void previewInvite(held.token).then((p) => { if (active) setPreview(p); });
    return () => { active = false; };
  }, [held?.token, invite.status.kind]);
  // Hold the invite as long as it lasts, now the server has said.
  const { learn } = invite;
  useEffect(() => { void learn(preview); }, [preview, learn]);

  // Nothing read yet: open the camera, so pointing it is the only step.
  useEffect(() => {
    if (autoStarted.current || Platform.OS === 'web' || !permission || held || signinCode) return;
    autoStarted.current = true;
    if (permission.granted) { setScanning(true); return; }
    if (permission.canAskAgain) void requestPermission().then((r) => { if (r.granted) setScanning(true); });
  }, [permission, held, signinCode, requestPermission]);

  async function read(value: string) {
    const key = parseKey(value);
    if (!key) { setError('This is not a LangQuest code.'); return false; }
    setError('');
    if (key.kind === 'signin') { setSigninCode(key.code); return true; }
    setSigninCode(null);
    await invite.scan(key);
    return true;
  }

  function toggleCamera() {
    if (scanning) { setScanning(false); return; }
    void (async () => {
      const result = permission?.granted ? permission : await requestPermission();
      if (result.granted) { scanned.current = false; setError(''); setScanning(true); }
      else setError('Camera access is off. You can paste the code below.');
    })();
  }

  const card = inviteCard(preview);
  const dead = invite.status.kind === 'dead' ? invite.status.message
    : preview && ['expired', 'used', 'not_found', 'retired'].includes(preview.status)
      ? deadMessage(preview.status as DeadReason, preview.invitedBy) : null;
  const alreadyIn = preview?.status === 'joined';
  const claimedHere = held?.claim.kind === 'next-account';
  const me = useDisplayNames(ctx.session.actorId)[ctx.session.actorId]
    ?? signInName(ctx.session.email) ?? ctx.session.email?.split('@')[0] ?? 'you';
  // A one-person invite names who it is for: they join with one tap. Any
  // other (a group, or no name on it) asks their name first.
  const named = preview?.status === 'ok' && preview.label && !preview.group ? preview.label : null;
  const joining = invite.status.kind === 'joining';

  async function joinNamed() {
    setError('');
    const refused = await invite.joinAsNew(undefined, (id) => ctx.acceptTerms(id));
    if (!refused) return; // signed in: the session starts the app over as this account
    if (refused.needsName) ctx.go('create_account', { as: 'new', name: '' });
    else setError(refused.message);
  }

  let footer: ReactNode = null;
  if (signinCode) footer = null;
  else if (held && !dead && !alreadyIn) {
    footer = guest ? (
      <>
        {named ? (
          <PrimaryBtn label={joining ? 'Joining…' : `Join as ${firstName(named) || named}`} icon="check" busy={joining} disabled={joining}
            onPress={() => void joinNamed()} />
        ) : (
          <PrimaryBtn label="Join" icon="check" disabled={joining}
            // A group invite's label names the group, not the person: they type their own name
            // (an empty name, so no earlier visit's name carries over).
            onPress={() => ctx.go('create_account', { as: 'new', name: '' })} />
        )}
        <GhostBtn label="I already have an account" disabled={joining} onPress={() => void invite.choose('next-account').then(() => ctx.go('sign_in'))} />
      </>
    ) : (
      <>
        <PrimaryBtn label={joining ? 'Joining…' : `Join as ${me}`} icon="check"
          busy={joining} disabled={invite.status.kind !== 'idle' && invite.status.kind !== 'dead'}
          onPress={() => void invite.choose('me')} />
        <GhostBtn label={`Not ${me}? Sign out first`} onPress={() => ctx.go('sign_out_confirm')} />
      </>
    );
  }

  return (
    <Screen
      header={<Header title="Scan a code" sub={signinCode ? 'A code from someone helping you sign in' : guest ? 'No email or password needed' : 'Invite includes organization, role, and scope'} onBack={ctx.back} />}
      footer={footer}
    >
      {signinCode ? <SignInKey ctx={ctx} code={signinCode} onCancel={() => setSigninCode(null)} /> : (
        <>
          <View style={styles.viewfinder}>
            {scanning && permission?.granted ? (
              <CameraView style={StyleSheet.absoluteFill} facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => {
                  if (scanned.current) return;
                  if (!parseKey(data)) { setError('This QR code is not a LangQuest code.'); return; }
                  scanned.current = true;
                  setScanning(false);
                  void read(data);
                }} />
            ) : (
              <Ico name={held ? 'check' : 'qr'} size={72} color={held ? C.green : C.faint} />
            )}
            {(['tl', 'tr', 'bl', 'br'] as const).map((k) => (
              <View key={k} style={[{ pointerEvents: 'none' }, styles.corner, {
                borderColor: held ? C.soft : C.white,
                ...(k[0] === 't' ? { top: 16, borderTopWidth: 3 } : { bottom: 16, borderBottomWidth: 3 }),
                ...(k[1] === 'l' ? { left: 16, borderLeftWidth: 3 } : { right: 16, borderRightWidth: 3 })
              }]} />
            ))}
            <Text style={styles.viewfinderHint}>
              {scanning ? 'Point the camera at the code' : held ? 'Code read' : 'Tap Scan to use the camera'}
            </Text>
          </View>
          {held ? (
            <Card>
              <View style={styles.optionRow}>
                <View style={styles.tile}><Ico name="people" size={24} color={C.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[txt.body, { fontWeight: '700' }]}>{card.title}</Text>
                  {card.detail ? <Text style={txt.smMuted}>{card.detail}</Text> : null}
                  {card.from ? <Text style={txt.xs}>From {card.from}</Text> : null}
                  {!preview ? <Text style={txt.xs}>Your role shows once you're connected.</Text> : null}
                </View>
              </View>
            </Card>
          ) : null}
          {dead ? <Banner icon="flag" tone="amber" title="This invite can't be used" body={dead} /> : null}
          {alreadyIn ? <Banner icon="check" tone="green" title="You're already in" body="This invite was used by this account." /> : null}
          {invite.status.kind === 'waiting' ? (
            <Banner icon="cloud" title="Saved on this device" body="You'll join as soon as there's a connection. You can leave this screen." />
          ) : null}
          {guest && claimedHere && !joining ? (
            <Text style={txt.xs}>Saved on this device: you'll join as soon as you sign in.</Text>
          ) : null}
          {guest && held && !dead && !alreadyIn ? (
            <Pressable onPress={() => ctx.go('terms_privacy')} accessibilityRole="link" style={({ pressed }) => [styles.termsLine, pressed && { opacity: 0.7 }]}>
              <Text style={[txt.xs, { textAlign: 'center' }]}>
                Joining accepts the <Text style={styles.termsLink}>Terms of Use and Privacy Policy</Text>
              </Text>
            </Pressable>
          ) : null}
          <GhostBtn label={scanning ? 'Stop camera' : held ? 'Scan a different code' : 'Scan QR code'} icon="camera" onPress={toggleCamera} />
          <Field label="Or paste the code or link" value={text} autoCapitalize="none" placeholder="Invite or sign-in code"
            onChangeText={(v) => { setText(v); setError(''); if (parseKey(v)) void read(v).then((ok) => { if (ok) setText(''); }); }} />
          {held && (dead || alreadyIn) ? <LinkBtn label="Clear this invite" color={C.muted} onPress={() => void invite.drop()} style={{ alignSelf: 'center' }} /> : null}
          {held && !dead && !alreadyIn && !guest ? <LinkBtn label="Not now" color={C.muted} onPress={() => void invite.drop().then(ctx.home)} style={{ alignSelf: 'center' }} /> : null}
          {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
        </>
      )}
    </Screen>
  );
}

/**
 * A helper's sign-in key (flow F, decisions.md 59): it signs the person
 * straight in, with nothing to type, and Settings later says who helped.
 * Only for someone signed out; a signed-in phone would otherwise hand its
 * own session over by surprise.
 */
function SignInKey(props: { ctx: Ctx; code: string; onCancel: () => void }) {
  const { ctx } = props;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!ctx.session.isGuest) {
    return (
      <>
        <Banner icon="lock" title="This is a sign-in code" body="It is for someone signed out. Sign out first, then scan it again." />
        <LinkBtn label="Scan something else" onPress={props.onCancel} style={{ alignSelf: 'center' }} />
      </>
    );
  }
  async function go() {
    setBusy(true);
    setError('');
    try {
      const help = await redeemSignInCode(props.code);
      const { data, error } = await supabase.auth.setSession(help.session);
      if (error) { noteExpected('sign in with code', error); setError(error.message); return; }
      if (data.user) {
        await recordHelp(data.user.id, help.helper).catch((e: unknown) => { reportError('record sign-in help', e); });
        await ctx.acceptTerms(data.user.id).catch((e: unknown) => { reportError('accept terms', e); });
      }
      ctx.toast(help.oldPhoneSignedOut ? 'Signed in. Your old device is signed out.'
        : help.helper ? `Signed in with ${help.helper}'s help` : 'Signed in');
    } catch (e) {
      noteExpected('sign-in code', e);
      setError(e instanceof Error ? e.message : 'Try again when connected.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Banner icon="lock" title="Someone is helping you sign in" body="Nothing to type: this signs you in on this device, with all your work." />
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
      <PrimaryBtn label={busy ? 'Signing in…' : 'Sign in'} icon="check" busy={busy} disabled={busy} onPress={() => void go()} />
      <LinkBtn label="Cancel" color={C.muted} onPress={props.onCancel} style={{ alignSelf: 'center' }} />
    </>
  );
}

// ---- What brings you here? (AUTH-4, AUTH-5) ---------------------------------------------------------

const INTENTS: { to: 'create_org' | 'request_access' | 'scan_qr' | 'explore_home'; icon: IconName; label: string; sub: string }[] = [
  { to: 'create_org', icon: 'building', label: 'Create an organization', sub: 'Start a new translation org' },
  { to: 'request_access', icon: 'people', label: 'Join an existing org', sub: 'Accept an invitation or request access' },
  { to: 'scan_qr', icon: 'qr', label: 'Join with QR code', sub: 'Scan an invite — keeps your email and name' },
  { to: 'explore_home', icon: 'globe', label: 'Explore', sub: 'Browse translation work listed publicly' }
];

/**
 * Someone with no organization lands here (NAV-2). After asking to join
 * one, it says who they are waiting for (AUTH-5) and keeps the other ways
 * in underneath.
 */
export function IntentChooser(ctx: Ctx) {
  const actions = useAccountActions(ctx.session.actorId);
  const waiting = actions.filter((a) => a.kind === 'join_request' && a.status !== 'failed').at(-1);
  // The name Explore knew, else a neutral phrase: never the org's id.
  const waitingFor = waiting && typeof waiting.payload.orgName === 'string' ? waiting.payload.orgName : 'the organization';
  const [error, setError] = useState('');
  // Once the server has it, watch for the answer: admitted opens the
  // organization; turned away says so (useRequestOutcome).
  const sentTo = waiting?.status === 'sent' && typeof waiting.payload.orgId === 'string'
    ? { id: waiting.id, orgId: waiting.payload.orgId } : null;
  const outcome = useRequestOutcome(ctx.session.actorId, sentTo);
  const joinedOrg = outcome.kind === 'joined' ? outcome.orgId : null;
  const declined = outcome.kind === 'declined';
  useEffect(() => {
    if (!joinedOrg) return;
    ctx.openOrganization(joinedOrg).catch((e: unknown) => setError(failureMessage('open joined organization', e)));
  }, [joinedOrg]);
  // A browser forgets everything at sign-out (forgetBrowser.ts), so there it
  // waits, as Sign Out does, for an account change still to send.
  const queued = actions.filter((a) => a.status === 'queued').length;
  async function signOut() {
    if (FORGETS_ON_SIGN_OUT && queued > 0) {
      setError(`Still to send: ${queued === 1 ? 'an account change' : `${queued} account changes`}. Sign out once you are back online and they have gone.`);
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) { setError(error.message); return; }
    await forgetThisBrowser();
  }
  return (
    <Screen header={<Header title={waiting && !declined ? 'Request sent' : 'What brings you here?'} />}>
      {/* An invite being used right now, or waiting for a connection (docs/invites-and-accounts.md). */}
      {ctx.invite.status.kind === 'joining' ? <Banner icon="people" title="Joining with your invite…" /> : null}
      {ctx.invite.status.kind === 'waiting' ? (
        <Banner icon="cloud" title="Your invite is saved" body="You'll join as soon as there's a connection." />
      ) : null}
      {ctx.invite.status.kind === 'dead' ? <Banner icon="flag" tone="amber" title="Your invite couldn't be used" body={ctx.invite.status.message} /> : null}
      {waiting ? (
        <>
          <View style={styles.waiting}>
            <View style={styles.optionRow}>
              <View style={[styles.tile, { borderRadius: 22 }]}><Ico name={declined ? 'flag' : 'clock'} size={22} color={C.primary} /></View>
              <Text style={[txt.body, { fontWeight: '700', flex: 1 }]}>{declined ? `${waitingFor} didn't add you` : `Waiting for ${waitingFor}`}</Text>
            </View>
            <Text style={txt.body}>
              {declined
                ? 'An admin there turned down your request. You can ask again below, or ask someone there for an invite.'
                : waiting.status === 'sent'
                  ? "An admin will give you a role. Once they do, you'll be taken to your work."
                  : 'Your request is saved on this device and sends when you have a connection.'}
            </Text>
            {declined ? null : <Text style={txt.smMuted}>There's nothing else you need to do.</Text>}
          </View>
          <SectionLabel label="Meanwhile" />
        </>
      ) : null}
      {INTENTS.map((o) => (
        <Card key={o.to} onPress={() => ctx.go(o.to)} accessibilityLabel={o.label}>
          <View style={styles.optionRow}>
            <View style={styles.tile}><Ico name={o.icon} size={24} color={C.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[txt.body, { fontWeight: '600' }]}>{o.label}</Text>
              <Text style={txt.smMuted}>{o.sub}</Text>
            </View>
            <Ico name="right" size={22} color={C.muted} />
          </View>
        </Card>
      ))}
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
      {!ctx.session.isGuest ? (
        <>
          <LinkBtn label="Sign out" color={C.muted} onPress={() => void signOut()} style={{ alignSelf: 'center' }} />
          <LinkBtn label="Delete account" color={C.muted} onPress={() => ctx.go('delete_account')} style={{ alignSelf: 'center' }} />
        </>
      ) : null}
    </Screen>
  );
}

// ---- Create Organization (ONB-6, ADR-023) ----------------------------------------------------------------

/**
 * Creating an organization starts a new one under a fresh id
 * (`createOrganization`): the org, the seed roles with their privilege sets,
 * you as Organization Admin at org scope, and its license. Its languages,
 * each with how its passages get checked (decision 63), are added next
 * from My Work's Getting started (ONB-5), so nothing here is sample content.
 */
export function CreateOrg(ctx: Ctx) {
  const [name, setName] = useState('');
  const names = useDisplayNames(ctx.session.actorId);
  // Closed until the creator chooses otherwise; it can only open later (docs/licensing.md).
  const [license, setLicense] = useState<License>(DEFAULT_LICENSE);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function create() {
    const orgName = name.trim();
    if (!orgName) return;
    setBusy(true);
    setError('');
    try {
      const orgId = await createOrganization({ actorId: ctx.session.actorId, name: orgName, license });
      // Members see the creator by their profile name; give them one if they
      // have none yet, from their email, as the log used to (decisions.md 47).
      if (!names[ctx.session.actorId] && ctx.session.email) {
        await queueAccountAction(ctx.session.actorId, 'profile', { displayName: ctx.session.email.split('@')[0]! })
          .catch((e: unknown) => { reportError('create org profile', e); });
      }
      // The creator needs no "who invited you" welcome; My Work's Getting
      // started is their first day (ADR-022).
      // The org exists by now, so a failure here is reported, not shown as
      // "not created"; the worst case is seeing the welcome once more.
      await ctx.markWelcomed().catch((e: unknown) => { reportError('create org welcomed', e); });
      ctx.toast(`${orgName} is ready to grow. Next, add your first language and invite your team.`);
      // Opening it replaces this screen with the new organization's home.
      await ctx.openOrganization(orgId);
    } catch (e) {
      setError(failure('create org', e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      header={<Header title="Create Organization" onBack={ctx.back} />}
      footer={<PrimaryBtn label={busy ? 'Creating…' : 'Create Organization'} onPress={() => void create()} disabled={!name.trim() || busy} />}
    >
      <View style={styles.hero}>
        <View style={[styles.tile, styles.heroTile]}><Ico name="building" size={32} color={C.primary} /></View>
        <Text style={[txt.h2, { textAlign: 'center' }]}>Start your organization</Text>
        <Text style={[txt.bodyMuted, { textAlign: 'center' }]}>
          Your teams will record Scripture in their own languages and check it together. It starts with a name.
        </Text>
      </View>
      <Field label="What's it called?" value={name} onChangeText={setName} placeholder="Enter organization name" autoCapitalize="words" />
      <View>
        <SectionLabel label="Who may use your work" />
        <Group><LicenseRow license={license} onPress={() => setChoosing(true)} last /></Group>
      </View>
      <LicenseSheet visible={choosing} mode="choose" current={license} onClose={() => setChoosing(false)}
        onConfirm={(l) => { setLicense(l); setChoosing(false); }} />
      <Banner icon="sparkle" title="Ready to use"
        body="You'll get the usual roles and a standard way to check passages. Next, we'll add your first language and team together." />
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
    </Screen>
  );
}

// ---- Request Access (AUTH-5) -----------------------------------------------------------------------------

const FIND_FROM = 8;

/**
 * Ask an organization to let you in. The request is saved on this phone and
 * sent when there is a connection; until an admin accepts, you see nothing
 * of theirs. Explore names the organization; otherwise the person picks one
 * of those listing their work, as in the demo (decisions.md 66). One that
 * lists nothing is joined by invite.
 */
export function RequestAccess(ctx: Ctx) {
  const given = ctx.params['orgId'] ?? '';
  // The language this person found on Explore, which names who they are asking.
  const givenName = ctx.params['orgName'] || undefined;
  const [listed, loadMessage] = useRefreshed('request access', cachedListedOrganizations, listedOrganizations, !given);
  const [picked, setPicked] = useState<ListedOrganization | null>(null);
  const [find, setFind] = useState('');
  const [shown, setShown] = useState(EXPLORE_STEP);
  const [message, setMessage] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const actions = useAccountActions(ctx.session.actorId);
  const request = actions.find((a) => a.id === requestId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const orgId = given || picked?.org_id || '';
  const orgName = given ? givenName : picked?.name;
  const label = orgName ?? 'the organization';
  const query = find.trim().toLowerCase();
  const matches = query
    ? listed.filter((o) => o.name.toLowerCase().includes(query) || o.languages.some((l) => l.toLowerCase().includes(query)))
    : listed;

  async function send() {
    setBusy(true);
    setError('');
    try {
      setRequestId(await queueAccountAction(ctx.session.actorId, 'join_request', {
        orgId, message: message.trim(), ...(orgName ? { orgName } : {})
      }));
    } catch (e) {
      setError(failure('request access', e));
    } finally {
      setBusy(false);
    }
  }

  if (requestId) {
    const failed = request?.status === 'failed';
    return (
      <Screen
        header={<Header title="Request access" />}
        footer={failed ? <GhostBtn label="Back" onPress={() => ctx.go('intent_chooser')} /> : <PrimaryBtn label="Done" onPress={() => ctx.go('intent_chooser')} />}
      >
        <EmptyState icon={failed ? 'close' : 'check'}
          title={failed ? 'Request not sent' : `Waiting for ${label}`}
          sub={failed ? request?.error ?? 'The organization could not take the request.'
            : request?.status === 'sent' ? `Your request to join ${label} is on its way. An admin will review it.`
            : 'Saved on this device. It sends when you have a connection.'} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<Header title="Request access" onBack={ctx.back} />}
      footer={<PrimaryBtn label="Send request" icon="arrowR" onPress={() => void send()} disabled={orgId === ''} busy={busy} />}
    >
      <Text style={txt.bodyMuted}>Ask to join an existing organization. An admin will review your request.</Text>
      {given ? (
        <Card>
          <View style={styles.optionRow}>
            <View style={styles.tile}><Ico name="building" size={24} color={C.primary} /></View>
            <Text style={[txt.body, { fontWeight: '600', flex: 1 }]}>{label}</Text>
            <Ico name="check" size={22} color={C.primary} />
          </View>
        </Card>
      ) : (
        <View style={{ gap: space.sm }}>
          <SectionLabel label="Organization" />
          {loadMessage ? <Banner icon="cloud" title={loadMessage} /> : null}
          {listed.length > FIND_FROM ? (
            <Field value={find} onChangeText={(v) => { setFind(v); setShown(EXPLORE_STEP); }} placeholder="Find by organization or language" autoCapitalize="none" />
          ) : null}
          {matches.slice(0, shown).map((o) => {
            const chosen = picked?.org_id === o.org_id;
            return (
              <Card key={o.org_id} current={chosen} accessibilityLabel={`${o.name}, ${o.languages.join(', ')}`} onPress={() => setPicked(o)}>
                <View style={styles.optionRow}>
                  <View style={styles.tile}><Ico name="building" size={24} color={C.primary} /></View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[txt.body, { fontWeight: '600' }]}>{o.name}</Text>
                    <Text style={txt.smMuted} numberOfLines={2}>{o.languages.join(', ')}</Text>
                  </View>
                  {chosen ? <Ico name="check" size={22} color={C.primary} /> : null}
                </View>
              </Card>
            );
          })}
          <ShowMore remaining={matches.length - shown} step={EXPLORE_STEP} onMore={() => setShown(shown + EXPLORE_STEP)} />
          {listed.length && !matches.length ? <Text style={txt.smMuted}>No organization or language matches “{find.trim()}”.</Text> : null}
          {loadMessage === 'Loading…' ? null : (
            <Text style={txt.smMuted}>
              {listed.length ? 'Not listed? ' : 'No organizations are listed yet. '}Ask someone in the organization for an invite.
            </Text>
          )}
        </View>
      )}
      <Field label="Message" value={message} onChangeText={setMessage} placeholder="Why you want to join" multiline />
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rule: { flexDirection: 'row', gap: space.sm },
  signInBody: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.xl, gap: space.lg },
  brand: { alignItems: 'center', gap: space.sm, paddingBottom: space.sm },
  logo: { width: 64, height: 64, borderRadius: 24, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    ...lift({ color: C.primary, opacity: 0.25, radius: 12, y: 6, elevation: 4 }) },
  wordmark: { fontSize: T.display, fontWeight: '800', color: C.dark, letterSpacing: -0.5 },
  termsLine: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space.sm },
  termsLink: { fontWeight: '700', textDecorationLine: 'underline', color: C.muted },
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, flexWrap: 'wrap' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tile: { width: tile.md, height: tile.md, borderRadius: 16, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  visionBody: { flexGrow: 1 },
  visionCard: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingHorizontal: space.lg, paddingVertical: space.xxl },
  visionIcon: { width: 96, height: 96, borderRadius: 32, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  viewfinder: { height: 280, borderRadius: radius.sheet, backgroundColor: C.dark, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 32, height: 32 },
  viewfinderHint: { position: 'absolute', bottom: 18, left: 0, right: 0, textAlign: 'center', fontSize: T.xs, fontWeight: '600', color: withAlpha(C.white, 0.75) },
  waiting: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 1.5, borderColor: C.primary, padding: space.lg, gap: space.sm },
  hero: { alignItems: 'center', gap: space.md, paddingVertical: space.md },
  heroTile: { width: 64, height: 64, borderRadius: 24 }
});

export const contracts = contractsFor('sign_in', 'create_account', 'terms_privacy', 'vision', 'intent_chooser', 'create_org', 'explore_home', 'request_access', 'scan_qr');
