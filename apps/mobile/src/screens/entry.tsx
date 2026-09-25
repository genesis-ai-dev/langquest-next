import { StyleSheet } from '../theme';
// Avatar U (text fallback). Entry, onboarding, and no-org screens. One action each.
import { Building2, Eye, Headphones, Mic, QrCode, ScanLine, Send, Users } from 'lucide-react-native';
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
      <TextInput style={styles.input} placeholder="email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="password" secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ActionButton label="Sign in" accessibilityLabel="Sign in" onPress={() => void signIn()} disabled={busy} />
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

export function CreateAccount(ctx: Ctx) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function create() {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setError(error.message);
  }
  return (
    <Screen footer={<Footer label="Create account" onPress={() => void create()} disabled={!email.includes('@') || password.length < 6} />}>
      <Header title="Create account" onBack={ctx.back} />
      <TextInput style={styles.input} placeholder="email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="password" secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Section label="Have an invite?">
        <Row icon={ScanLine} label="Scan org invite" onPress={() => ctx.go('scan_qr')} last />
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
      <Header title="Terms & Privacy" onBack={ctx.back} />
      {error ? <Note>{error}</Note> : null}
      <Card>
        <Text style={text.body}>Your recordings belong to your organization. We store them to sync between your devices and your team.</Text>
      </Card>
      <Card>
        <Text style={text.body}>We never sell your data. Audio is only shared with people your project leader adds.</Text>
      </Card>
      <View style={styles.rowBetween}>
        <Text style={text.body}>I accept</Text>
        <Switch value={accepted} onValueChange={setAccepted} />
      </View>
    </Screen>
  );
}

const VISION = [
  { icon: Headphones, body: 'Listen to the passage.' },
  { icon: Mic, body: 'Speak it in your language.' },
  { icon: Users, body: 'Your community listens and responds.' },
  { icon: Eye, body: 'Leaders see progress without opening files.' },
  { icon: Send, body: 'Everything syncs when you reach a connection.' }
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
          label={last ? 'Get started' : 'Next'}
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
      <Header title="LangQuest vision" onBack={() => ctx.go('terms_privacy')} />
      <View style={styles.center}>
        <Icon size={72} color={colors.translate} />
        <Text style={[text.h4, { textAlign: 'center' }]}>{VISION[step]!.body}</Text>
        <View style={styles.dots}>
          {VISION.map((_, i) => (
            <View key={i} style={[styles.dot, i === step && { backgroundColor: colors.action, width: 24 }]} />
          ))}
        </View>
      </View>
    </Screen>
  );
}

export function IntentChooser(ctx: Ctx) {
  // Oral-first: joining by an invite QR is the one yellow action. Creating an
  // org or requesting access by code are advanced, so they sit behind a
  // secondary button instead of competing with the scan.
  const [advanced, setAdvanced] = useState(false);
  return (
    <Screen
      footer={
        <ActionButton
          label={advanced ? 'Hide options' : 'More options'}
          accessibilityLabel={advanced ? 'Hide options' : 'More options'}
          variant="outline"
          onPress={() => setAdvanced(!advanced)}
        />
      }
    >
      <View style={[styles.center, { minHeight: 360 }]}>
        <IconCircleButton icon={QrCode} size={180} accessibilityLabel="Join with QR code" onPress={() => ctx.go('scan_qr')} />
      </View>
      {advanced ? (
        <Section label="Advanced">
          <Row icon={Building2} label="Create an organization" sub="You become its admin" onPress={() => ctx.go('create_org')} />
          <Row icon={Users} label="Join an existing org" sub="Ask an admin for access" onPress={() => ctx.go('request_access')} last />
        </Section>
      ) : null}
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
    <Screen footer={<Footer label={busy ? 'Creating...' : 'Create organization'} onPress={() => void create()} />}>
      <Header title="Create a new organization" onBack={ctx.back} />
      <Note>Creating an organization presets standard roles, a passage template, and a one-step community review flow. You can change all of it later.</Note>
      {error ? <Note>{error}</Note> : null}
      <TextInput style={styles.input} placeholder="Organization name" value={name} onChangeText={setName} />
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
        <Note>{request?.status === 'sent' ? 'Request sent. An admin can now review it.' : request?.status === 'failed' ? request.error : 'Request saved on this device. It sends when you have a connection.'}</Note>
      ) : (
        <>
          <Note>Ask an organization to let you in. Until someone accepts, you see nothing of theirs.</Note>
          <TextInput style={styles.input} placeholder="organization code" autoCapitalize="none" value={orgId} onChangeText={setOrgId} />
          <TextInput style={styles.input} placeholder="message (optional)" value={message} onChangeText={setMessage} />
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
        ctx.go('sign_in');
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
      <Header title="Join with an invite" onBack={ctx.back} />
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

const WALK = [
  'Your organization holds projects.',
  'A project has one source and one or more target languages.',
  'Passages are the units of work.',
  'Members get roles: translator, reviewer, coordinator.',
  'Assign passages, then watch Status.',
  'Everything works offline and syncs later.',
  'Replay this any time from Settings.'
];

export function Walkthrough(ctx: Ctx) {
  const [error, setError] = useState('');
  const finish = () => { void recordUserEvent(ctx.session.actorId, 'v1.WalkthroughDone').then(ctx.home).catch((e) => setError(e.message)); };
  const [step, setStep] = useState(0);
  const last = step === WALK.length - 1;
  return (
    <Screen
      footer={
        <Footer
          label={last ? 'Done' : 'Next'}
          onPress={() => (last ? finish() : setStep(step + 1))}
          secondary={{ label: 'Skip', onPress: ctx.home }}
        />
      }
    >
      {error ? <Note>{error}</Note> : null}
      <Header title="Organization walkthrough" sub={`Step ${step + 1} of ${WALK.length}`} />
      <Card>
        <Text style={text.h4}>{WALK[step]}</Text>
      </Card>
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
