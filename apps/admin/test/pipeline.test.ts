import { describe, expect, it } from 'vitest';
import {
  androidLane, iosLane, newerVersion, otaRows, pipelineAlerts, pipelineFrom, pipelineSection, PIPELINE_QUERY,
  type PipelineInputs, type StoreLane
} from '../src/sources/pipeline';

/**
 * Where each store build and update is (sources/pipeline.ts): each build in
 * the stage it is in now, from what Expo, App Store Connect and Google Play
 * say. The world below is the one of 2026-11-04: build 50 in review on both
 * stores, build 52 waiting behind it, an iPhone build 53 building.
 */

const NOW = Date.parse('2026-11-04T22:00:00Z');
const hAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const RT_OLD = 'aaaaaaaa1111', RT_NEW = '4f198b13ffff';

function world(over: Partial<PipelineInputs> = {}): PipelineInputs {
  return {
    builds: [
      { platform: 'ios', status: 'IN_PROGRESS', at: hAgo(0.2), doneAt: null, version: '2026.1104.2130', build: '53', runtime: RT_NEW },
      { platform: 'ios', status: 'FINISHED', at: hAgo(5), doneAt: hAgo(4.5), version: '2026.1104.1802', build: '52', runtime: RT_NEW },
      { platform: 'android', status: 'FINISHED', at: hAgo(5), doneAt: hAgo(4.5), version: '2026.1104.1802', build: '52', runtime: RT_NEW },
      { platform: 'ios', status: 'FINISHED', at: hAgo(23), doneAt: hAgo(22.5), version: '2026.1103.2251', build: '50', runtime: RT_NEW },
      { platform: 'android', status: 'FINISHED', at: hAgo(23), doneAt: hAgo(22.5), version: '2026.1103.2251', build: '50', runtime: RT_NEW },
      { platform: 'android', status: 'FINISHED', at: hAgo(130), doneAt: hAgo(129), version: '2026.1030.1319', build: '48', runtime: RT_OLD }
    ],
    submissions: [
      { platform: 'android', status: 'FINISHED', at: hAgo(4.4), doneAt: hAgo(4.3), track: 'internal', version: '2026.1104.1802', build: '52' },
      { platform: 'ios', status: 'FINISHED', at: hAgo(4.4), doneAt: hAgo(4.2), track: null, version: '2026.1104.1802', build: '52' },
      { platform: 'android', status: 'FINISHED', at: hAgo(22), doneAt: hAgo(22), track: 'production', version: '2026.1103.2251', build: '50' }
    ],
    updates: [
      { id: 'u-android-new-0001', platform: 'android', at: hAgo(6), runtime: RT_NEW, commit: 'fc0760f06186', rollBack: false },
      { id: 'u-android-old-0001', platform: 'android', at: hAgo(30), runtime: RT_OLD, commit: '0192ca8b0000', rollBack: false },
      { id: 'u-android-old-0000', platform: 'android', at: hAgo(60), runtime: RT_OLD, commit: '11111111aaaa', rollBack: false },
      { id: 'u-ios-new-0001', platform: 'ios', at: hAgo(6), runtime: RT_NEW, commit: 'fc0760f06186', rollBack: false }
    ],
    apple: {
      versions: [
        { version: '2026.1103.2251', state: 'WAITING_FOR_REVIEW', at: hAgo(20), build: '50' },
        { version: '2026.1030.1319', state: 'DEVELOPER_REJECTED', at: hAgo(120), build: '48' },
        { version: '2026.1026.1817', state: 'READY_FOR_SALE', at: hAgo(220), build: '45' }
      ],
      builds: [
        { version: '2026.1104.1802', build: '52', state: 'VALID', uploadedAt: hAgo(4) },
        { version: '2026.1103.2251', build: '50', state: 'VALID', uploadedAt: hAgo(22) },
        { version: '2026.1030.1319', build: '48', state: 'VALID', uploadedAt: hAgo(120) }
      ]
    },
    play: {
      internal: [{ name: '2026.1104.1802', status: 'completed', versionCodes: ['52'] }],
      production: [{ name: '2026.1103.2251', status: 'completed', versionCodes: ['50'] }, { name: '2026.1030.1319', status: 'completed', versionCodes: ['48'] }]
    },
    playLive: '2026.1030.1319',
    installs: [
      { channel: 'production', platform: 'android', runtime: RT_OLD, embedded: false, updateId: 'u-android-old-0001', n: 4 },
      { channel: 'production', platform: 'android', runtime: RT_OLD, embedded: false, updateId: 'u-android-old-0000', n: 1 },
      { channel: 'production', platform: 'android', runtime: RT_OLD, embedded: true, updateId: null, n: 1 },
      { channel: 'production', platform: 'ios', runtime: RT_NEW, embedded: false, updateId: 'u-ios-new-0001', n: 2 },
      { channel: 'preview', platform: 'ios', runtime: RT_NEW, embedded: false, updateId: 'x', n: 9 }
    ],
    notes: { ios: [], android: [], ota: [] },
    ...over
  };
}

/** Each stage's cards as "title: state", for reading a lane at a glance. */
const read = (lane: StoreLane) => Object.fromEntries(lane.stages.map((s) => [s.id, s.cards.map((c) => `${c.title}: ${c.state}`)]));

describe('the iPhone lane', () => {
  it('puts each build in its stage: building, waiting in TestFlight behind the review, in review, on the App Store', () => {
    expect(read(iosLane(world()))).toEqual({
      building: ['build 53: building'],
      waiting: ['build 52: waits for the review ahead of it to end'],
      review: ['build 50: waiting for review'],
      approved: [],
      live: ['build 45: what people download']
    });
  });

  it('shows a rejection as needing a person, and an approved build on its way out', () => {
    const w = world();
    w.apple!.versions[0] = { ...w.apple!.versions[0]!, state: 'REJECTED' };
    expect(read(iosLane(w)).review).toEqual(['build 50: rejected: answer Apple in App Store Connect, or a newer build replaces it']);
    expect(iosLane(w).stages.find((s) => s.id === 'review')!.cards[0]!.tone).toBe('bad');
    w.apple!.versions[0] = { ...w.apple!.versions[0]!, state: 'PENDING_DEVELOPER_RELEASE' };
    expect(read(iosLane(w))).toMatchObject({ review: [], approved: ['build 50: approved, waits for someone to release it'] });
  });

  it('leaves out a rejection that a newer version in review took the place of', () => {
    const w = world();
    w.apple!.versions.splice(1, 0, { version: '2026.1101.1000', state: 'REJECTED', at: hAgo(60), build: '49' });
    expect(read(iosLane(w)).review).toEqual(['build 50: waiting for review']);
  });

  it('says what EAS sent to TestFlight when App Store Connect cannot be read', () => {
    const lane = iosLane(world({ apple: null, notes: { ios: ['App Store Connect is not connected.'], android: [], ota: [] } }));
    expect(read(lane)).toMatchObject({ waiting: ['build 52: uploaded to TestFlight'], review: [], live: [] });
    expect(lane.notes).toEqual(['App Store Connect is not connected.']);
  });
});

describe('the Android lane', () => {
  it('puts the newest internal build behind the production release Google has not approved yet', () => {
    expect(read(androidLane(world()))).toEqual({
      building: [],
      waiting: ['build 52: waits for the review ahead of it to end'],
      review: ['build 50: in review, or rejected (Play Console says which)'],
      live: ['build 48: what people download']
    });
  });

  it('shows the production release as live once Play\'s page shows it, and an internal build ready to go', () => {
    const lane = androidLane(world({ playLive: '2026.1103.2251' }));
    expect(read(lane)).toMatchObject({ waiting: ['build 52: waits to be sent for review'], review: [], live: ['build 50: what people download'] });
  });

  it('falls back on where EAS sent each build when Play\'s tracks cannot be read', () => {
    const lane = androidLane(world({ play: null, notes: { ios: [], android: ["Play's tracks are not connected."], ota: [] } }));
    expect(read(lane)).toMatchObject({
      waiting: ['build 52: waits for the review ahead of it to end'],
      review: ['build 50: in review, or rejected (Play Console says which)'],
      live: ['build 48: what people download']
    });
    expect(lane.notes).toEqual(["Play's tracks are not connected."]);
  });

  it('says so when Play\'s page cannot be read', () => {
    const lane = androidLane(world({ playLive: null }));
    expect(read(lane)).toMatchObject({ review: ['build 50: in review or out (the page could not be read)'], live: [] });
    expect(lane.notes[0]).toContain("Google Play's page could not be read");
  });

  it('shows an upload that is running or failed', () => {
    const w = world();
    w.submissions.unshift({ platform: 'android', status: 'ERRORED', at: hAgo(1), doneAt: hAgo(0.9), track: 'internal', version: '2026.1104.2000', build: '53' });
    expect(read(androidLane(w)).waiting).toContain('build 53: upload to Google Play failed');
    w.submissions[0] = { ...w.submissions[0]!, status: 'IN_PROGRESS', track: 'production' };
    expect(read(androidLane(w)).review).toContain('build 53: uploading to production');
  });
});

describe('over-the-air updates', () => {
  it('lead from each platform and runtime\'s newest update to the store builds that take it and the phones on it', () => {
    const lanes = [iosLane(world()), androidLane(world())];
    const rows = otaRows(world(), lanes);
    expect(rows.map((r) => `${r.platform} ${r.update.title}`)).toEqual(['android update u-androi', 'ios update u-ios-ne', 'android update u-androi']);
    expect(rows[0]!.builds).toEqual([
      { title: 'build 52', version: '2026.1104.1802', where: 'Internal testing', tone: 'wait' },
      { title: 'build 50', version: '2026.1103.2251', where: 'Play review', tone: 'wait' }
    ]);
    // Nobody runs the new runtime on Android yet: build 50 is still in review.
    expect(rows[0]!.phones).toEqual({ on: 0, of: 0 });
    expect(rows[2]!.builds).toEqual([{ title: 'build 48', version: '2026.1030.1319', where: 'On Google Play', tone: 'live' }]);
    expect(rows[2]!.phones).toEqual({ on: 4, of: 6 });
    expect(rows[1]!.phones).toEqual({ on: 2, of: 2 });
  });

  it('counts the build\'s own code as the newest after a rollback to it, and nothing without the database', () => {
    const w = world({ updates: [{ id: 'u-back', platform: 'android', at: hAgo(1), runtime: RT_OLD, commit: null, rollBack: true }] });
    const rows = otaRows(w, []);
    expect(rows[0]!.update.state).toBe('back to the build\'s own code');
    expect(rows[0]!.phones).toEqual({ on: 1, of: 6 });
    expect(rows[0]!.builds[0]!.where).toBe('an older build');
    expect(otaRows(world({ installs: null }), [])[0]!.phones).toBeNull();
  });
});

describe('a build that waits with nothing ahead of it', () => {
  it('is worth a look after a few hours, with how to move it', () => {
    expect(pipelineAlerts(pipelineFrom(world()), NOW)).toEqual([]);
    const alerts = pipelineAlerts(pipelineFrom(world({ playLive: '2026.1103.2251' })), NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.level).toBe('watch');
    expect(alerts[0]!.text).toMatch(/^Android build 52 has waited in internal testing for 4 h with nothing in review\. .*PLAY_REVIEW_KEY/);
    // Not yet after an hour.
    const fresh = world({ playLive: '2026.1103.2251' });
    fresh.builds = fresh.builds.map((b) => (b.build === '52' ? { ...b, doneAt: hAgo(1) } : b));
    expect(pipelineAlerts(pipelineFrom(fresh), NOW)).toEqual([]);
  });
});

describe('versions', () => {
  it('compare as numbers, part by part', () => {
    expect(newerVersion('2026.1104.1802', '2026.1103.2251')).toBe(true);
    expect(newerVersion('2026.1104.802', '2026.1104.1802')).toBe(false);
    expect(newerVersion('2026.1104.1802', '2026.1104.1802')).toBe(false);
    expect(newerVersion(null, '1.0.0')).toBe(false);
  });
});

describe('reading the sources', () => {
  it('needs the Expo token, and says which', async () => {
    const s = await pipelineSection({ EXPO_PROJECT_ID: 'p', APP_STORE_APP_ID: 'a', GOOGLE_PLAY_PACKAGE: 'com.x' }, (async () => { throw new Error('no call'); }) as never);
    expect(s.state).toBe('off');
    expect(s.setup).toContain('ADMIN_EXPO_TOKEN');
  });

  it('reads Play\'s tracks in an edit it deletes, never commits, and keeps going when a store does not answer', async () => {
    const asked: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      asked.push(`${method} ${url.split('?')[0]}`);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url === 'https://api.expo.dev/graphql') {
        expect(JSON.parse(String(init?.body)).query).toBe(PIPELINE_QUERY);
        return json({ data: { app: { byId: {
          builds: [{ status: 'FINISHED', platform: 'ANDROID', createdAt: hAgo(5), completedAt: hAgo(4.5), appVersion: '2026.1104.1802', appBuildVersion: '52', runtime: { version: RT_NEW } }],
          submissions: [],
          updateBranchByName: { updateGroups: [[{ id: 'u1', platform: 'android', createdAt: hAgo(6), gitCommitHash: 'abc', isRollBackToEmbedded: false, runtime: { version: RT_NEW } }]] }
        } } } });
      }
      if (url.startsWith('https://api.appstoreconnect.apple.com/')) return json({ errors: [{ status: '401' }] }, 401);
      if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 't', expires_in: 3600 });
      if (url.endsWith('/edits') && method === 'POST') return json({ id: 'e1' });
      if (url.endsWith('/edits/e1/tracks')) return json({ tracks: [{ track: 'internal', releases: [{ name: '2026.1104.1802', status: 'completed', versionCodes: ['52'] }] }, { track: 'production', releases: [] }] });
      if (url.endsWith('/edits/e1') && method === 'DELETE') return new Response(null, { status: 204 });
      if (url.startsWith('https://play.google.com/store/apps/details')) return new Response('<script>[[["2026.1030.1319"]],x]</script>');
      return json({ error: 'unexpected' }, 404);
    }) as typeof fetch;
    const key = JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: await rsaPem() });
    const s = await pipelineSection({
      ADMIN_EXPO_TOKEN: 'x', EXPO_PROJECT_ID: 'p', ADMIN_APP_STORE_KEY: JSON.stringify({ issuerId: 'i', keyId: 'k', privateKey: await ecPem() }), APP_STORE_APP_ID: '6812492008',
      ADMIN_GOOGLE_PLAY_KEY: key, GOOGLE_PLAY_PACKAGE: 'com.frontierrnd.langquestnext'
    }, fetcher, NOW, null);
    expect(s.state).toBe('ok');
    const d = s.data!;
    expect(read(d.lanes[1]!)).toMatchObject({ waiting: ['build 52: waits to be sent for review'], live: ['version 2026.1030.1319: what people download'] });
    expect(d.lanes[0]!.notes[0]).toMatch(/^App Store Connect could not be read \(App Store versions: HTTP 401/);
    expect(asked).toContain('DELETE https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.frontierrnd.langquestnext/edits/e1');
    expect(asked.some((a) => a.includes(':commit') || a.startsWith('PUT') || a.startsWith('PATCH'))).toBe(false);
    expect(d.ota).toHaveLength(1);
    expect(d.ota[0]!.phones).toBeNull();
  });
});

async function rsaPem() {
  const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return pem(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)));
}
async function ecPem() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return pem(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)));
}
const pem = (der: Uint8Array) => `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
