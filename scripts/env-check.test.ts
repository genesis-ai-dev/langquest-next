import { readFileSync } from 'node:fs';
import { committableEnvFiles, plaintextKeys } from './env-check.mjs';

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
      'export QUOTED_LEAK="https://example.supabase.co"'
    ].join('\n');
    expect(plaintextKeys(src)).toEqual(['LEAK', 'QUOTED_LEAK']);
  });

  it('every env file git would commit is encrypted', () => {
    const leaks = committableEnvFiles(root.pathname).flatMap((file) =>
      plaintextKeys(readFileSync(new URL(file, root), 'utf8')).map((key) => `${file}: ${key}`)
    );
    expect(leaks).toEqual([]);
  });
});
