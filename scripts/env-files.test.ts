import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { envPath, environmentOf, publicKey, publicKeyMismatches, root } from './env-files.mjs';

// Files still encrypted with a key their environment's other files do not
// use. Re-key each (docs/environments.md, re-keying), then delete it here.
const PENDING_REKEY = ['supabase/.env.production'];

describe('env files', () => {
  it('names one file per target and environment', () => {
    expect(envPath('supabase', 'preview')).toBe('supabase/.env.preview');
    expect(envPath('invite-email', 'production')).toBe('apps/invite-email/.env.production');
    expect(() => envPath('mobile', 'staging')).toThrow();
    expect(environmentOf('apps/web/.env.preview')).toBe('preview');
    expect(environmentOf('apps/mobile/.env.development.local')).toBeNull();
  });

  it('reads the public key with or without its trailing comment', () => {
    expect(publicKey('DOTENV_PUBLIC_KEY_PREVIEW="03ab" # -fk ../../.env.keys', 'preview')).toBe('03ab');
    expect(publicKey('DOTENV_PUBLIC_KEY_PREVIEW=03ab', 'preview')).toBe('03ab');
    expect(publicKey('DOTENV_PUBLIC_KEY_PRODUCTION="03ab"', 'preview')).toBeNull();
  });

  it('names the file whose key differs from the rest of its environment', () => {
    const k = (env: string, key: string) => `DOTENV_PUBLIC_KEY_${env.toUpperCase()}="${key}"`;
    expect(publicKeyMismatches([
      { file: 'apps/mobile/.env.production', text: k('production', 'aa') },
      { file: 'apps/web/.env.production', text: k('production', 'aa') },
      { file: 'supabase/.env.production', text: k('production', 'bb') },
      { file: 'apps/mobile/.env.preview', text: k('preview', 'cc') },
      { file: 'supabase/.env.preview', text: '' }
    ])).toEqual(['supabase/.env.preview', 'supabase/.env.production']);
  });

  it('opens every committed file of an environment with that environment\'s one key', () => {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps/*/.env.*', 'supabase/.env.*'], { cwd: root, encoding: 'utf8' })
      .split('\n').filter((file) => environmentOf(file))
      .map((file) => ({ file, text: readFileSync(`${root}/${file}`, 'utf8') }));
    expect(publicKeyMismatches(files).filter((file) => !PENDING_REKEY.includes(file))).toEqual([]);
  });
});
