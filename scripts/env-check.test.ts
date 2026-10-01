import { readFileSync } from 'node:fs';
import { committableEnvFiles, misplacedKeys, plaintextKeys } from './env-check.mjs';

const root = new URL('..', import.meta.url);

describe('env files', () => {
  it('flags plaintext values and nothing else', () => {
    const src = [
      '# comment',
      'DOTENV_PUBLIC_KEY_PREVIEW="03abc"',
      'EMPTY=',
      'QUOTED_EMPTY=""',
      'SEALED="encrypted:BDx9"',
      'BARE=encrypted:BDx9',
      'LEAK=hunter2',
      'export QUOTED_LEAK="https://example.supabase.co"',
      'EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co'
    ].join('\n');
    expect(plaintextKeys(src)).toEqual(['LEAK', 'QUOTED_LEAK']);
  });

  it('keeps secrets out of the app\'s files and public settings out of the secrets files', () => {
    expect(misplacedKeys('apps/mobile/.env.preview', 'EXPO_PUBLIC_A=x\nSERVICE_KEY="encrypted:x"')).toEqual(['SERVICE_KEY']);
    expect(misplacedKeys('.env.preview', 'DOTENV_PUBLIC_KEY_PREVIEW="03"\nEXPO_PUBLIC_A=x\nRELAY="encrypted:x"')).toEqual(['EXPO_PUBLIC_A']);
  });

  it('every env file git would commit keeps its secrets encrypted and in place', () => {
    const problems = committableEnvFiles(root.pathname).flatMap((file) => {
      const src = readFileSync(new URL(file, root), 'utf8');
      return [...plaintextKeys(src), ...misplacedKeys(file, src)].map((key) => `${file}: ${key}`);
    });
    expect(problems).toEqual([]);
  });
});
