// Getting in and having no organization yet. Ports the demo's
// src/screens/entry.tsx (SignInScreen, TermsPrivacyScreen, VisionScreen,
// ExploreHomeScreen, ScanQrScreen) and the no-org half of
// src/screens/onboarding.tsx (IntentChooserScreen, CreateAccountScreen,
// CreateOrgScreen, RequestAccessScreen).
// Requirements AUTH-1..6, ONB-2, ONB-6 (creating an organization), NAV-2.
// ADR-022 (terms are a line under Sign In; three Vision cards), ADR-023
// (creating an org is celebrated), ADR-028 (the invite says who it is for;
// here only what the phone knows, since a link's claims are unchecked).
import { CommandError, SEED_ROLES } from '@langquest-next/core';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { cachedPublicProjects, publicProjects, queueAccountAction, type PublicProject } from '../accountData';
import { inviteLine, inviteSummary, VISION_STEPS } from '../accountText';
import type { Ctx } from '../ctx';
import { DEV_PASSWORD, ensurePersonaAccount, personasAvailable } from '../dev';
import { parseInvite, redeemInvite } from '../invites';
import {
  Banner, Card, EmptyState, Field, GhostBtn, Header, Ico, LinkBtn, PrimaryBtn, ProgressBar, Screen, SectionLabel,
  Segments, ShowMore, SmallBtn, txt, type IconName
} from '../kit';
import { noteExpected, reportError, failureMessage } from '../report';
import { contractsFor } from '../screenContracts';
import { supabase } from '../supabase';
import { C, radius, space, tile, type as T, withAlpha } from '../theme';
import { useAccountActions } from '../useAccount';

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
      let { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
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

  const ready = email.trim().includes('@') && password.length > 0;
  return (
    <Screen bodyStyle={styles.signInBody}>
      <View style={styles.brand}>
        <View style={styles.logo}><Ico name="book" size={32} color={C.white} /></View>
        <Text style={styles.wordmark} accessibilityRole="header">LangQuest</Text>
        <Text style={[txt.smMuted, { textAlign: 'center' }]}>Coordinating Bible translation — draft to approval</Text>
      </View>
      <Card>
        <Field value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" autoCapitalize="none" />
        <Field value={password} onChangeText={setPassword} placeholder="Password" secure autoCapitalize="none" />
        {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
        <PrimaryBtn label={busy ? 'Signing in…' : 'Sign In'} onPress={() => void signIn()} disabled={!ready || busy} />
        <Pressable onPress={() => ctx.go('terms_privacy')} accessibilityRole="link" style={({ pressed }) => [styles.termsLine, pressed && { opacity: 0.7 }]}>
          <Text style={[txt.xs, { textAlign: 'center' }]}>
            By signing in you accept the <Text style={styles.termsLink}>Terms of Use and Privacy Policy</Text>
          </Text>
        </Pressable>
        <View style={styles.inline}>
          <Text style={txt.smMuted}>Don't have an account?</Text>
          <LinkBtn label="Create Account" onPress={() => ctx.go('create_account')} />
        </View>
      </Card>
      <GhostBtn label="Browse public projects" icon="globe" onPress={() => ctx.go('explore_home')} />
      {ctx.canSwitchPersona ? (
        <LinkBtn label="Switch persona" color={C.muted} onPress={ctx.openDev} style={{ alignSelf: 'center' }} />
      ) : null}
    </Screen>
  );
}

// ---- Terms & Privacy (AUTH-1) ----------------------------------------------------------------

/** A page to read; accepting is the line under Sign In (ADR-022). */
export function TermsPrivacy(ctx: Ctx) {
  return (
    <Screen header={<Header title="Terms & Privacy" onBack={ctx.back} />}>
      <Card>
        <Text style={txt.h3}>Terms of Use</Text>
        <Text style={txt.bodyMuted}>
          LangQuest is a coordination tool for translation teams. Use it in line with your organization's policies. Do not share credentials or private translation drafts outside your assigned scope.
        </Text>
      </Card>
      <Card>
        <Text style={txt.h3}>Privacy Policy</Text>
        <Text style={txt.bodyMuted}>
          We store the account, assignment, and progress data needed to run your team's work. Recordings belong to your organization. Public explore views show only published project information.
        </Text>
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

// ---- Explore Projects (AUTH-6) --------------------------------------------------------------------

const EXPLORE_STEP = 25;

/** Public projects without an account: name, languages, progress. */
export function ExploreHome(ctx: Ctx) {
  const [projects, setProjects] = useState<PublicProject[]>([]);
  const [message, setMessage] = useState('Loading projects…');
  const [shown, setShown] = useState(EXPLORE_STEP);
  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await cachedPublicProjects().catch((e: unknown) => { reportError('explore cache', e); return []; });
      if (active) setProjects(cached);
      try {
        const rows = await publicProjects();
        if (active) { setProjects(rows); setMessage(''); }
      } catch (e) {
        // Offline or the server is away: expected, and said on screen.
        noteExpected('explore refresh', e);
        if (active) setMessage('Unable to refresh. Showing saved projects when available.');
      }
    })();
    return () => { active = false; };
  }, []);
  const guest = ctx.session.isGuest;
  return (
    <Screen header={<Header title="Explore Projects" onBack={ctx.back}
      action={guest ? <SmallBtn label="Sign In" tone="primary" onPress={() => ctx.go('sign_in')} /> : undefined} />}>
      {message ? <Banner icon="cloud" title={message} /> : null}
      {projects.length ? <SectionLabel label="Public projects" /> : null}
      {projects.slice(0, shown).map((p) => {
        const pct = Math.round(p.translated_pct);
        return (
          <Card key={`${p.org_id}:${p.project_id}`} accessibilityLabel={`${p.name}, ${pct}%`}
            onPress={guest ? () => ctx.go('sign_in') : () => ctx.go('request_access', { orgId: p.org_id, projectName: p.name })}>
            <View style={{ gap: 2 }}>
              <Text style={txt.h3}>{p.name}</Text>
              {p.languages.length ? <Text style={txt.smMuted} numberOfLines={2}>{p.languages.join(', ')}</Text> : null}
            </View>
            <ProgressBar value={pct} />
            <View style={styles.between}>
              <Text style={txt.xs}>{p.languages.length} {p.languages.length === 1 ? 'language' : 'languages'}</Text>
              <Text style={[txt.xsStrong, { color: C.primary }]}>{pct}%</Text>
            </View>
          </Card>
        );
      })}
      <ShowMore remaining={projects.length - shown} step={EXPLORE_STEP} onMore={() => setShown(shown + EXPLORE_STEP)} />
      {!projects.length && !message ? <EmptyState icon="globe" title="No public projects yet" sub="Projects appear here when their team makes them public." /> : null}
    </Screen>
  );
}

// ---- Create Account (AUTH-2) ------------------------------------------------------------------------

export function CreateAccount(ctx: Ctx) {
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
    <Screen
      header={<Header title="Create Account" onBack={ctx.back} />}
      footer={<PrimaryBtn label={busy ? 'Creating…' : 'Create Account'} onPress={() => void create()} disabled={!emailOk || !matches || busy} />}
    >
      <Text style={txt.bodyMuted}>
        Got an invite QR code? Tap Scan org invite below. Otherwise, create an email account and ask to join an organization.
      </Text>
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
      <Field label="Password" value={password} onChangeText={setPassword} placeholder="Choose a password (6 or more characters)" secure autoCapitalize="none" />
      <Field label="Confirm password" value={confirm} onChangeText={setConfirm} placeholder="Re-enter password" secure autoCapitalize="none" />
      {confirm.length > 0 && password !== confirm ? <Text style={txt.error}>Passwords do not match.</Text> : null}
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
      <Card onPress={() => ctx.go('scan_qr')} accessibilityLabel="Scan org invite">
        <View style={styles.optionRow}>
          <View style={styles.tile}><Ico name="qr" size={24} color={C.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[txt.body, { fontWeight: '600' }]}>Scan org invite</Text>
            <Text style={txt.smMuted}>The code carries the organization, role and scope</Text>
          </View>
          <Ico name="right" size={22} color={C.muted} />
        </View>
      </Card>
      <Pressable onPress={() => ctx.go('terms_privacy')} accessibilityRole="link" style={({ pressed }) => [styles.termsLine, pressed && { opacity: 0.7 }]}>
        <Text style={[txt.xs, { textAlign: 'center' }]}>
          Creating an account accepts the <Text style={styles.termsLink}>Terms of Use and Privacy Policy</Text>
        </Text>
      </Pressable>
    </Screen>
  );
}

// ---- Scan QR (AUTH-3, ADR-028) -------------------------------------------------------------------------

/**
 * Camera and pasted invites use the same redemption contract, which appends
 * the membership and lands this session on its new home. Once a code is read
 * the screen says only what this phone knows: the org's name if it has it,
 * else "Invitation to join an organization". A link can be edited by anyone
 * who forwards it, so nothing it claims is shown as fact.
 */
export function ScanQr(ctx: Ctx) {
  const [code, setCode] = useState(ctx.params['invite'] ?? '');
  useEffect(() => { setCode(ctx.params['invite'] ?? ''); }, [ctx.params['invite']]);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const scanned = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = parseInvite(code);
  const summary = useMemo(() => inviteSummary(code), [code]);
  const knownOrg = summary.orgId && summary.orgId === ctx.project.orgId ? ctx.org.state?.org?.value.name : undefined;
  const line = inviteLine(knownOrg);
  const guest = ctx.session.isGuest;

  async function join() {
    if (!parsed) { setError('That does not look like an invite code.'); return; }
    setBusy(true);
    setError('');
    try {
      if (guest) {
        await ctx.rememberInvite(code);
        ctx.go('sign_in');
        return;
      }
      let joined: { orgId: string };
      try {
        joined = await redeemInvite(parsed.token);
      } catch (e) {
        // Used, expired or offline: expected, and the server says which.
        noteExpected('redeem invite', e);
        setError(e instanceof Error ? e.message : 'The invite could not be used.');
        return;
      }
      await ctx.markJoined(ctx.session.actorId);
      await ctx.openOrganization(joined.orgId);
    } catch (e) {
      setError(failure('join by invite', e));
    } finally {
      setBusy(false);
    }
  }

  function toggleCamera() {
    if (scanning) { setScanning(false); return; }
    void (async () => {
      const result = permission?.granted ? permission : await requestPermission();
      if (result.granted) { scanned.current = false; setError(''); setScanning(true); }
      else setError('Camera access is off. You can paste an invite below.');
    })();
  }

  return (
    <Screen
      header={<Header title="Scan QR code" sub={guest ? 'Sign in after scanning and the invite adds you to the team' : 'Invite includes organization, role, and scope'} onBack={ctx.back} />}
      footer={<PrimaryBtn label={busy ? 'Joining…' : guest ? 'Continue to sign in' : 'Join'} icon="check" onPress={() => void join()} disabled={!parsed || busy} />}
    >
      <View style={styles.viewfinder}>
        {scanning && permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (scanned.current) return;
              if (!parseInvite(data)) { setError('This QR code is not a LangQuest invite.'); return; }
              scanned.current = true;
              setCode(data);
              setError('');
              setScanning(false);
            }} />
        ) : (
          <Ico name={parsed ? 'check' : 'qr'} size={72} color={parsed ? C.green : C.faint} />
        )}
        {(['tl', 'tr', 'bl', 'br'] as const).map((k) => (
          <View key={k} pointerEvents="none" style={[styles.corner, {
            borderColor: parsed ? C.soft : C.white,
            ...(k[0] === 't' ? { top: 16, borderTopWidth: 3 } : { bottom: 16, borderBottomWidth: 3 }),
            ...(k[1] === 'l' ? { left: 16, borderLeftWidth: 3 } : { right: 16, borderRightWidth: 3 })
          }]} />
        ))}
        <Text style={styles.viewfinderHint}>
          {scanning ? 'Point the camera at the invite code' : parsed ? 'Invite read' : 'Tap Scan to use the camera'}
        </Text>
      </View>
      {parsed ? (
        <Card>
          <View style={styles.optionRow}>
            <View style={styles.tile}><Ico name="people" size={24} color={C.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[txt.body, { fontWeight: '700' }]}>{line}</Text>
              <Text style={txt.smMuted}>Your role shows once you join.</Text>
            </View>
          </View>
        </Card>
      ) : null}
      <GhostBtn label={scanning ? 'Stop camera' : parsed ? 'Scan a different invite' : 'Scan QR code'} icon="camera" onPress={toggleCamera} />
      <Field label="Or paste the invite code or link" value={code} onChangeText={(v) => { setCode(v); setError(''); }} placeholder="Invite code" autoCapitalize="none" />
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
    </Screen>
  );
}

// ---- What brings you here? (AUTH-4, AUTH-5) ---------------------------------------------------------

const INTENTS: { to: 'create_org' | 'request_access' | 'scan_qr' | 'explore_home'; icon: IconName; label: string; sub: string }[] = [
  { to: 'create_org', icon: 'building', label: 'Create an organization', sub: 'Start a new translation org' },
  { to: 'request_access', icon: 'people', label: 'Join an existing org', sub: 'Accept an invitation or request access' },
  { to: 'scan_qr', icon: 'qr', label: 'Join with QR code', sub: 'Scan an invite — keeps your email and name' },
  { to: 'explore_home', icon: 'globe', label: 'Explore projects', sub: 'Browse public translation projects' }
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
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) setError(error.message);
  }
  return (
    <Screen header={<Header title={waiting ? 'Request sent' : 'What brings you here?'} />}>
      {waiting ? (
        <>
          <View style={styles.waiting}>
            <View style={styles.optionRow}>
              <View style={[styles.tile, { borderRadius: 22 }]}><Ico name="clock" size={22} color={C.primary} /></View>
              <Text style={[txt.body, { fontWeight: '700', flex: 1 }]}>Waiting for {waitingFor}</Text>
            </View>
            <Text style={txt.body}>
              {waiting.status === 'sent'
                ? "An admin will give you a role. Once they do, sign in again and you'll land on your work."
                : 'Your request is saved on this phone and sends when you have a connection.'}
            </Text>
            <Text style={txt.smMuted}>There's nothing else you need to do.</Text>
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
      {!ctx.session.isGuest ? <LinkBtn label="Sign out" color={C.muted} onPress={() => void signOut()} style={{ alignSelf: 'center' }} /> : null}
    </Screen>
  );
}

// ---- Create Organization (ONB-6, ADR-023) ----------------------------------------------------------------

/**
 * Creating an organization writes the org partition: the org, the seed
 * roles with their privilege sets, and you as Organization Admin at org
 * scope. The first project, its languages and how passages get checked are
 * set up next from My Work's Getting started (ONB-5), so nothing here is
 * sample content.
 */
export function CreateOrg(ctx: Ctx) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function create() {
    const orgName = name.trim();
    if (!orgName) return;
    setBusy(true);
    setError('');
    try {
      const me = ctx.session.actorId;
      if (!ctx.org.state?.org) await ctx.org.append('v1.OrgCreated', { name: orgName });
      for (const r of SEED_ROLES) {
        if (!ctx.org.state?.roles[r.roleId]) await ctx.org.append('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
      }
      await ctx.org.append('v1.OrgMemberAdded', {
        profileId: me, roleId: 'org_admin', scope: { level: 'org' },
        ...(ctx.session.email ? { displayName: ctx.session.email.split('@')[0]! } : {})
      });
      // The creator needs no "who invited you" welcome; My Work's Getting
      // started is their first day (ADR-022).
      // The org exists by now, so a failure here is reported, not shown as
      // "not created"; the worst case is seeing the welcome once more.
      await ctx.markWelcomed().catch((e: unknown) => { reportError('create org welcomed', e); });
      ctx.toast(`${orgName} is ready to grow. Next, set up your first project and invite your team.`);
      ctx.go('my_work');
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
      <Banner icon="sparkle" title="Ready to use"
        body="You'll get the usual roles and a standard way to check passages. Next, we'll set up your first project and team together." />
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
    </Screen>
  );
}

// ---- Request Access (AUTH-5) -----------------------------------------------------------------------------

/**
 * Ask an organization to let you in. The request is saved on this phone and
 * sent when there is a connection; until an admin accepts, you see nothing
 * of theirs.
 */
export function RequestAccess(ctx: Ctx) {
  const [orgId, setOrgId] = useState(ctx.params['orgId'] ?? '');
  const projectName = ctx.params['projectName'];
  // Explore knows the project, not the organization's name.
  const orgName = projectName ? `the ${projectName} team` : undefined;
  const [message, setMessage] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const actions = useAccountActions(ctx.session.actorId);
  const request = actions.find((a) => a.id === requestId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const label = orgName ?? orgId.trim();

  async function send() {
    setBusy(true);
    setError('');
    try {
      setRequestId(await queueAccountAction(ctx.session.actorId, 'join_request', {
        orgId: orgId.trim(), message: message.trim(), ...(orgName ? { orgName } : {})
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
            : 'Saved on this phone. It sends when you have a connection.'} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<Header title="Request access" onBack={ctx.back} />}
      footer={<PrimaryBtn label="Send request" icon="arrowR" onPress={() => void send()} disabled={orgId.trim() === ''} busy={busy} />}
    >
      <Text style={txt.bodyMuted}>Ask to join an existing organization. An admin will review your request.</Text>
      {orgName ? (
        <Card>
          <View style={styles.optionRow}>
            <View style={styles.tile}><Ico name="building" size={24} color={C.primary} /></View>
            <Text style={[txt.body, { fontWeight: '600', flex: 1 }]}>{orgName}</Text>
            <Ico name="check" size={22} color={C.primary} />
          </View>
        </Card>
      ) : (
        <Field label="Organization code" value={orgId} onChangeText={setOrgId} placeholder="Ask the organization for its code" autoCapitalize="none" />
      )}
      <Field label="Message" value={message} onChangeText={setMessage} placeholder="Why you want to join" multiline />
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  signInBody: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.xl, gap: space.lg },
  brand: { alignItems: 'center', gap: space.sm, paddingBottom: space.sm },
  logo: { width: 64, height: 64, borderRadius: 24, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
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
