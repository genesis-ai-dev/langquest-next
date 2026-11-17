import type { NativeCapabilities } from '../modules/nearby-link';

/**
 * Share nearby's prompt on an iPhone (src/nearby/nearbyPermissions.ios.ts; docs/nearby-sync-plan.md
 * section 7, phase 5): Bluetooth is read from the module's facts and asked through `askPermission()`,
 * a refusal reads as blocked, since iOS asks only once, and the prompt counts as asking while it is
 * up (`askingForNearby`), so it is not leaving the screen.
 */

const fake = vi.hoisted(() => ({ granted: false, answer: false, asked: 0, settings: 0, version: '17.4', module: true }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', get Version() { return fake.version; } },
  Linking: { openSettings: async () => { fake.settings += 1; } }
}));
vi.mock('../modules/nearby-link', () => ({
  nearbyLinkNative: () => (fake.module ? {
    capabilities: async () => ({ granted: fake.granted } as Partial<NativeCapabilities>),
    askPermission: async () => { fake.asked += 1; fake.granted = fake.answer; return fake.answer; }
  } : null)
}));

async function load() {
  vi.resetModules();
  return import('../src/nearby/nearbyPermissions.ios');
}

beforeEach(() => {
  Object.assign(fake, { granted: false, answer: false, asked: 0, settings: 0, version: '17.4', module: true });
});

describe("an iPhone's Bluetooth prompt", () => {
  it('is an iPhone at its iOS major version, never an Android API level', async () => {
    const p = await load();
    expect(p.phoneSystem()).toEqual({ os: 'ios', sdk: 17 });
    fake.version = '26.1';
    expect(p.phoneSystem()).toEqual({ os: 'ios', sdk: 26 });
  });

  it('reads Bluetooth from the module with no prompt: allowed, or still to ask', async () => {
    const p = await load();
    expect(await p.checkNearbyPermissions()).toEqual({ BLUETOOTH: 'denied' });
    fake.granted = true;
    expect(await p.checkNearbyPermissions()).toEqual({ BLUETOOTH: 'granted' });
    expect(fake.asked).toBe(0);
  });

  it('asks through the module, and is allowed', async () => {
    const p = await load();
    fake.answer = true;
    expect(await p.askNearbyPermissions(['BLUETOOTH'])).toEqual({ BLUETOOTH: 'granted' });
    expect(fake.asked).toBe(1);
    expect(await p.checkNearbyPermissions()).toEqual({ BLUETOOTH: 'granted' });
  });

  it('reads a refusal as blocked, since iOS will not ask again, and opens the settings', async () => {
    const p = await load();
    expect(await p.askNearbyPermissions(['BLUETOOTH'])).toEqual({ BLUETOOTH: 'never_ask_again' });
    // A check afterwards remembers it, so the screen shows Open settings and not a button that asks nothing.
    expect(await p.checkNearbyPermissions()).toEqual({ BLUETOOTH: 'never_ask_again' });
    // Allowed in the settings meanwhile: allowed.
    fake.granted = true;
    expect(await p.checkNearbyPermissions()).toEqual({ BLUETOOTH: 'granted' });
    await p.openNearbySettings();
    expect(fake.settings).toBe(1);
  });

  it('counts as asking while the prompt is up, so the app going inactive is not leaving', async () => {
    const p = await load();
    let during = false;
    fake.answer = true;
    const asked = p.askNearbyPermissions(['BLUETOOTH']);
    during = p.askingForNearby();
    await asked;
    expect(during).toBe(true);
    expect(p.askingForNearby()).toBe(false);
  });

  it('asks nothing for anything but Bluetooth, and nothing where the build has no module', async () => {
    const p = await load();
    expect(await p.askNearbyPermissions([])).toEqual({});
    expect(fake.asked).toBe(0);
    fake.module = false;
    expect(await p.checkNearbyPermissions()).toEqual({});
    expect(await p.askNearbyPermissions(['BLUETOOTH'])).toEqual({});
  });
});
