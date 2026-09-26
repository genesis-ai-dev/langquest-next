import { StyleSheet } from '../theme';
// Avatar U (text fallback). Entry, onboarding, and no-org screens. One action each.
import { AlertCircle, BookOpen, Building2, CheckCircle2, ClipboardList, Clock, CloudOff, Compass, Globe, Handshake, Library, LogOut, QrCode, ScanLine, Users } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { queueAccountAction, recordUserEvent } from '../accountData';
import { useAccountActions } from '../useAccount';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { ORG_PARTITION, SEED_ROLES, type EventPayloads, type EventType } from '@langquest-next/core';
import { SupabaseTransport, SyncClient, ensureDeviceId, type Materializer } from '@langquest-next/client';
import * as Crypto from 'expo-crypto';
import { getStore } from '../store';
import { ORG_MATERIALIZER } from '../useOrg';
import type { Ctx } from '../ctx';
import { Footer, Header, Note, NotWired, Row, Screen, Section } from '../pui';
import { supabase } from '../supabase';
import { requestPasswordReset } from '../accountRecovery';
import { translateUi } from '../uiLanguage';
import { parseInvite, redeemInvite } from '../invites';
import { DEV_PASSWORD, ensurePersonaAccount } from '../dev';
import { colors, space } from '../theme';
import { ActionButton, Card, IconCircleButton, text } from '../ui';

const ORG_ID = process.env.EXPO_PUBLIC_ORG_ID ?? 'org1';

const SAMPLE_PASSAGES = ['Luke 1:1-4', 'Luke 1:5-25', 'Luke 1:26-38', 'Luke 1:39-56'];

export function SignIn(ctx: Ctx) {
  const [email, setEmail] = useState(ctx.isDev ? (process.env.EXPO_PUBLIC_DEV_EMAIL ?? '') : '');
  const [password, setPassword] = useState(ctx.isDev ? (process.env.EXPO_PUBLIC_DEV_PASSWORD ?? '') : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError('');
    let { error } = await supabase.auth.signInWithPassword({ email, password });
    // Dev: `npm run db:test` resets the local database and wipes auth users.
    // Recreate the dev account instead of stranding the developer at sign-in.
    if (error && ctx.isDev && email === process.env.EXPO_PUBLIC_DEV_EMAIL && password === DEV_PASSWORD) {
      await ensurePersonaAccount({ id: 'dev', email });
      ({ error } = await supabase.auth.signInWithPassword({ email, password }));
    }
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>LangQuest</Text>
      <Text style={[text.muted, { textAlign: 'center' }]}>{translateUi('Coordinating Bible translation — draft to approval')}</Text>
      <TextInput style={styles.input} placeholder="email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="password" secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ActionButton label="Sign In" accessibilityLabel="Sign In" onPress={() => void signIn()} disabled={busy || !email.trim()} />
      <Pressable onPress={() => ctx.go('create_account')} hitSlop={8}>
        <Text style={[text.muted, { textAlign: 'center' }]}>{translateUi('Create account')}</Text>
      </Pressable>
      <Pressable disabled={busy} onPress={() => {
        setBusy(true);
        void requestPasswordReset(email).then(() => setError('If an account exists, a recovery email is on its way.'))
          .catch((e) => setError(e.message)).finally(() => setBusy(false));
      }} hitSlop={8}>
        <Text style={[text.muted, { textAlign: 'center' }]}>{translateUi('Forgot password?')}</Text>
      </Pressable>
      {ctx.canSwitchPersona ? (
        <Pressable onPress={ctx.openDev} hitSlop={8}>
          <Text style={[text.small, { textAlign: 'center' }]}>Switch persona</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Avatar U (text fallback). Email, password and confirm, then optionally an
 * organization to ask to join (by code: there is no public org list, see
 * explore retirement) or a scanned invite that is redeemed after sign-in.
 */
export function CreateAccount(ctx: Ctx) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [orgCode, setOrgCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Set when sign-up needs the email confirmed first, so no session starts.
  const [created, setCreated] = useState(false);
  // A scanned invite waits in storage (scan_qr → popTo here) and is redeemed
  // after sign-in by the pending-invite effect in App.tsx.
  const [invite, setInvite] = useState<string | null>(null);
  const focused = useIsFocused();
  useEffect(() => {
    if (focused) void AsyncStorage.getItem('pending-invite').then(setInvite).catch(() => {});
  }, [focused]);
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = email.includes('@') && password.length >= 6 && password === confirm;
  async function create() {
    setBusy(true);
    setError('');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { setError(error.message); setBusy(false); return; }
    const code = orgCode.trim();
    // Queued under the new account; it sends once this account is signed in.
    if (code && !invite && data.user) await queueAccountAction(data.user.id, 'join_request', { orgId: code, message: '' }).catch(() => {});
    // With a session the auth invariant moves on to terms; without one the
    // account waits for its email to be confirmed.
    if (!data.session) setCreated(true);
    setBusy(false);
  }
  if (created) {
    return (
      <Screen footer={<Footer label="Sign In" onPress={ctx.back} />}>
        <Header title="Account created" />
        <View style={[styles.center, { minHeight: 200 }]}>
          <CheckCircle2 size={64} color={colors.done} />
        </View>
        <Note>
          {orgCode.trim() && !invite
            ? 'Confirm your email, then sign in. Your request to join is with an admin. Until they assign a role, this account sees nothing of theirs.'
            : 'Confirm your email, then sign in. You can create an organization, request to join one, or scan an invite when you are ready.'}
        </Note>
      </Screen>
    );
  }
  return (
    <Screen footer={<Footer label="Create Account" onPress={() => void create()} disabled={busy || !ready} />}>
      <Header title="Create Account" onBack={ctx.back} />
      <Text style={text.muted}>Create an email account, then join an organization — ask to join one below, or scan an invite QR for immediate access.</Text>
      <TextInput style={styles.input} placeholder="Email" accessibilityLabel="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="Choose a password" accessibilityLabel="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <TextInput style={styles.input} placeholder="Re-enter password" accessibilityLabel="Confirm password" secureTextEntry value={confirm} onChangeText={setConfirm} />
      {mismatch ? <Text style={styles.error}>Passwords do not match.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {invite ? (
        <Card>
          <View style={styles.rowBetween}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <QrCode size={20} color={colors.done} />
              <Text style={text.h4}>Invite scanned</Text>
            </View>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => {
              void AsyncStorage.removeItem('pending-invite').then(() => setInvite(null));
            }}>
              <Text style={[text.small, { color: colors.translate }]}>Remove invite</Text>
            </Pressable>
          </View>
          <Text style={text.muted}>Creating the account and signing in gives you this access.</Text>
        </Card>
      ) : (
        <>
          <TextInput style={styles.input} placeholder="Organization code (optional)" accessibilityLabel="Organization code" autoCapitalize="none" autoCorrect={false} value={orgCode} onChangeText={setOrgCode} />
          <Text style={text.small}>A code sends a join request to its admins. They assign a role before you get access.</Text>
        </>
      )}
      <Section label="Have an invite?">
        <Row icon={ScanLine} label={invite ? 'Scan a different invite' : 'Scan org invite'}
          sub="QR includes org, role, and scope — you join immediately"
          onPress={() => ctx.go('scan_qr', { from: 'create_account' })} last />
      </Section>
    </Screen>
  );
}

export function TermsPrivacy(ctx: Ctx) {
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    try { await recordUserEvent(ctx.session.actorId, 'v1.TermsAccepted'); ctx.go('vision'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Screen footer={<Footer label="Continue" onPress={() => void accept()} disabled={!accepted || busy} />}>
      {/* Back cannot return to sign-in while signed in (the auth invariant
          bounces it), so leaving goes through the guarded sign-out. */}
      <Header title="Terms & Privacy" onBack={() => ctx.go('sign_out_confirm')} />
      {error ? <Note>{error}</Note> : null}
      <Text style={text.muted}>Before you use LangQuest, please review and accept our Terms of Use and Privacy Policy.</Text>
      <Card>
        <Text style={text.h4}>Terms of Use</Text>
        <Text style={text.body}>Your recordings belong to your organization. We store them to sync between your devices and your team.</Text>
      </Card>
      <Card>
        <Text style={text.h4}>Privacy Policy</Text>
        <Text style={text.body}>We never sell your data. Audio is only shared with people your project leader adds.</Text>
      </Card>
      <Pressable style={styles.rowBetween} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}
        onPress={() => setAccepted(!accepted)}>
        <Text style={[text.body, { flex: 1 }]}>I accept the Terms of Use and Privacy Policy</Text>
        <Switch value={accepted} onValueChange={setAccepted} />
      </Pressable>
    </Screen>
  );
}

/** The reference's five ideas (ux data.ts VISION_STEPS), icon-led: the title is the line, the body is muted. */
const VISION = [
  { icon: Globe, title: 'Scripture in every language', body: 'LangQuest helps teams record, check, and share Bible translation — across languages, projects, and whatever method their organization uses.' },
  { icon: BookOpen, title: 'Every passage keeps a record', body: 'Versions, notes, key terms, reviews, and community feedback all attach to the passage. Whatever one person adds becomes context for the next.' },
  { icon: Compass, title: 'Your method is advice', body: 'The organization\'s review flow suggests what should happen next. You can do steps in any order, or set one aside — just say why.' },
  { icon: Handshake, title: 'Do it yourself, or ask someone', body: 'Run a community check yourself and record it, or ask a teammate. Every review counts the same way.' },
  { icon: ClipboardList, title: 'Progress the whole team can see', body: 'Everyone lands on My Work — what\'s waiting for you, and what you\'re waiting on. The Map shows every passage and how far it\'s come.' }
];

export function Vision(ctx: Ctx) {
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const last = step === VISION.length - 1;
  const Icon = VISION[step]!.icon;
  return (
    <Screen
      footer={
        <Footer
          label={last ? 'Get started' : 'Continue'}
          onPress={() => {
            if (last) {
              void ctx.markVisionSeen().then(ctx.home).catch((e) => setError(e.message));
            } else setStep(step + 1);
          }}
          secondary={step > 0 ? { label: 'Back', onPress: () => setStep(step - 1) } : undefined}
        />
      }
    >
      {error ? <Note>{error}</Note> : null}
      <Header title="" onBack={() => ctx.go('terms_privacy')} />
      <View style={styles.center}>
        <Icon size={72} color={colors.translate} />
        <Text style={[text.h3, { textAlign: 'center' }]}>{VISION[step]!.title}</Text>
        <Text style={[text.muted, { textAlign: 'center' }]}>{VISION[step]!.body}</Text>
        <View style={styles.dots}>
          {VISION.map((_, i) => (
            <View key={i} style={[styles.dot, i === step && { backgroundColor: colors.translate, width: 24 }]} />
          ))}
        </View>
      </View>
    </Screen>
  );
}

export function IntentChooser(ctx: Ctx) {
  // Oral-first: joining by an invite QR is the one yellow action. The other
  // paths sit right below it as neutral rows, never behind "More options".
  // There is no tab bar here, so signing out is a row of its own.
  const request = useAccountActions(ctx.session.actorId).filter((a) => a.kind === 'join_request' && a.status !== 'failed').at(-1);
  const orgCode = request ? String(request.payload.orgId ?? '') : '';
  return (
    <Screen>
      <Header title={request ? 'Request sent' : 'What brings you here?'} />
      {request ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Clock size={24} color={colors.review} />
              <View style={{ flex: 1 }}>
                <Text style={text.h4}>Waiting for an admin</Text>
                <Text style={text.small}>{orgCode}</Text>
              </View>
            </View>
            <Text style={text.body}>
              {request.status === 'sent'
                ? 'An admin will give you a role. Once they do, sign in again and you\'ll land on your work.'
                : 'Your request is saved on this device. It sends when you have a connection.'}
            </Text>
            <Text style={text.muted}>There's nothing else you need to do.</Text>
          </Card>
          <Text style={[text.small, { fontWeight: '700' }]}>{translateUi('Meanwhile').toUpperCase()}</Text>
        </>
      ) : null}
      <View style={[styles.center, { minHeight: request ? 200 : 280 }]}>
        <IconCircleButton icon={QrCode} size={request ? 120 : 180} accessibilityLabel="Join with QR code. Scan an invite — keeps your email and name" onPress={() => ctx.go('scan_qr')} />
      </View>
      <Section label="Other ways in">
        <Row icon={Building2} label="Create an organization" sub="Start a new translation org" onPress={() => ctx.go('create_org')} />
        <Row icon={Users} label="Join an existing org" sub="Accept an invitation or request access" onPress={() => ctx.go('request_access')} last />
      </Section>
      <Section label="Account">
        <Row icon={LogOut} label="Sign out" onPress={() => ctx.go('sign_out_confirm')} last />
      </Section>
    </Screen>
  );
}

/** A client for a partition other than the selected one, to write its first events. */
async function partitionClient<S>(actorId: string, orgId: string, projectId: string, materializer?: Materializer<S>) {
  const store = await getStore();
  const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
  const client = new SyncClient<S>({
    ...(materializer ? { materializer } : {}),
    orgId, projectId, actorId, deviceId, store,
    transport: new SupabaseTransport(supabase),
    newId: () => Crypto.randomUUID()
  });
  await client.load();
  return client;
}

type Intent = { type: EventType; payload: EventPayloads[EventType] };
const intent = <T extends EventType>(type: T, payload: EventPayloads[T]): Intent => ({ type, payload });

/**
 * Avatar P. Creating an organization writes the org partition first (the
 * org, the seed roles with the spec's privilege sets, you as Organization
 * Admin at org scope, the first project registered), then the first
 * project with sample passages. UX spec A9: org create presets standard
 * values.
 */
export function CreateOrg(ctx: Ctx) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const me = ctx.session.actorId;
      const orgName = name.trim() || 'My organization';
      // A new organization gets fresh partitions. ctx.org and ctx.project are
      // the selected ones (EXPO_PUBLIC_ORG_ID in dev), which belong to others.
      const orgId = Crypto.randomUUID();
      const projectId = Crypto.randomUUID();
      const org = await partitionClient(me, orgId, ORG_PARTITION, ORG_MATERIALIZER);
      await org.appendMany([
        intent('v1.OrgCreated', { name: orgName }),
        ...SEED_ROLES.map((r) => intent('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges })),
        intent('v1.OrgMemberAdded', { profileId: me, roleId: 'org_admin', scope: { level: 'org' }, ...(ctx.session.email ? { displayName: ctx.session.email.split('@')[0]! } : {}) }),
        intent('v1.ProjectRegistered', { projectId, name: 'Luke' })
      ]);
      const project = await partitionClient(me, orgId, projectId);
      await project.appendMany([
        intent('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' }),
        intent('v1.MemberAdded', { profileId: me, role: 'owner' }),
        intent('v1.ProjectConfigChanged', {
          config: {
            unitKinds: [
              { id: 'book', label: 'Book', childKinds: ['passage'] },
              { id: 'passage', label: 'Passage', childKinds: [] }
            ],
            workflow: [{ id: 'community', role: 'reviewer', required: true, rule: 'any' }]
          }
        }),
        intent('v1.LaneAdded', { laneId: 'L1', languoidId: 'und' }),
        intent('v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a' }),
        ...SAMPLE_PASSAGES.flatMap((label, i) => [
          intent('v1.UnitAdded', { unitId: `luke-${i}`, parentUnitId: 'luke', kind: 'passage', label, order: `a${i}` }),
          intent('v1.ReferenceAttached', { unitId: `luke-${i}`, refId: `luke-${i}-terms`, kind: 'key_terms', text: 'Theophilus, eyewitnesses, orderly account' })
        ])
      ]);
      // The org first: its admin membership authorizes the project's events.
      // Offline, both stay pending and the workspace pushes them later.
      await org.sync().then(() => project.sync()).catch(() => {});
      await ctx.openOrganization(orgId, projectId, 'walkthrough');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <Screen footer={<Footer label={busy ? 'Creating...' : 'Create Organization'} onPress={() => void create()} />}>
      <Header title="Create Organization" onBack={ctx.back} />
      <Note>Creating an organization presets standard roles, a passage template, and a one-step community review flow. You can change all of it later.</Note>
      {error ? <Note>{error}</Note> : null}
      <TextInput style={styles.input} placeholder="Organization Name" accessibilityLabel="Organization Name" value={name} onChangeText={setName} />
    </Screen>
  );
}

export function RequestAccess(ctx: Ctx) {
  const [orgId, setOrgId] = useState(ctx.params['orgId'] ?? '');
  const [message, setMessage] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const actions = useAccountActions(ctx.session.actorId);
  const request = actions.find((a) => a.id === requestId);
  const sent = requestId !== null;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError('');
    try {
      setRequestId(await queueAccountAction(ctx.session.actorId, 'join_request', { orgId: orgId.trim(), message: message.trim() }));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Screen
      footer={
        sent
          ? <Footer label="Back" onPress={() => ctx.go('intent_chooser')} />
          : <Footer label="Send request" onPress={() => void send()} disabled={busy || orgId.trim() === ''} />
      }
    >
      <Header title="Request access" onBack={ctx.back} />
      {sent ? (
        <>
          <View style={[styles.center, { minHeight: 160 }]}>
            {request?.status === 'failed' ? <AlertCircle size={64} color={colors.reference} />
              : request?.status === 'sent' ? <CheckCircle2 size={64} color={colors.done} />
                : <CloudOff size={64} color={colors.mutedForeground} />}
            <Text style={text.h4}>{request?.status === 'failed' ? 'Request not sent' : 'Request sent'}</Text>
          </View>
          <Note>{request?.status === 'sent' ? `Your request to join ${orgId.trim()} is on its way. An admin will review it.` : request?.status === 'failed' ? request.error : 'Request saved on this device. It sends when you have a connection.'}</Note>
        </>
      ) : (
        <>
          <Text style={text.muted}>Ask to join an existing organization. An admin will review your request. Until someone accepts, you see nothing of theirs.</Text>
          <TextInput style={styles.input} placeholder="Organization code" accessibilityLabel="Organization code" autoCapitalize="none" value={orgId} onChangeText={setOrgId} />
          <TextInput style={styles.input} placeholder="Why you want to join (optional)" accessibilityLabel="Message" value={message} onChangeText={setMessage} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      )}
    </Screen>
  );
}

/**
 * Camera and pasted invites use the same redemption contract, which appends membership and
 * lands this session on its new home.
 */
export function ScanQr(ctx: Ctx) {
  const [code, setCode] = useState(ctx.params['invite'] ?? '');
  useEffect(() => { setCode(ctx.params['invite'] ?? ''); }, [ctx.params['invite']]);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const scanned = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function join() {
    const parsed = parseInvite(code);
    if (!parsed) {
      setError('That does not look like an invite code.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (ctx.session.isGuest) {
        await ctx.rememberInvite(code);
        // From sign-up, the invite rides along on the new account's draft.
        ctx.go(ctx.params['from'] === 'create_account' ? 'create_account' : 'sign_in');
        return;
      }
      const joined = await redeemInvite(parsed.token);
      await ctx.openOrganization(joined.orgId);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Screen footer={<Footer label="Join" onPress={() => void join()} disabled={busy || code.trim() === ''} />}>
      <Header title="Scan QR code" sub="Invite includes organization, role, and scope" onBack={ctx.back} />
      {scanning && permission?.granted ? (
        <CameraView style={{ height: 260 }} facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (scanned.current) return;
            if (!parseInvite(data)) { setError('This QR code is not a LangQuest invite.'); return; }
            scanned.current = true;
            setCode(data);
            setError('');
            setScanning(false);
          }} />
      ) : <View style={[styles.center, { minHeight: 120 }]} >
        <QrCode size={96} color={colors.mutedForeground} />
      </View>}
      <Row icon={ScanLine} label={scanning ? 'Stop camera' : 'Scan QR code'} onPress={() => {
        if (scanning) { setScanning(false); return; }
        void (async () => {
          const result = permission?.granted ? permission : await requestPermission();
          if (result.granted) { scanned.current = false; setScanning(true); }
          else setError('Camera access is off. You can paste an invite below.');
        })();
      }} last />
      <Note>Scan a QR code or paste the invite code or link.</Note>
      <TextInput
        style={styles.input}
        placeholder="invite code"
        autoCapitalize="none"
        autoCorrect={false}
        value={code}
        onChangeText={setCode}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

/** The reference's six steps (ux data.ts WALKTHROUGH_STEPS); its inert "Try:" buttons are left out. */
const WALK = [
  { icon: BookOpen, title: 'Welcome to LangQuest', body: 'LangQuest keeps a record for every passage: recordings, notes, key terms, and reviews. Your organization\'s method guides what happens next without getting in the way.' },
  { icon: Building2, title: 'How Organizations Work', body: 'Organizations contain projects, which contain target languages. Higher-level admins can do everything lower-level roles can, unless restrictions are applied.' },
  { icon: Users, title: 'Permissions Say Who May Act', body: 'Roles are named permission sets — record, review, ask for reviews. They never decide what should happen next; that\'s the review flow\'s job.' },
  { icon: Library, title: 'Content and Context', body: 'Templates divide Scripture into passages. Study material, key terms, and question sets live at the org, project, or language level and add up — nothing is copied.' },
  { icon: Compass, title: 'Review Flows Are Advice', body: 'Arrange your review steps in a suggested order. Mark a step as required when it must happen before a passage is done.' },
  { icon: Handshake, title: 'Ask Someone', body: 'Asking creates work that shows on their My Work. People can also start work without being asked.' }
];

export function Walkthrough(ctx: Ctx) {
  const [error, setError] = useState('');
  const finish = () => { void recordUserEvent(ctx.session.actorId, 'v1.WalkthroughDone').then(ctx.home).catch((e) => setError(e.message)); };
  const [step, setStep] = useState(0);
  const last = step === WALK.length - 1;
  const Icon = WALK[step]!.icon;
  return (
    <Screen
      footer={
        <Footer
          label={last ? 'Done — Let\'s Go!' : 'Continue'}
          onPress={() => (last ? finish() : setStep(step + 1))}
          secondary={step > 0 ? { label: 'Back', onPress: () => setStep(step - 1) } : undefined}
        />
      }
    >
      {error ? <Note>{error}</Note> : null}
      <Header title="Organization walkthrough" sub={`Step ${step + 1} of ${WALK.length}`}
        action={<Pressable onPress={ctx.home} hitSlop={8} accessibilityRole="button" accessibilityLabel="Skip">
          <Text style={[text.body, { color: colors.translate }]}>{translateUi('Skip')}</Text>
        </Pressable>} />
      <View style={styles.center}>
        <Icon size={72} color={colors.translate} />
        <Text style={[text.h3, { textAlign: 'center' }]}>{WALK[step]!.title}</Text>
        <Text style={[text.muted, { textAlign: 'center' }]}>{WALK[step]!.body}</Text>
        <View style={styles.dots}>
          {WALK.map((_, i) => (
            <View key={i} style={[styles.dot, i === step && { backgroundColor: colors.translate, width: 24 }]} />
          ))}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md, backgroundColor: colors.background },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center', color: colors.foreground },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: colors.card, color: colors.foreground },
  error: { color: colors.reference },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingVertical: space.xl },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border }
});

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('sign_in', 'create_account', 'terms_privacy', 'vision', 'intent_chooser', 'create_org', 'request_access', 'scan_qr', 'walkthrough');
