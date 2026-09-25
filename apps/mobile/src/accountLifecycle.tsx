// Avatar U. Deletion can be restored during the server-enforced grace period.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Text, View } from 'react-native';
import { supabase } from './supabase';
import { colors, space } from './theme';
import { ActionButton, text } from './ui';
import { translateUi } from './accountPreferences';
export type DeletionStatus = { requestedAt?: string; deleteAfter?: string; erased?: boolean };
const listeners = new Set<() => void>();
export async function requestAccountDeletion() {
  const { data, error } = await supabase.rpc('request_account_deletion');
  if (error) throw error;
  const session = await supabase.auth.getSession();
  if (session.data.session) await AsyncStorage.setItem(`account-deletion:${session.data.session.user.id}`, JSON.stringify(data));
  for (const listener of listeners) listener();
}
export function AccountLifecycleBoundary({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DeletionStatus>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    let generation = 0;
    async function refresh() {
      const seq = ++generation;
      const session = await supabase.auth.getSession();
      const id = session.data.session?.user.id;
      if (!id) { if (alive && seq === generation) { setStatus({}); setReady(true); } return; }
      try {
        const cached = JSON.parse(await AsyncStorage.getItem(`account-deletion:${id}`) ?? '{}');
        if (alive && seq === generation) setStatus(cached);
        const result = await supabase.rpc('account_deletion_status');
        if (result.error) throw result.error;
        await AsyncStorage.setItem(`account-deletion:${id}`, JSON.stringify(result.data ?? {}));
        if (alive && seq === generation) { setStatus(result.data ?? {}); setError(''); }
      } catch {
        // Offline work remains available. A cached deletion always blocks it;
        // the server independently rejects suspended JWTs on reconnection.
      } finally { if (alive && seq === generation) setReady(true); }
    }
    const update = () => { void refresh(); };
    listeners.add(update); update();
    const auth = supabase.auth.onAuthStateChange(() => { setTimeout(update, 0); });
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') update(); });
    return () => { alive = false; generation++; listeners.delete(update); auth.data.subscription.unsubscribe(); app.remove(); };
  }, []);
  async function restore() {
    setBusy(true); setError('');
    try {
      const result = await supabase.rpc('restore_account');
      if (result.error) throw result.error;
      const session = await supabase.auth.getSession();
      if (session.data.session) await AsyncStorage.removeItem(`account-deletion:${session.data.session.user.id}`);
      // Deletion revoked refresh sessions; require a fresh sign-in.
      await supabase.auth.signOut({ scope: 'local' });
      setStatus({});
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  if (!status.requestedAt) return <>{children}</>;
  const restorable = !status.erased && !!status.deleteAfter && Date.parse(status.deleteAfter) > Date.now();
  return <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, backgroundColor: colors.background, gap: space.lg }}>
    <Text style={text.h3}>Account deletion requested</Text>
    <Text style={text.body}>{restorable
      ? `Your account is suspended. You can restore it before ${new Date(status.deleteAfter!).toLocaleDateString()}.`
      : 'The restoration period has ended.'}</Text>
    <Text style={text.muted}>Your organization keeps shared recordings and contributions. Personal account details are erased after 30 days.</Text>
    {error ? <Text style={text.body}>{error}</Text> : null}
    {restorable ? <ActionButton label={translateUi('Restore account')} accessibilityLabel="Restore account"
      disabled={busy} onPress={() => void restore()} /> : null}
    <ActionButton label={translateUi('Sign out')} accessibilityLabel="Sign out" variant="outline"
      onPress={() => { void supabase.auth.signOut({ scope: 'local' }); }} />
  </View>;
}
