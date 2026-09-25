// Avatar U. Recovery links open one password action above normal navigation.
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Modal, Text, TextInput, View } from 'react-native';
import { supabase } from './supabase';
import { colors, space } from './theme';
import { ActionButton, text } from './ui';
import { translateUi, usePreferences } from './accountPreferences';

import { parseRecoveryLink, recoveryRedirect } from './recoveryLink';
export { parseRecoveryLink, recoveryRedirect } from './recoveryLink';
export async function requestPasswordReset(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Enter your email address first.');
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryRedirect });
  if (error) throw error;
}
export function PasswordForm({ onDone, recovery = false }: { onDone: () => void; recovery?: boolean }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nonce, setNonce] = useState('');
  const [needsNonce, setNeedsNonce] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError('');
    try {
      const result = await supabase.auth.updateUser({ password, ...(needsNonce ? { nonce } : {}) });
      if (result.error) {
        if (result.error.code === 'reauthentication_needed') {
          const check = await supabase.auth.reauthenticate();
          if (check.error) throw check.error;
          setNeedsNonce(true); setError('Enter the security code sent to your email.'); return;
        }
        throw result.error;
      }
      setPassword(''); setConfirm(''); onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const input = { backgroundColor: colors.card, color: colors.foreground, padding: space.lg };
  return <View style={{ gap: space.md }}>
    <Text style={text.h3}>{translateUi(recovery ? 'New password' : 'Change password')}</Text>
    <Text style={text.muted}>Use at least 12 characters.</Text>
    <TextInput style={input} accessibilityLabel={translateUi('New password')}
      placeholder={translateUi('New password')} secureTextEntry autoCapitalize="none"
      value={password} onChangeText={setPassword} textContentType="newPassword" />
    <TextInput style={input} accessibilityLabel={translateUi('Confirm password')}
      placeholder={translateUi('Confirm password')} secureTextEntry autoCapitalize="none"
      value={confirm} onChangeText={setConfirm} textContentType="newPassword" />
    {needsNonce ? <TextInput style={input} accessibilityLabel="Email security code" value={nonce}
      onChangeText={setNonce} keyboardType="number-pad" textContentType="oneTimeCode" /> : null}
    {error ? <Text style={[text.body, { color: colors.danger }]}>{error}</Text> : null}
    <ActionButton label={translateUi('Update password')} accessibilityLabel="Update password"
      onPress={() => void save()} disabled={busy || password.length < 12 || password !== confirm || (needsNonce && !nonce)} />
  </View>;
}
export function AccountRecoveryBoundary({ children }: { children: ReactNode }) {
  const { locked } = usePreferences();
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let processing: string | null = null;
    async function handle(url: string | null) {
      if (!url || processing === url) return;
      try {
        const payload = parseRecoveryLink(url);
        if (!payload) return;
        processing = url;
        const result = 'code' in payload
          ? await supabase.auth.exchangeCodeForSession(payload.code)
          : await supabase.auth.setSession({ access_token: payload.accessToken, refresh_token: payload.refreshToken });
        if (result.error) throw result.error;
        if (active) { setError(''); setRecovering(true); }
      } catch (e) { if (active) setError((e as Error).message); }
      finally { processing = null; }
    }
    void Linking.getInitialURL().then(handle);
    const links = Linking.addEventListener('url', ({ url }) => { void handle(url); });
    const auth = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && active) setRecovering(true);
    });
    return () => { active = false; links.remove(); auth.data.subscription.unsubscribe(); };
  }, []);
  return <>{children}<Modal visible={!locked && (recovering || !!error)} animationType="slide" onRequestClose={() => { setRecovering(false); setError(''); }}>
    <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, backgroundColor: colors.background, gap: space.lg }}>
      {recovering ? <PasswordForm recovery onDone={() => setRecovering(false)} /> : null}
      {error ? <Text style={text.body}>{error}</Text> : null}
      <ActionButton variant="outline" label={translateUi('Cancel')} accessibilityLabel="Cancel recovery"
        onPress={() => { setRecovering(false); setError(''); }} />
    </View>
  </Modal></>;
}
