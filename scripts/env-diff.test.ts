import { diffEnv } from './env-diff.mjs';

describe('env diff', () => {
  it('reports added, changed and EAS-only keys, ignoring the public key header', () => {
    const repo = ['DOTENV_PUBLIC_KEY_PREVIEW="03aa"', 'SAME=1', 'CHANGED="new"', 'ADDED=x'].join('\n');
    const eas = ['# Environment: preview', 'SAME=1', 'CHANGED=old', 'STRAY=y'].join('\n');
    expect(diffEnv(repo, eas)).toEqual({ added: ['ADDED'], changed: ['CHANGED'], remoteOnly: ['STRAY'] });
  });

  it('treats quoting differences as equal', () => {
    expect(diffEnv('A="https://x.supabase.co"', 'A=https://x.supabase.co')).toEqual({ added: [], changed: [], remoteOnly: [] });
  });
});
