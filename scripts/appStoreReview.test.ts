import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { nextStep, token } from './app-store-review.mjs';
// @ts-expect-error CommonJS app config, read for its helper
import appConfig from '../apps/mobile/app.config.js';

/**
 * The iPhone half of sending new builds to production review
 * (scripts/app-store-review.mjs, decisions.md 156): never cancel a review,
 * let newer builds wait in TestFlight while one is open, and send only the
 * newest when it ends.
 */

const newest = { id: 'b44', number: 44, version: '2026.1023.915' };

describe('the next step', () => {
  it('sends the newest build when no review is open', () => {
    expect(nextStep({ open: ['COMPLETE'], live: 42, newest, version: null }).action).toBe('submit');
  });

  it('lets the build wait while a review is waiting or under way, and never cancels it', () => {
    for (const state of ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'COMPLETING', 'CANCELING']) {
      const step = nextStep({ open: ['COMPLETE', state], live: 42, newest, version: null });
      expect(step.action, state).toBe('wait');
      expect(step.why).toContain('build 44 waits in TestFlight');
    }
  });

  it('sends only builds newer than the public one', () => {
    expect(nextStep({ open: [], live: 44, newest, version: null }).action).toBe('none');
    expect(nextStep({ open: [], live: null, newest, version: null }).action).toBe('submit');
    expect(nextStep({ open: [], live: 42, newest: null, version: null }).action).toBe('none');
  });

  it('says nothing more about a build whose version is already in review', () => {
    const step = nextStep({ open: ['WAITING_FOR_REVIEW'], live: 42, newest, version: { state: 'WAITING_FOR_REVIEW', build: 44 } });
    expect(step.action).toBe('none');
  });

  it('sends a rejected version again with the newest build', () => {
    expect(nextStep({ open: ['UNRESOLVED_ISSUES'], live: 42, newest, version: { state: 'REJECTED', build: 43 } }).action).toBe('submit');
  });

  it('stops when another build already holds the version number', () => {
    expect(nextStep({ open: [], live: 42, newest, version: { state: 'READY_FOR_SALE', build: 43 } }).action).toBe('stuck');
  });
});

describe('the App Store Connect token', () => {
  it('is an ES256 token for the key, good for 15 minutes', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwt = token({ keyId: 'K1', issuerId: 'I1', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string }, 1_000_000);
    const [head, body, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'K1', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toEqual({ iss: 'I1', iat: 1000, exp: 1900, aud: 'appstoreconnect-v1' });
    expect(verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
  });
});

describe('the store version', () => {
  it('is the merge time in UTC, and grows with it', () => {
    expect(appConfig.storeVersion('2026-10-22T18:30:00Z')).toBe('2026.1022.1830');
    expect(appConfig.storeVersion('2026-10-22T11:30:00-07:00')).toBe('2026.1022.1830');
    expect(appConfig.storeVersion('2027-01-05T00:05:00Z')).toBe('2027.105.5');
    const order = ['2026-10-22T09:05:00Z', '2026-10-22T18:30:00Z', '2026-11-01T00:00:00Z', '2027-01-01T00:00:00Z'].map(appConfig.storeVersion);
    const key = (v: string) => v.split('.').reduce((n, part) => n * 10_000 + Number(part), 0);
    for (let i = 1; i < order.length; i++) expect(key(order[i]), order[i]).toBeGreaterThan(key(order[i - 1]));
  });

  it('keeps app.json\'s version for every build that the workflow on main did not start', () => {
    const before = process.env.LQ_STORE_VERSION_TIME;
    delete process.env.LQ_STORE_VERSION_TIME;
    expect(appConfig({ config: { version: '1.0.0', name: 'x' } }).version).toBe('1.0.0');
    process.env.LQ_STORE_VERSION_TIME = '2026-10-22T18:30:00Z';
    expect(appConfig({ config: { version: '1.0.0', name: 'x' } }).version).toBe('2026.1022.1830');
    if (before === undefined) delete process.env.LQ_STORE_VERSION_TIME;
    else process.env.LQ_STORE_VERSION_TIME = before;
  });
});
