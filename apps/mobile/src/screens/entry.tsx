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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import {
  cachedListedOrganizations, cachedPublicLanguages, listedOrganizations, publicLanguages, queueAccountAction, TERMS_VERSION,
  type ListedOrganization
} from '../account/accountData';
import { authErrorText, firstName, outboxErrorText, signInCodeErrorText, VISION_STEPS } from '../account/accountText';
import { signInName } from '../auth/accounts';
import { licenseText } from '../i18n/coreText';
import { t, Trans } from '../i18n';
import { formatPercent } from '../i18n/format';
import { recordHelp } from '../auth/signInHelp';
import { inviteCard, scanVerdict } from '../invites/heldInvite';
import { parseKey } from '../invites/inviteCode';
import type { Ctx } from '../shell/ctx';
import { recreateDevAccount } from '../server/personas';
import { createAccountReady, MIN_PASSWORD } from '../auth/model';
import { signIn, signInReady } from '../auth/signIn';
import { useInvitePreview } from '../auth/useInvitePreview';
import { useOrganizationSearch } from '../auth/useOrganizationSearch';
import { redeemSignInCode } from '../invites/invites';
import { useRequestOutcome } from '../invites/useInviteRequests';
import { latestRequest } from '../invites/requestOutcome';
import { Badge, Banner, Card, EmptyState, Field, GhostBtn, Group, HelpTop, Header, HelpInfo, Ico, LinkBtn, OrDivider, PrimaryBtn, ProgressBar, QuietLinks, Row, Screen, SearchField, SectionLabel, Segments, ShowMore, SmallBtn, type IconName } from '../ui/kit';
import { useHardwareBack } from '../ui/useHardwareBack';
import { txt } from '../ui/textStyles';
import { PRIVACY_URL } from '../auth/legal';
import { LicenseRow, LicenseSheet } from '../org/licenseSheet';
import { noteExpected, reportError, failureMessage } from '../diagnostics/report';
import { recordAuth, recordAuthFailure, since } from '../auth/authDiag';
import { inviteOutcome } from '../auth/authOutcome';
import { createOrganization } from '../org/createOrg';
import { navRef } from '../shell/nav';
import { contractsFor } from '../shell/screenContracts';
import { FORGETS_ON_SIGN_OUT, forgetThisBrowser } from '../web/forgetBrowser';
import { setSession, signInWithPassword, signUp } from '../server/auth';
import { signInWithV2Account } from '../server/v2';
import { lift } from '../ui/shadow';
import { C, TINT, radius, space, tile, type as T, withAlpha } from '../ui/theme';
import { useAccountActions, useDisplayNames } from '../account/useAccount';
import { LanguageChip } from '../i18n/uiLanguage';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';

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

  async function submit() {
    setBusy(true);
    setError('');
    const started = Date.now();
    try {
      const outcome = await signIn(email, password, {
        signInWithPassword, setSession, signInWithV2Account, ...(ctx.isDev ? { recreateDevAccount } : {})
      });
      // A wrong password or no connection: the server's answer, said in the language showing.
      if (outcome.kind === 'refused') {
        noteExpected(outcome.where, outcome.raw);
        recordAuthFailure('sign_in', outcome.reason, { ms: since(started) });
        setError(authErrorText(outcome.reason, t('entry.signIn.failed')));
        return;
      }
      recordAuth('sign_in', 'ok', { n: { ms: since(started) } });
      // Signing in accepts the terms (AUTH-1). The session this screen was
      // given belongs to the guest, so record it for the account that just
      // signed in; the account outbox delivers (and retries) it once the new
      // session is up.
      if (outcome.userId) await recordTerms(outcome.userId);
    } catch (e) {
      recordAuthFailure('sign_in', e, { ms: since(started) });
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

  const ready = signInReady(email, password);
  const joining = ctx.invite.held?.claim.kind === 'next-account';
  return (
    <Screen header={<HelpTop />} bodyStyle={styles.signInBody}>
      <LanguageChip />
      <View style={styles.brand}>
        <View style={styles.logo}><Ico name="book" size={32} color={C.white} /></View>
        {/* i18n-ignore: the app's name, the same in every language */}
        <Text style={styles.wordmark} accessibilityRole="header">LangQuest</Text>
        <Text style={[txt.smMuted, { textAlign: 'center' }]}>{t('entry.signIn.tagline')}</Text>
      </View>
      {joining ? <Banner icon="people" title={t('entry.signIn.joinTitle')} body={t('entry.signIn.joinBody')} /> : null}
      {/* Two ways in that never combine (the demo's ADR-031): the fields, or a code. */}
      <Card>
        <Field value={email} onChangeText={setEmail} placeholder={t('entry.signIn.namePlaceholder')} keyboardType="email-address" autoCapitalize="none" />
        <Field value={password} onChangeText={setPassword} placeholder={t('entry.fields.password')} secure autoCapitalize="none"
          onSubmit={() => { if (ready && !busy) void submit(); }} />
        {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
        <PrimaryBtn label={busy ? t('entry.shared.signingIn') : t('entry.signIn.button')} onPress={() => void submit()} disabled={!ready || busy} />
        <TermsLink ctx={ctx} i18nKey="entry.termsLine.signingIn" />
      </Card>
      <OrDivider />
      <GhostBtn label={t('entry.signIn.scanCode')} icon="qr" help={t('entry.signIn.scanCodeHelp')} onPress={() => ctx.go('scan_qr')} />
      <Text style={[txt.xs, { textAlign: 'center' }]}>{t('entry.signIn.scanHint')}</Text>
      <View style={styles.inline}>
        <Text style={txt.smMuted}>{t('entry.signIn.noAccount')}</Text>
        <LinkBtn label={t('entry.createAccount.button')} help={t('entry.signIn.createAccountHelp')} onPress={() => ctx.go('create_account')} />
      </View>
      <GhostBtn label={t('entry.signIn.browse')} icon="globe" help={t('entry.signIn.browseHelp')} onPress={() => ctx.go('explore_home')} />
      {ctx.canSwitchPersona ? (
        <LinkBtn label={t('entry.signIn.switchPersona')} color={C.muted} help={t('account.more.personaSub')} onPress={ctx.openDev} style={{ alignSelf: 'center' }} />
      ) : null}
    </Screen>
  );
}

/** The line that says doing this accepts the terms, with the terms one tap away (ADR-022). */
function TermsLink(props: { ctx: Ctx; i18nKey: 'entry.termsLine.signingIn' | 'entry.termsLine.joining' | 'entry.termsLine.creating' }) {
  const spot = useHelpSpot(t('entry.terms.title'), t('entry.termsLine.readHelp'), () => props.ctx.go('terms_privacy'));
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="link" style={({ pressed }) => [styles.termsLine, pressed && { opacity: 0.7 }]}>
      <Text style={[txt.xs, { textAlign: 'center' }]}>
        <Trans i18nKey={props.i18nKey} components={{ b: <Text style={styles.termsLink} /> }} />
      </Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

// ---- Terms & Privacy (AUTH-1) ----------------------------------------------------------------

/**
 * What is not allowed, as the terms list it. Google Play asks that terms
 * forbid objectionable content and are accepted before anyone posts
 * (decisions.md 48); signing in accepts them (TERMS_VERSION).
 */
function notAllowed(): string[] {
  return [
    t('entry.terms.rules.hate'),
    t('entry.terms.rules.harassment'),
    t('entry.terms.rules.sexual'),
    t('entry.terms.rules.violence'),
    t('entry.terms.rules.illegal'),
    t('entry.terms.rules.privateInfo'),
    t('entry.terms.rules.impersonation'),
    t('entry.terms.rules.spam'),
    t('entry.terms.rules.hacking')
  ];
}

/** A page to read; accepting is the line under Sign In (ADR-022). */
export function TermsPrivacy(ctx: Ctx) {
  return (
    <Screen header={<Header title={t('entry.terms.title')} onBack={ctx.back} />}>
      <Card>
        <Text style={txt.h3}>{t('entry.terms.termsTitle')}</Text>
        <Text style={txt.xs}>{t('entry.terms.updated', { date: TERMS_VERSION })}</Text>
        <Text style={txt.bodyMuted}>{t('entry.terms.intro')}</Text>
        <Text style={txt.bodyMuted}>{t('entry.terms.yourWork')}</Text>
      </Card>
      <Card>
        <Text style={txt.h3}>{t('entry.terms.notAllowedTitle')}</Text>
        <Text style={txt.bodyMuted}>{t('entry.terms.notAllowedLead')}</Text>
        {notAllowed().map((rule) => (
          <View key={rule} style={styles.rule}>
            <Text style={txt.bodyMuted}>{'\u2022'}</Text>
            <Text style={[txt.bodyMuted, { flex: 1 }]}>{rule}</Text>
          </View>
        ))}
      </Card>
      <Card>
        <Text style={txt.h3}>{t('entry.terms.reportingTitle')}</Text>
        <Text style={txt.bodyMuted}>{t('entry.terms.reporting')}</Text>
        <Text style={txt.bodyMuted}>{t('entry.terms.enforcement')}</Text>
      </Card>
      <Card>
        <Text style={txt.h3}>{t('entry.terms.privacyTitle')}</Text>
        <Text style={txt.bodyMuted}>{t('entry.terms.privacy')}</Text>
        <LinkBtn label={t('entry.terms.readFull')} help={t('entry.terms.readFullHelp')} onPress={() => void Linking.openURL(PRIVACY_URL)} />
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
  // A phone's Back goes back a card, as the header's arrow does (decision 137).
  useHardwareBack(step > 0, () => setStep(step - 1));
  return (
    <Screen
      header={<Header title={t('entry.vision.title')} sub={t('entry.vision.step', { current: step + 1, total: VISION_STEPS.length })} onBack={step === 0 ? ctx.back : () => setStep(step - 1)}
        {...(step > 0 ? { backHelp: t('entry.vision.backHelp') } : {})} />}
      footer={<PrimaryBtn label={last ? t('common.done') : t('common.next')} help={last ? t('help.details.done') : t('entry.vision.nextHelp')}
        onPress={last ? ctx.back : () => setStep(step + 1)} />}
      bodyStyle={styles.visionBody}
    >
      <HelpInfo label={t('entry.vision.step', { current: step + 1, total: VISION_STEPS.length })} detail={t('entry.vision.segmentsHelp')}>
        <Segments total={VISION_STEPS.length} done={(i) => i < step} current={step} />
      </HelpInfo>
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

/** Where a refreshed list is: still loading, refreshed (or not asked), or showing what was saved. */
type Refresh = 'loading' | 'fresh' | 'stale';

/** What to say over a refreshed list: loading, or that it could not refresh. */
function refreshMessage(r: Refresh): string {
  return r === 'loading' ? t('common.loading') : r === 'stale' ? t('entry.explore.stale') : '';
}

/**
 * A server list shown at once from what this device saved, then refreshed.
 * The state says what to say over it (refreshMessage).
 */
function useRefreshed<T>(where: string, cached: () => Promise<T[]>, fresh: () => Promise<T[]>, enabled = true): [T[], Refresh] {
  const [rows, setRows] = useState<T[]>([]);
  const [message, setMessage] = useState<Refresh>(enabled ? 'loading' : 'fresh');
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      const saved = await cached().catch((e: unknown) => { reportError(`${where} cache`, e); return []; });
      if (active) setRows(saved);
      try {
        const latest = await fresh();
        if (active) { setRows(latest); setMessage('fresh'); }
      } catch (e) {
        // Offline or the server is away: expected, and said on screen.
        noteExpected(`${where} refresh`, e);
        if (active) setMessage('stale');
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The loaders are module functions; only whether to load can change
  }, [enabled]);
  return [rows, message];
}

/** Organizations that list their work publicly, without an account: name, languages, progress. */
export function ExploreHome(ctx: Ctx) {
  const [listed, refresh] = useRefreshed('explore', cachedPublicLanguages, publicLanguages);
  const message = refreshMessage(refresh);
  const [shown, setShown] = useState(EXPLORE_STEP);
  const guest = ctx.session.isGuest;
  return (
    <Screen header={<Header title={t('entry.explore.title')} onBack={ctx.back}
      action={guest ? <SmallBtn label={t('entry.signIn.button')} tone="primary" help={t('entry.explore.signInHelp')} onPress={() => ctx.go('sign_in')} /> : undefined} />}>
      {message ? <Banner icon="cloud" title={message} /> : null}
      {listed.length ? <SectionLabel label={t('entry.explore.listed')} /> : null}
      {listed.slice(0, shown).map((p) => {
        const pct = Math.round(p.translated_pct);
        // A license this build does not know yet is simply not shown.
        const license = isLicense(p.license) ? { ...licenseText(p.license), terms: LICENSE_INFO[p.license].terms } : null;
        return (
          <HelpRow key={`${p.org_id}:${p.language_id}`} of="entry.listedLanguage">
            <Card accessibilityLabel={t('entry.explore.cardLabel', { name: p.name, percent: formatPercent(pct) })}
              help={guest ? t('entry.explore.cardGuestHelp') : t('entry.explore.cardHelp')}
              onPress={guest ? () => ctx.go('sign_in') : () => ctx.go('request_access', { orgId: p.org_id })}>
              <View style={{ gap: 2 }}>
                <Text style={txt.h3}>{p.name}</Text>
                {p.code ? <Text style={txt.smMuted}>{p.code}</Text> : null}
              </View>
              {license ? <View style={{ flexDirection: 'row' }}><Badge label={`${license.name} · ${license.short}`} tone={license.terms.outsidersMayView ? 'green' : 'default'} /></View> : null}
              <ProgressBar value={pct} />
              <View style={styles.between}>
                <Text style={txt.xs}>{t('entry.explore.recorded')}</Text>
                <Text style={[txt.xsStrong, { color: C.primary }]}>{formatPercent(pct)}</Text>
              </View>
            </Card>
          </HelpRow>
        );
      })}
      <ShowMore remaining={listed.length - shown} step={EXPLORE_STEP} onMore={() => setShown(shown + EXPLORE_STEP)} />
      {!listed.length && !message ? <EmptyState icon="globe" title={t('entry.explore.emptyTitle')} sub={t('entry.explore.emptySub')} /> : null}
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
      header={<Header title={t('entry.newPerson.title')} onBack={ctx.back} />}
      footer={<PrimaryBtn label={busy ? t('entry.shared.joining') : t('entry.shared.join')} icon="check" help={t('entry.newPerson.joinHelp')}
        onPress={() => void join()} disabled={!name.trim() || busy} />}
    >
      <Text style={txt.bodyMuted}>{t('entry.newPerson.intro')}</Text>
      <Field label={t('entry.fields.yourName')} value={name} onChangeText={setName} placeholder={t('entry.fields.yourName')} autoCapitalize="words"
        help={t('entry.newPerson.nameHelp')} />
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
      <TermsLink ctx={ctx} i18nKey="entry.termsLine.joining" />
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
  const ready = createAccountReady(email, password, confirm);

  async function create() {
    setBusy(true);
    setError('');
    const started = Date.now();
    try {
      const { data, error } = await signUp(email.trim(), password);
      if (error) {
        noteExpected('sign up', error);
        recordAuthFailure('sign_up', error, { ms: since(started) });
        setError(authErrorText(error, t('entry.createAccount.failed')));
        return;
      }
      recordAuth('sign_up', 'ok', { n: { ms: since(started) } });
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
      recordAuthFailure('sign_up', e, { ms: since(started) });
      setError(failure('sign up', e));
    } finally {
      setBusy(false);
    }
  }

  if (checkEmail) {
    return (
      <Screen header={<Header title={t('entry.createAccount.title')} onBack={ctx.back} />}>
        <EmptyState icon="check" title={t('entry.createAccount.createdTitle')} sub={t('entry.createAccount.createdSub', { email: email.trim() })} />
      </Screen>
    );
  }

  return (
    <Screen header={<Header title={t('entry.createAccount.title')} onBack={ctx.back} />}>
      <Field label={t('entry.fields.email')} value={email} onChangeText={setEmail} placeholder={t('entry.createAccount.emailPlaceholder')} keyboardType="email-address" autoCapitalize="none" />
      <Field label={t('entry.fields.password')} value={password} onChangeText={setPassword} placeholder={t('entry.createAccount.passwordPlaceholder')} secure autoCapitalize="none" />
      <Field label={t('entry.createAccount.confirmLabel')} value={confirm} onChangeText={setConfirm} placeholder={t('entry.createAccount.confirmPlaceholder')} secure autoCapitalize="none"
        help={t('entry.createAccount.confirmHelp')} />
      {/* The placeholder that says so is gone once typing starts: say why the button stays off. */}
      {password.length > 0 && password.length < MIN_PASSWORD ? <Text style={txt.error}>{t('entry.createAccount.tooShort')}</Text> : null}
      {confirm.length > 0 && password !== confirm ? <Text style={txt.error}>{t('entry.createAccount.mismatch')}</Text> : null}
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
      <PrimaryBtn label={busy ? t('entry.shared.creating') : t('entry.createAccount.button')} onPress={() => void create()} disabled={!ready || busy} />
      <TermsLink ctx={ctx} i18nKey="entry.termsLine.creating" />
      <OrDivider />
      <GhostBtn label={t('entry.createAccount.scanInvite')} icon="qr" help={t('entry.createAccount.scanInviteHelp')} onPress={() => ctx.go('scan_qr')} />
      <Text style={[txt.xs, { textAlign: 'center' }]}>{t('entry.createAccount.scanHint')}</Text>
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

  // A link opens this screen on its own (flow D), with nothing under it to go
  // back to: Back then leads where the person would otherwise be, Sign In or
  // their home, and the held invite stays held. Android's Back does the same
  // on any screen with nothing under it (shell/useRootBack.ts).
  const alone = () => !(navRef.isReady() && navRef.canGoBack());
  const leave = () => { if (!alone()) ctx.back(); else if (guest) ctx.go('sign_in'); else ctx.home(); };

  // What the server says about the held key; null when it cannot be asked.
  const { preview, asked } = useInvitePreview(invite);

  // Nothing read yet: open the camera, so pointing it is the only step.
  useEffect(() => {
    if (autoStarted.current || Platform.OS === 'web' || !permission || held || signinCode) return;
    autoStarted.current = true;
    if (permission.granted) { setScanning(true); return; }
    if (permission.canAskAgain) void requestPermission().then((r) => { if (r.granted) setScanning(true); });
  }, [permission, held, signinCode, requestPermission]);

  async function read(value: string) {
    const key = parseKey(value);
    if (!key) { setError(t('entry.scan.notCode')); return false; }
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
      else setError(t('entry.scan.cameraOff'));
    })();
  }

  const card = inviteCard(preview);
  const { dead, alreadyIn, named } = scanVerdict(preview, invite.status);
  const claimedHere = held?.claim.kind === 'next-account';
  const me = useDisplayNames(ctx.session.actorId)[ctx.session.actorId]
    ?? signInName(ctx.session.email) ?? ctx.session.email?.split('@')[0] ?? null;
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
          <PrimaryBtn label={joining ? t('entry.shared.joining') : t('entry.shared.joinAs', { name: firstName(named) || named })} icon="check" busy={joining} disabled={joining}
            help={t('entry.scan.joinAsHelp')} onPress={() => void joinNamed()} />
        ) : (
          <PrimaryBtn label={t('entry.shared.join')} icon="check" disabled={joining} help={t('entry.scan.joinHelp')}
            // A group invite's label names the group, not the person: they type their own name
            // (an empty name, so no earlier visit's name carries over).
            onPress={() => ctx.go('create_account', { as: 'new', name: '' })} />
        )}
        <GhostBtn label={t('entry.scan.haveAccount')} disabled={joining} help={t('entry.scan.haveAccountHelp')} onPress={() => void invite.choose('next-account').then(() => ctx.go('sign_in'))} />
      </>
    ) : (
      <>
        <PrimaryBtn label={joining ? t('entry.shared.joining') : me ? t('entry.shared.joinAs', { name: me }) : t('entry.scan.joinAsYou')} icon="check"
          busy={joining} disabled={invite.status.kind !== 'idle' && invite.status.kind !== 'dead'}
          help={t('entry.scan.joinAsMeHelp')} onPress={() => void invite.choose('me')} />
        <GhostBtn label={me ? t('entry.scan.notMe', { name: me }) : t('entry.scan.notYou')} help={t('entry.scan.notMeHelp')} onPress={() => ctx.go('sign_out_confirm')} />
      </>
    );
  }

  return (
    <Screen
      header={<Header title={t('entry.scan.title')} sub={signinCode ? t('entry.scan.subSignIn') : guest ? t('entry.scan.subGuest') : t('entry.scan.subMember')} onBack={leave} />}
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
                  if (!parseKey(data)) { setError(t('entry.scan.notQr')); return; }
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
              {scanning ? t('entry.scan.hintPoint') : held ? t('entry.scan.hintRead') : t('entry.scan.hintTap')}
            </Text>
          </View>
          {held ? (
            <Card>
              <View style={styles.optionRow}>
                <View style={styles.tile}><Ico name="people" size={24} color={C.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[txt.body, { fontWeight: '700' }]}>{card.title}</Text>
                  {card.detail ? <Text style={txt.smMuted}>{card.detail}</Text> : null}
                  {card.from ? <Text style={txt.xs}>{t('entry.scan.from', { name: card.from })}</Text> : null}
                  {!preview ? <Text style={txt.xs}>{t('entry.scan.roleWhenConnected')}</Text> : null}
                </View>
              </View>
            </Card>
          ) : null}
          {/* A new person joins through the server, so say so before they type a name (docs/invites-and-accounts.md flow E). */}
          {guest && held && asked && !preview ? <Banner icon="cloud" title={t('entry.invite.needsConnection')} /> : null}
          {dead ? <Banner icon="flag" tone="amber" title={t('entry.scan.deadTitle')} body={dead} /> : null}
          {alreadyIn ? <Banner icon="check" tone="green" title={t('entry.scan.alreadyTitle')} body={t('entry.scan.alreadyBody')} /> : null}
          {invite.status.kind === 'waiting' ? (
            <Banner icon="cloud" title={t('entry.shared.savedOnDevice')} body={t('entry.scan.waitingBody')} />
          ) : null}
          {guest && claimedHere && !joining ? (
            <Text style={txt.xs}>{t('entry.scan.savedForSignIn')}</Text>
          ) : null}
          {guest && held && !dead && !alreadyIn ? <TermsLink ctx={ctx} i18nKey="entry.termsLine.joining" /> : null}
          <GhostBtn label={scanning ? t('entry.scan.stopCamera') : held ? t('entry.scan.scanDifferent') : t('entry.scan.scanQr')} icon="camera"
            help={scanning ? t('entry.scan.stopCameraHelp') : held ? t('entry.scan.scanDifferentHelp') : t('entry.scan.scanQrHelp')} onPress={toggleCamera} />
          <Field label={t('entry.scan.pasteLabel')} value={text} autoCapitalize="none" placeholder={t('entry.scan.pastePlaceholder')} help={t('entry.scan.pasteHelp')}
            onChangeText={(v) => {
              // More than one character at once is a paste (or a scanner typing): say when it is not a code.
              const pasted = v.trim().length - text.trim().length > 1;
              setText(v);
              setError('');
              if (parseKey(v)) void read(v).then((ok) => { if (ok) setText(''); });
              else if (pasted) setError(t('entry.scan.notCode'));
            }} />
          {held && (dead || alreadyIn) ? <LinkBtn label={t('entry.scan.clearInvite')} color={C.muted} help={t('entry.scan.clearInviteHelp')} onPress={() => void invite.drop()} style={{ alignSelf: 'center' }} /> : null}
          {held && !dead && !alreadyIn && !guest ? <LinkBtn label={t('common.notNow')} color={C.muted} help={t('entry.scan.notNowHelp')} onPress={() => void invite.drop().then(ctx.home)} style={{ alignSelf: 'center' }} /> : null}
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
        <Banner icon="lock" title={t('entry.signInKey.notGuestTitle')} body={t('entry.signInKey.notGuestBody')} />
        <LinkBtn label={t('entry.signInKey.scanElse')} help={t('entry.signInKey.scanElseHelp')} onPress={props.onCancel} style={{ alignSelf: 'center' }} />
      </>
    );
  }
  async function go() {
    setBusy(true);
    setError('');
    const started = Date.now();
    try {
      const help = await redeemSignInCode(props.code);
      const { data, error } = await setSession(help.session);
      if (error) {
        noteExpected('sign in with code', error);
        recordAuthFailure('code', error, { ms: since(started) });
        setError(authErrorText(error, t('entry.signInKey.failed')));
        return;
      }
      recordAuth('code', 'ok', { n: { ms: since(started) } });
      if (data.user) {
        await recordHelp(data.user.id, help.helper).catch((e: unknown) => { reportError('record sign-in help', e); });
        await ctx.acceptTerms(data.user.id).catch((e: unknown) => { reportError('accept terms', e); });
      }
      ctx.toast(help.oldPhoneSignedOut ? t('entry.signInKey.signedInOldPhone')
        : help.helper ? t('entry.signInKey.signedInWith', { name: help.helper }) : t('entry.signInKey.signedIn'));
    } catch (e) {
      noteExpected('sign-in code', e);
      // The function says "expired or already used" in its reply, as an invite does.
      recordAuthFailure('code', e, { ms: since(started) }, inviteOutcome);
      // The function's reply is English: say it in the language showing.
      setError(e instanceof Error ? signInCodeErrorText(e.message) : t('common.tryWhenConnected'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Banner icon="lock" title={t('entry.signInKey.title')} body={t('entry.signInKey.body')} />
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
      <PrimaryBtn label={busy ? t('entry.shared.signingIn') : t('entry.signInKey.button')} icon="check" busy={busy} disabled={busy} help={t('entry.signInKey.buttonHelp')} onPress={() => void go()} />
      <LinkBtn label={t('common.cancel')} color={C.muted} help={t('entry.signInKey.cancelHelp')} onPress={props.onCancel} style={{ alignSelf: 'center' }} />
    </>
  );
}

// ---- What brings you here? (AUTH-4, AUTH-5) ---------------------------------------------------------

// Join your team (demo ADR-040): scanning a teammate's code first, the way most people arrive;
// finding a listed organization (decision 66); starting a new one; looking around last.
function intents(): { to: 'create_org' | 'request_access' | 'scan_qr' | 'explore_home'; icon: IconName; label: string; sub: string; help?: string }[] {
  return [
    { to: 'scan_qr', icon: 'qr', label: t('entry.intent.scanTitle'), sub: t('entry.intent.scanSub'), help: t('entry.intent.scanHelp') },
    { to: 'request_access', icon: 'search', label: t('entry.intent.findTitle'), sub: t('entry.intent.findSub'), help: t('entry.intent.findHelp') },
    { to: 'create_org', icon: 'building', label: t('entry.intent.startTitle'), sub: t('entry.intent.startSub'), help: t('entry.intent.startHelp') },
    { to: 'explore_home', icon: 'globe', label: t('entry.intent.lookTitle'), sub: t('entry.intent.lookSub') }
  ];
}

/**
 * Someone with no organization lands here (NAV-2). After asking to join
 * one, it says who they are waiting for (AUTH-5) and keeps the other ways
 * in underneath.
 */
export function IntentChooser(ctx: Ctx) {
  const actions = useAccountActions(ctx.session.actorId);
  const waiting = latestRequest(actions);
  // The name Explore knew, else a neutral phrase: never the org's id.
  const waitingFor = waiting && typeof waiting.payload.orgName === 'string' ? waiting.payload.orgName : null;
  const askedLine = waitingFor ? t('entry.shared.askedOrg', { org: waitingFor }) : t('entry.shared.askedUnknown');
  const [error, setError] = useState('');
  // Once the server has it, watch for the answer: admitted opens the
  // organization; turned away says so (useRequestOutcome).
  const sentTo = waiting?.status === 'sent' && typeof waiting.payload.orgId === 'string'
    ? { id: waiting.id, orgId: waiting.payload.orgId } : null;
  const outcome = useRequestOutcome(ctx.session.actorId, sentTo);
  const joinedOrg = outcome.kind === 'joined' ? outcome.orgId : null;
  const declined = outcome.kind === 'declined';
  const { openOrganization } = ctx;
  useEffect(() => {
    if (!joinedOrg) return;
    openOrganization(joinedOrg).catch((e: unknown) => setError(failureMessage('open joined organization', e)));
  }, [joinedOrg, openOrganization]);
  // Sign out goes through the same confirmation as Me: it says what waits, and a
  // phone hands it over (NOORG-004, decision 60).
  const me = useDisplayNames(ctx.session.actorId)[ctx.session.actorId];
  const first = me?.split(/\s+/)[0];
  const main = intents().filter((o) => o.to !== 'explore_home');
  return (
    <Screen header={<Header title={waiting && !declined ? askedLine : t('entry.intent.title')} {...(first && !waiting ? { sub: t('entry.welcome.greeting', { name: first }) } : {})} />}
      footer={<QuietLinks items={[{ label: t('entry.intent.lookTitle'), icon: 'globe', help: t('entry.intent.lookHelp'), onPress: () => ctx.go('explore_home') }]} />}>
      {/* An invite being used right now, or waiting for a connection (docs/invites-and-accounts.md). */}
      {ctx.invite.status.kind === 'joining' ? <Banner icon="people" title={t('entry.intent.joiningInvite')} /> : null}
      {ctx.invite.status.kind === 'waiting' ? (
        <Banner icon="cloud" title={t('entry.intent.inviteSavedTitle')} body={t('entry.intent.inviteSavedBody')} />
      ) : null}
      {ctx.invite.status.kind === 'dead' ? <Banner icon="flag" tone="amber" title={t('entry.intent.inviteDeadTitle')} body={ctx.invite.status.message} /> : null}
      {waiting ? (
        <>
          {/* Asked, and waiting (demo a-waiting): the answer comes by itself. */}
          <View style={styles.hero}>
            <View style={[styles.heroCircle, declined && { backgroundColor: TINT.amber }]}><Ico name={declined ? 'flag' : 'clock'} size={40} color={declined ? TINT.amberText : C.primary} /></View>
            <Text style={[txt.h2, { textAlign: 'center', fontWeight: '800' }]}>
              {declined ? (waitingFor ? t('entry.intent.declinedOrg', { org: waitingFor }) : t('entry.intent.declinedUnknown')) : askedLine}
            </Text>
            <Text style={[txt.bodyMuted, { textAlign: 'center' }]}>
              {declined
                ? t('entry.intent.declinedBody')
                : waiting.status === 'sent'
                  ? t('entry.shared.sentBody')
                  : t('entry.intent.savedBody')}
            </Text>
          </View>
          <SectionLabel label={t('entry.intent.meanwhile')} />
        </>
      ) : null}
      {/* help-each: each choice goes somewhere different */}
      {main.map((o, i) => (
        <Card key={o.to} onPress={() => ctx.go(o.to)} accessibilityLabel={o.label} help={o.help} current={i === 0 && !waiting}>
          <View style={styles.optionRow}>
            <View style={[styles.tile, i === 0 && !waiting && { backgroundColor: C.primary }]}><Ico name={o.icon} size={24} color={i === 0 && !waiting ? C.white : C.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[txt.body, { fontWeight: '700', fontSize: 19 }]}>{o.label}</Text>
              <Text style={txt.smMuted}>{o.sub}</Text>
            </View>
            <Ico name="right" size={22} color={C.muted} />
          </View>
        </Card>
      ))}
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
      {!ctx.session.isGuest ? (
        <QuietLinks items={[
          { label: t('entry.intent.signOut'), icon: 'user', help: t('entry.intent.signOutHelp'), onPress: () => ctx.go('sign_out_confirm') },
          { label: t('entry.intent.deleteAccount'), icon: 'trash', help: t('entry.intent.deleteAccountHelp'), onPress: () => ctx.go('delete_account') }
        ]} />
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
      ctx.toast(t('entry.createOrg.ready', { name: orgName }));
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
      header={<Header title={t('entry.createOrg.title')} onBack={ctx.back} />}
      footer={<PrimaryBtn label={busy ? t('entry.shared.creating') : t('entry.createOrg.button')} onPress={() => void create()} disabled={!name.trim() || busy} />}
    >
      <View style={styles.hero}>
        <View style={[styles.tile, styles.heroTile]}><Ico name="building" size={32} color={C.primary} /></View>
        <Text style={[txt.h2, { textAlign: 'center' }]}>{t('entry.createOrg.heroTitle')}</Text>
        <Text style={[txt.bodyMuted, { textAlign: 'center' }]}>{t('entry.createOrg.heroBody')}</Text>
      </View>
      <Field label={t('entry.createOrg.nameLabel')} value={name} onChangeText={setName} placeholder={t('entry.createOrg.namePlaceholder')} autoCapitalize="words"
        help={t('entry.createOrg.nameHelp')} />
      <View>
        <SectionLabel label={t('entry.createOrg.licenseLabel')} />
        <Group><LicenseRow license={license} onPress={() => setChoosing(true)} last /></Group>
      </View>
      <LicenseSheet visible={choosing} mode="choose" current={license} onClose={() => setChoosing(false)}
        onConfirm={(l) => { setLicense(l); setChoosing(false); }} />
      <Banner icon="sparkle" title={t('entry.createOrg.readyTitle')} body={t('entry.createOrg.readyBody')} />
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
  // i18n-ignore: 'request access' is the log label for this list's failures
  const [listed, refresh] = useRefreshed('request access', cachedListedOrganizations, listedOrganizations);
  // Found on Explore, which shows languages: the organization's own name is
  // the listed one (never the language's); unknown, a neutral phrase.
  const givenName = given ? listed.find((o) => o.org_id === given)?.name : undefined;
  const loadMessage = refreshMessage(refresh);
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
  // The list on the phone is the first 500 by name: online, the server searches
  // them all, and what it finds joins what the phone has (offline, the phone's alone).
  const matches = useOrganizationSearch(listed, find.trim().toLowerCase());

  async function sendTo(o: ListedOrganization) {
    setBusy(true);
    setError('');
    try {
      setRequestId(await queueAccountAction(ctx.session.actorId, 'join_request', { orgId: o.org_id, message: '', orgName: o.name, askedAt: Date.now() }));
    } catch (e) {
      setError(failure('request access', e));
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    setBusy(true);
    setError('');
    try {
      setRequestId(await queueAccountAction(ctx.session.actorId, 'join_request', {
        orgId, message: message.trim(), ...(orgName ? { orgName } : {}), askedAt: Date.now()
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
        header={<Header title={failed ? t('entry.request.notSent') : t('entry.request.asked')} onBack={() => ctx.go('intent_chooser')} />}
        footer={failed ? <GhostBtn label={t('common.back')} help={t('entry.request.backHelp')} onPress={() => ctx.go('intent_chooser')} />
          : <PrimaryBtn label={t('common.done')} help={t('entry.request.doneHelp')} onPress={() => ctx.go('intent_chooser')} />}
      >
        <EmptyState icon={failed ? 'close' : 'clock'}
          title={failed ? t('entry.request.requestNotSent') : orgName ? t('entry.shared.askedOrg', { org: orgName }) : t('entry.shared.askedUnknown')}
          sub={failed ? outboxErrorText(request?.error, t('entry.request.couldNotTake'))
            : request?.status === 'sent' ? t('entry.shared.sentBody')
            : t('entry.request.savedBody')} />
      </Screen>
    );
  }

  // Found from Explore: one organization, and a message if they like.
  if (given) {
    return (
      <Screen
        header={<Header title={orgName ? t('entry.request.askOrg', { org: orgName }) : t('entry.request.askUnknown')} onBack={ctx.back} />}
        footer={<PrimaryBtn label={t('entry.request.askToJoin')} icon="arrowR" help={t('entry.request.askHelp')} onPress={() => void send()} disabled={orgId === ''} busy={busy} />}
      >
        <Text style={txt.bodyMuted}>{t('entry.request.askIntro')}</Text>
        <Field label={t('entry.request.messageLabel')} value={message} onChangeText={setMessage} placeholder={t('entry.request.messagePlaceholder')} multiline
          help={t('entry.request.messageHelp')} />
        {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
      </Screen>
    );
  }
  // Find your organization (demo a-findOrg): the listed ones, each with Ask to join.
  return (
    <Screen header={<Header title={t('entry.intent.findTitle')} onBack={ctx.back} />}>
      <SearchField value={find} onChangeText={(v) => { setFind(v); setShown(EXPLORE_STEP); }} placeholder={t('entry.request.searchPlaceholder')} />
      {loadMessage ? <Banner icon="cloud" title={loadMessage} /> : null}
      {matches.length > 0 ? (
        <Group>
          {matches.slice(0, shown).map((o, i, all) => (
            <HelpRow key={o.org_id} of="entry.organization">
              <Row label={o.name} sub={o.languages.join(' · ')} help={t('entry.request.rowHelp')} last={i === all.length - 1}
                accessibilityLabel={t('entry.request.askRowLabel', { org: o.name })}
                right={<Text style={[txt.link, { fontSize: 16 }]}>{busy && picked?.org_id === o.org_id ? t('entry.request.asking') : t('entry.request.askToJoin')}</Text>}
                onPress={() => { setPicked(o); void sendTo(o); }} />
            </HelpRow>
          ))}
        </Group>
      ) : null}
      <ShowMore remaining={matches.length - shown} step={EXPLORE_STEP} onMore={() => setShown(shown + EXPLORE_STEP)} />
      {listed.length && !matches.length ? <Text style={txt.smMuted}>{t('entry.request.noMatch', { query: find.trim() })}</Text> : null}
      {refresh === 'loading' ? null : (
        <Text style={txt.smMuted}>{listed.length ? t('entry.request.notHere') : t('entry.request.noneListed')}</Text>
      )}
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
  heroCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  heroTile: { width: 64, height: 64, borderRadius: 24 }
});

export const contracts = contractsFor('sign_in', 'create_account', 'terms_privacy', 'vision', 'intent_chooser', 'create_org', 'explore_home', 'request_access', 'scan_qr');
