import { readFileSync } from 'node:fs';

import { APP_KEY, appCertKeys, appendCertKey, appEnvFile, certKeyEntries, withWorkerCertKeys, workerCertKeys, WRANGLER } from './nearby-cert-keys.mjs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const KEY_A = 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w';
const KEY_B = '7UkoxijRwsbq6QM4kFmVYSlZJzpcY_k2NsFGFKyHN9E';

/** Nearby sync's trusted keys (docs/nearby-sync-plan.md 5.12): the Worker's list and the app's are one list. */
describe('nearby sync\'s public keys', () => {
  it('are the same list for the Worker and the app, in each hosted environment', () => {
    for (const env of ['production', 'preview']) {
      const worker = workerCertKeys(read(WRANGLER), env);
      expect(worker, env).toBe(appCertKeys(read(appEnvFile(env))));
      expect(() => certKeyEntries(worker), env).not.toThrow();
    }
  });

  it('reads the app\'s list from its plain file, quoted or not, and none as empty', () => {
    expect(appCertKeys(`A=1\n${APP_KEY}="k1:${KEY_A}"\n`)).toBe(`k1:${KEY_A}`);
    expect(appCertKeys(`${APP_KEY}=k1:${KEY_A},k2:${KEY_B}`)).toBe(`k1:${KEY_A},k2:${KEY_B}`);
    expect(appCertKeys('EXPO_PUBLIC_API_URL=x\n')).toBe('');
  });

  it('grows by one new kid at a time, and refuses an entry that is not kid:key', () => {
    expect(appendCertKey('', `k1:${KEY_A}`)).toBe(`k1:${KEY_A}`);
    expect(appendCertKey(`k1:${KEY_A}`, `k2:${KEY_B}`)).toBe(`k1:${KEY_A},k2:${KEY_B}`);
    expect(() => appendCertKey(`k1:${KEY_A}`, `k1:${KEY_B}`)).toThrow(/already listed/);
    for (const bad of [KEY_A, `k1:${KEY_A}=`, `k 1:${KEY_A}`, `k1:${KEY_A.slice(1)}`]) expect(() => appendCertKey('', bad), bad).toThrow();
  });

  it('writes one environment\'s list into wrangler.jsonc and leaves the other and every comment alone', () => {
    const text = read(WRANGLER);
    for (const [env, other] of [['production', 'preview'], ['preview', 'production']] as const) {
      const out = withWorkerCertKeys(text, env, `k1:${KEY_A}`);
      expect(workerCertKeys(out, env)).toBe(`k1:${KEY_A}`);
      expect(workerCertKeys(out, other)).toBe(workerCertKeys(text, other));
      expect(out.split('\n').filter((l) => l.trim().startsWith('//'))).toEqual(text.split('\n').filter((l) => l.trim().startsWith('//')));
    }
    expect(() => withWorkerCertKeys('{ "vars": { "NEARBY_CERT_KEYS": "" } }', 'preview', `k1:${KEY_A}`)).toThrow(/twice/);
  });

  it('are made by a script that hands the private key only to env-update, never to the terminal', () => {
    const script = read('scripts/nearby-signing-key.sh');
    expect(script).toContain('| scripts/env-update.sh "$env" "$KEY"');
    expect(script).toMatch(/^KEY=NEARBY_SIGNING_KEY$/m);
    // The one thing written to a file is the public entry; the private JWK goes to stdout, into the pipe.
    expect(script).toContain('writeFileSync(process.argv[1], `${kid}:${x}\\n`)');
    expect(script).not.toMatch(/console\.(log|error)|echo .*\bd\b|--plain/);
  });
});
