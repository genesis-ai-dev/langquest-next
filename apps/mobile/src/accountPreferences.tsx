// Avatar P. Device preferences and the entry PIN gate apply to every session.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { createClient } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, Appearance, Modal, Platform, Text, TextInput, View } from 'react-native';
import { applyTheme, colors, space } from './theme';
import { ActionButton, text } from './ui';
import { applyUiLanguage, translateUi } from './uiLanguage';
import { supabase, supabaseUrl, supabaseAnonKey } from './supabase';
export { translateUi } from './uiLanguage';

export type Preferences = { theme: 'system' | 'light' | 'dark'; language: 'en' | 'es' | 'fr'; disguise: boolean };
const defaults: Preferences = { theme: 'system', language: 'en', disguise: false };
const preferenceKey = 'device-preferences:v1';
const pinKey = 'langquest.entry-pin.v1';
type PinRecord = { salt: string; hash: string; actorId: string; failures: number; blockedUntil: number };
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const Context = createContext({ preferences: defaults, pinEnabled: false, locked: true,
  save: async (_value: Partial<Preferences>) => {}, setPin: async (_pin: string, _current?: string) => {},
  lock: () => {}, revision: 0 });
export const usePreferences = () => useContext(Context);
async function readPin(): Promise<PinRecord | null> {
  if (Platform.OS === 'web') return null;
  const raw = await SecureStore.getItemAsync(pinKey, options);
  if (!raw) return null;
  const value = JSON.parse(raw) as PinRecord;
  if (!value.salt || !/^[a-f0-9]{64}$/.test(value.hash)
    || !Number.isInteger(value.failures) || value.failures < 0
    || !Number.isFinite(value.blockedUntil)) throw new Error('PIN storage is unavailable. Restart the app.');
  return value;
}
async function digest(pin: string, salt: string) {
  // The verifier lives in OS protected storage; never persist the PIN itself.
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}
async function verifyPin(pin: string) {
  const record = await readPin();
  if (!record) return;
  if (record.blockedUntil > Date.now()) throw new Error(`Try again in ${Math.ceil((record.blockedUntil - Date.now()) / 1000)} seconds.`);
  if (await digest(pin, record.salt) !== record.hash) {
    record.failures += 1;
    record.blockedUntil = record.failures >= 5
      ? Date.now() + Math.min(3600000, 30000 * 2 ** (record.failures - 5)) : 0;
    await SecureStore.setItemAsync(pinKey, JSON.stringify(record), options);
    throw new Error('Incorrect PIN.');
  }
  await SecureStore.setItemAsync(pinKey, JSON.stringify({ ...record, failures: 0, blockedUntil: 0 }), options);
}

export function AccountPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [locked, setLocked] = useState(true);
  const [pin, setPinValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [revision, setRevision] = useState(0);
  const [systemDark, setSystemDark] = useState(Appearance.getColorScheme() === 'dark');
  useEffect(() => {
    let active = true;
    void Promise.all([AsyncStorage.getItem(preferenceKey).catch(() => null), readPin()]).then(([raw, record]) => {
      if (!active) return;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          setPreferences({
            theme: ['system', 'light', 'dark'].includes(parsed?.theme) ? parsed.theme : 'system',
            language: ['en', 'es', 'fr'].includes(parsed?.language) ? parsed.language : 'en',
            disguise: parsed?.disguise === true
          });
        } catch { setPreferences(defaults); }
      }
      setPinEnabled(!!record); setLocked(!!record); setReady(true);
    }).catch((e) => { if (active) setError(e.message); });
    const appearance = Appearance.addChangeListener(({ colorScheme }) => setSystemDark(colorScheme === 'dark'));
    return () => { active = false; appearance.remove(); };
  }, []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && pinEnabled) { setLocked(true); setPinValue(''); }
    });
    return () => listener.remove();
  }, [pinEnabled]);
  applyTheme(preferences.theme === 'dark' || (preferences.theme === 'system' && systemDark));
  applyUiLanguage(preferences.language);
  async function save(value: Partial<Preferences>) {
    const next = { ...preferences, ...value };
    await AsyncStorage.setItem(preferenceKey, JSON.stringify(next));
    setPreferences(next); setRevision((n) => n + 1);
  }
  async function setPin(next: string, current?: string) {
    if (Platform.OS === 'web') throw new Error('The PIN gate requires an Android or iPhone build.');
    if (pinEnabled) await verifyPin(current ?? '');
    if (!next) { await SecureStore.deleteItemAsync(pinKey, options); setPinEnabled(false); return; }
    if (!/^\d{6,12}$/.test(next)) throw new Error('Use 6 to 12 digits.');
    const session = await supabase.auth.getSession();
    const actorId = session.data.session?.user.id;
    if (!actorId) throw new Error('Sign in before setting a PIN.');
    const salt = Crypto.randomUUID();
    await SecureStore.setItemAsync(pinKey, JSON.stringify({ actorId, salt, hash: await digest(next, salt), failures: 0, blockedUntil: 0 }), options);
    setPinEnabled(true);
  }
  async function unlock() {
    if (busy) return;
    setBusy(true); setError('');
    try { await verifyPin(pin); setPinValue(''); setLocked(false); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function resetPin() {
    if (busy) return;
    setBusy(true); setError('');
    // Verify independently so a wrong account cannot replace the app session.
    const verifier = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    try {
      const record = await readPin();
      const result = await verifier.auth.signInWithPassword({ email: resetEmail.trim(), password: resetPassword });
      if (result.error || !record?.actorId || result.data.user?.id !== record.actorId) {
        throw new Error('Use the account that set this PIN.');
      }
      await SecureStore.deleteItemAsync(pinKey, options);
      setPinEnabled(false); setLocked(false); setResetting(false);
      setResetPassword(''); setResetEmail('');
    } catch (e) { setError((e as Error).message); }
    finally { await verifier.auth.signOut({ scope: 'local' }).catch(() => {}); setBusy(false); }
  }
  return <Context.Provider value={{ preferences, save, pinEnabled, setPin, locked, lock: () => setLocked(true), revision }}>
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1 }} accessibilityElementsHidden={locked}
        importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}>
        {ready ? children : null}
      </View>
      {!ready || locked ? <View style={{ position: 'absolute', inset: 0,
        backgroundColor: colors.background, zIndex: 99999 }} /> : null}
      <Modal visible={!ready || locked} animationType="none" onRequestClose={() => {}}>
        <View style={{ flex: 1, backgroundColor: colors.background,
          justifyContent: 'center', padding: space.xl, gap: space.lg }} accessibilityViewIsModal>
        <Text style={text.h3}>{preferences.disguise ? 'Notes' : translateUi('Entry PIN')}</Text>
        {ready && !resetting ? <>
          <TextInput accessibilityLabel={translateUi('Entry PIN')} secureTextEntry keyboardType="number-pad"
            value={pin} onChangeText={setPinValue} maxLength={12}
            style={{ color: colors.foreground, backgroundColor: colors.card, padding: space.lg }} />
          <ActionButton label={translateUi('Unlock')} accessibilityLabel="Unlock" disabled={busy || !pin}
            onPress={() => void unlock()} />
          <ActionButton label="Forgot PIN?" accessibilityLabel="Forgot PIN" variant="outline"
            onPress={() => { setError(''); setResetting(true); }} />
        </> : ready ? <>
          <Text style={text.body}>Sign in online with the account that set this PIN to remove it.</Text>
          <TextInput accessibilityLabel="Account email" placeholder="Email" autoCapitalize="none"
            keyboardType="email-address" value={resetEmail} onChangeText={setResetEmail}
            style={{ color: colors.foreground, padding: space.lg, backgroundColor: colors.card }} />
          <TextInput accessibilityLabel="Account password" placeholder="Password" secureTextEntry
            value={resetPassword} onChangeText={setResetPassword}
            style={{ color: colors.foreground, padding: space.lg, backgroundColor: colors.card }} />
          <ActionButton label="Remove PIN" accessibilityLabel="Remove PIN" disabled={busy || !resetEmail || !resetPassword}
            onPress={() => void resetPin()} />
          <ActionButton label="Cancel" accessibilityLabel="Cancel" variant="outline" disabled={busy}
            onPress={() => { setResetPassword(''); setError(''); setResetting(false); }} />
        </> : <Text style={text.body}>Loading device security…</Text>}
        {error ? <Text style={[text.body, { color: colors.danger }]}>{error}</Text> : null}
        </View>
      </Modal>
    </View>
  </Context.Provider>;
}
