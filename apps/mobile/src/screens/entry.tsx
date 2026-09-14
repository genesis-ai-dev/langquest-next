// Avatar U (text fallback). Entry, onboarding, and no-org screens. One action each.
import { Building2, Compass, Eye, Headphones, Mic, QrCode, ScanLine, Send, Users } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Footer, Header, Note, NotWired, Row, Screen, Section } from '../pui';
import { supabase } from '../supabase';
import { colors, space } from '../theme';
import { ActionButton, Card, text } from '../ui';

const SAMPLE_PASSAGES = ['Luke 1:1-4', 'Luke 1:5-25', 'Luke 1:26-38', 'Luke 1:39-56'];

export function SignIn(ctx: Ctx) {
  const [email, setEmail] = useState(ctx.isDev ? (process.env.EXPO_PUBLIC_DEV_EMAIL ?? '') : '');
  const [password, setPassword] = useState(ctx.isDev ? (process.env.EXPO_PUBLIC_DEV_PASSWORD ?? '') : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
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
        <Text style={[text.muted, { textAlign: 'center' }]}>Create account</Text>
      </Pressable>
      <Pressable onPress={() => ctx.go('explore_home')} hitSlop={8}>
        <Text style={[text.muted, { textAlign: 'center' }]}>Browse public projects</Text>
      </Pressable>
      {ctx.isDev ? (
        <Pressable onPress={ctx.openDev} hitSlop={8}>
          <Text style={[text.small, { textAlign: 'center' }]}>Dev: personas</Text>
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
  return (
    <Screen footer={<Footer label="Continue" onPress={() => ctx.go('vision')} disabled={!accepted} />}>
      <Header title="Terms & Privacy" onBack={ctx.back} />
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
              ctx.markVisionSeen();
              ctx.home();
            } else setStep(step + 1);
          }}
          secondary={step > 0 ? { label: 'Back', onPress: () => setStep(step - 1) } : undefined}
        />
      }
    >
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
  return (
    <Screen>
      <Header title="What do you want to do?" />
      <Section label="Get started">
        <Row icon={Building2} label="Create an organization" sub="You become its admin" onPress={() => ctx.go('create_org')} />
        <Row icon={Users} label="Join an existing org" sub="Ask an admin for access" onPress={() => ctx.go('request_access')} />
        <Row icon={QrCode} label="Join with QR code" onPress={() => ctx.go('scan_qr')} />
        <Row icon={Compass} label="Explore projects" onPress={() => ctx.go('explore_home')} last />
      </Section>
    </Screen>
  );
}

/**
 * Avatar P. Creating an organization here creates the first project with
 * sample passages and makes you its owner. Organizations above projects
 * come with multi-project support (PLAN.md section 13).
 */
export function CreateOrg(ctx: Ctx) {
  const [name, setName] = useState('');
  async function create() {
    const { append } = ctx.project;
    const me = ctx.session.actorId;
    await append('v1.ProjectCreated', { name: name.trim() || 'Luke', sourceLanguoidId: 'eng' });
    await append('v1.MemberAdded', { profileId: me, role: 'owner' });
    await append('v1.ProjectConfigChanged', {
      config: {
        unitKinds: [
          { id: 'book', label: 'Book', childKinds: ['passage'] },
          { id: 'passage', label: 'Passage', childKinds: [] }
        ],
        workflow: [{ id: 'community', role: 'reviewer', required: true, rule: 'any' }]
      }
    });
    await append('v1.LaneAdded', { laneId: 'L1', languoidId: 'und' });
    await append('v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a' });
    for (const [i, label] of SAMPLE_PASSAGES.entries()) {
      const unitId = `luke-${i}`;
      await append('v1.UnitAdded', { unitId, parentUnitId: 'luke', kind: 'passage', label, order: `a${i}` });
      await append('v1.ReferenceAttached', { unitId, refId: `${unitId}-terms`, kind: 'key_terms', text: 'Theophilus, eyewitnesses, orderly account' });
    }
    ctx.go('walkthrough');
  }
  return (
    <Screen footer={<Footer label="Create organization" onPress={() => void create()} />}>
      <Header title="Create a new organization" onBack={ctx.back} />
      <Note>Creating an organization presets standard roles, a passage template, and a one-step community review flow. You can change all of it later.</Note>
      <TextInput style={styles.input} placeholder="Organization name" value={name} onChangeText={setName} />
    </Screen>
  );
}

export function ExploreHome(ctx: Ctx) {
  return (
    <Screen>
      <Header title="Explore projects" onBack={ctx.back} action={ctx.session.hasNoOrg ? undefined : undefined} />
      <NotWired what="The public project list" />
      {ctx.session.actorId === 'guest' ? <Footer label="Sign in" onPress={() => ctx.go('sign_in')} /> : null}
    </Screen>
  );
}

export function RequestAccess(ctx: Ctx) {
  const [sent, setSent] = useState(false);
  return (
    <Screen footer={<Footer label={sent ? 'Back' : 'Send request'} onPress={() => (sent ? ctx.go('intent_chooser') : setSent(true))} />}>
      <Header title="Request access" onBack={ctx.back} />
      {sent ? <Note>Request sent. An admin will add you.</Note> : <NotWired what="Choosing an organization to ask" />}
    </Screen>
  );
}

export function ScanQr(ctx: Ctx) {
  return (
    <Screen footer={<Footer label="Capture" onPress={ctx.home} />}>
      <Header title="Scan QR code" onBack={ctx.back} />
      <View style={[styles.center, { minHeight: 240 }]}>
        <QrCode size={120} color={colors.mutedForeground} />
      </View>
      <NotWired what="The camera and invite decoding" />
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
  const [step, setStep] = useState(0);
  const last = step === WALK.length - 1;
  return (
    <Screen
      footer={
        <Footer
          label={last ? 'Done' : 'Next'}
          onPress={() => (last ? ctx.home() : setStep(step + 1))}
          secondary={{ label: 'Skip', onPress: ctx.home }}
        />
      }
    >
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
