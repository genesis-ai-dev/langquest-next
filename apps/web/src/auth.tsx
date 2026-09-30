import type { Session } from '@supabase/supabase-js';
import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from './supabase';

export type SessionState = { status: 'loading' } | { status: 'signed_out' } | { status: 'signed_in'; session: Session };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setState(data.session ? { status: 'signed_in', session: data.session } : { status: 'signed_out' });
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: 'signed_in', session } : { status: 'signed_out' });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return state;
}

/** The same account as the phone app: email and password. */
export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { error: failed } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (failed) setError(navigator.onLine ? failed.message : 'No connection. Sign in when you are back online.');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <form className="card signin-card" onSubmit={(e) => void submit(e)} aria-labelledby="signin-title">
        <h1 id="signin-title">LangQuest dashboard</h1>
        <p className="muted">Sign in with the account you use in the LangQuest app.</p>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error ? <p className="notice notice-red" role="alert">{error}</p> : null}
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  // The server refuses a session it no longer knows (a deleted account, a
  // reset database); this browser must still end up signed out.
  if (error) await supabase.auth.signOut({ scope: 'local' });
}
