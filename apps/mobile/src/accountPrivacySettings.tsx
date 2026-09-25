// Avatar P. Account and device controls are explicit and reversible where possible.
import { useState } from 'react';
import { Switch, Text, TextInput, View } from 'react-native';
import { privacyIcon } from '../modules/privacy-icon';
import { usePreferences, translateUi } from './accountPreferences';
import { PasswordForm } from './accountRecovery';
import { requestAccountDeletion } from './accountLifecycle';
import { supabase } from './supabase';
import { accountOutbox } from './accountData';
import type { Ctx } from './ctx';
import { Row, Section, Note } from './pui';
import { colors, space } from './theme';
import { ActionButton, text } from './ui';

export function AccountPrivacySettings({ ctx }: { ctx: Ctx }) {
  const { preferences, save, pinEnabled, setPin, lock } = usePreferences();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pin, setPinValue] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [current, setCurrent] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true); setMessage('');
    try { await action(); if (success) setMessage(success); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  async function deleteAccount() {
    if ((ctx.project.pending && !ctx.project.refused) || ctx.org.pending > 0) throw new Error('Sync all organization and project changes before deleting your account.');
    if (ctx.project.blobs.pendingUp > 0 || ctx.project.saving) throw new Error('Wait for recordings to finish saving and uploading before deleting your account.');
    const actions = await accountOutbox(ctx.session.actorId).list();
    if (actions.some((a) => a.status !== 'sent')) throw new Error('Sync your saved account changes before deleting your account.');
    if (!ctx.session.email) throw new Error('Sign in with your account email first.');
    const auth = await supabase.auth.signInWithPassword({ email: ctx.session.email, password: deletePassword });
    if (auth.error) throw auth.error;
    await requestAccountDeletion();
    setDeletePassword('');
  }
  const input = { backgroundColor: colors.card, color: colors.foreground, padding: space.md };
  return <>
    <Section label={translateUi('Appearance')}>
      {(['system', 'light', 'dark'] as const).map((theme) => <Row key={theme}
        label={translateUi(theme[0]!.toUpperCase() + theme.slice(1))} badge={preferences.theme === theme ? '✓' : undefined}
        onPress={() => void run(() => save({ theme }))} />)}
    </Section>
    <Section label={translateUi('App language')}>
      {([['en', 'English'], ['es', 'Español'], ['fr', 'Français']] as const).map(([language, label]) =>
        <Row key={language} label={label} badge={preferences.language === language ? '✓' : undefined}
          onPress={() => void run(() => save({ language }))} />)}
      <Note>Navigation and account controls use this language. Project content keeps its original language.</Note>
    </Section>
    <Section label={translateUi('Privacy and security')}>
      <Row label={translateUi('Change password')} onPress={() => setPasswordOpen(!passwordOpen)} />
      {passwordOpen ? <PasswordForm onDone={() => { setPasswordOpen(false); setMessage('Password updated.'); }} /> : null}
      <Row label={translateUi('Disguise icon')} sub="Use a neutral Notes launcher icon. iPhone keeps the app name."
        right={<Switch value={preferences.disguise} disabled={busy || !privacyIcon}
          onValueChange={(disguise) => void run(async () => {
            if (!privacyIcon) throw new Error('Install the latest native build to change the icon.');
            await privacyIcon.setDisguised(disguise); await save({ disguise });
          })} />} />
      {!privacyIcon ? <Note>Changing the launcher icon requires the updated Android or iPhone build.</Note> : null}
      <Row label={translateUi('Entry PIN')} sub={pinEnabled ? 'Enabled on this device' : 'Disabled on this device'} />
      {pinEnabled ? <TextInput style={input} placeholder="Current PIN" accessibilityLabel="Current PIN"
        secureTextEntry keyboardType="number-pad" value={current} onChangeText={setCurrent} maxLength={12} /> : null}
      <TextInput style={input} placeholder="New PIN (6–12 digits)" accessibilityLabel="New PIN"
        secureTextEntry keyboardType="number-pad" value={pin} onChangeText={setPinValue} maxLength={12} />
      <TextInput style={input} placeholder="Confirm new PIN" accessibilityLabel="Confirm new PIN"
        secureTextEntry keyboardType="number-pad" value={confirmation} onChangeText={setConfirmation} maxLength={12} />
      <ActionButton variant="outline" label={translateUi('Set PIN')} accessibilityLabel="Set PIN"
        disabled={busy || !/^\d{6,12}$/.test(pin) || pin !== confirmation}
        onPress={() => void run(async () => { await setPin(pin, current); setPinValue(''); setConfirmation(''); setCurrent(''); }, 'PIN saved on this device.')} />
      {pinEnabled ? <>
        <ActionButton variant="outline" label={translateUi('Remove PIN')} accessibilityLabel="Remove PIN"
          disabled={busy || !current} onPress={() => void run(async () => { await setPin('', current); setCurrent(''); }, 'PIN removed.')} />
        <Row label={translateUi('Lock now')} onPress={lock} />
      </> : null}
      <Note>The PIN hides the app when you leave it. Keep your device passcode enabled. Reinstalling can remove local work and device security.</Note>
      <Row label={translateUi('Delete account')} onPress={() => setDeleteOpen(!deleteOpen)} />
      {deleteOpen ? <View style={{ padding: space.md, gap: space.md }}>
        <Text style={text.body}>Your account stops working immediately. You can restore it for 30 days. Your organization keeps shared contributions.</Text>
        <TextInput style={input} placeholder="Account password" accessibilityLabel="Account password"
          secureTextEntry value={deletePassword} onChangeText={setDeletePassword} />
        <TextInput style={input} placeholder="Type DELETE" accessibilityLabel="Type DELETE to confirm"
          autoCapitalize="characters" value={deleteConfirmation} onChangeText={setDeleteConfirmation} />
        <ActionButton variant="outline" label={translateUi('Delete account')} accessibilityLabel="Confirm account deletion"
          disabled={busy || deleteConfirmation !== 'DELETE' || !deletePassword}
          onPress={() => void run(deleteAccount)} />
      </View> : null}
    </Section>
    {message ? <Note>{message}</Note> : null}
  </>;
}
