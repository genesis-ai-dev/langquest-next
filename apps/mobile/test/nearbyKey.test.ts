/**
 * The install key on an iPhone (src/server/nearbyKey.native.ts; decision 217 as amended): in the
 * Keychain for this device only (`deviceOnlyStorage`), so a restored iPhone makes a new key. The
 * Keychain also outlives the app, so a key an earlier install of LangQuest left on this iPhone,
 * with none of the batches it numbered, is not taken up: the app's own storage marks the key this
 * install made.
 */

const fake = vi.hoisted(() => ({ keychain: new Map<string, string>(), plain: new Map<string, string>(), os: 'ios', bytes: 1 }));
vi.mock('react-native', () => ({ Platform: { get OS() { return fake.os; } } }));
vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(n).fill(fake.bytes++) }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => fake.plain.get(k) ?? null,
    setItem: async (k: string, v: string) => { fake.plain.set(k, v); },
    removeItem: async (k: string) => { fake.plain.delete(k); }
  }
}));
// The device-only store alone: nothing else of this app's may hold the key.
vi.mock('../src/server/secureStorage', () => ({
  deviceOnlyStorage: {
    getItem: async (k: string) => fake.keychain.get(k) ?? null,
    setItem: async (k: string, v: string) => { fake.keychain.set(k, v); },
    removeItem: async (k: string) => { fake.keychain.delete(k); }
  }
}));

async function load() {
  vi.resetModules();
  return import('../src/server/nearbyKey.native');
}

beforeEach(() => {
  fake.keychain.clear();
  fake.plain.clear();
  fake.os = 'ios';
  fake.bytes = 1;
});

describe('the install key on an iPhone', () => {
  it('is made once, kept in the device-only Keychain, and read back', async () => {
    const key = await load();
    expect(await key.installKey()).toBeNull();
    const made = (await key.ensureInstallKey())!;
    expect(fake.keychain.has('nearby-install-key')).toBe(true);
    expect((await key.installKey())?.publicKey).toBe(made.publicKey);
    expect((await key.ensureInstallKey())?.publicKey).toBe(made.publicKey);
  });

  it("does not take up a key an earlier install left in the Keychain, and makes a new one", async () => {
    let key = await load();
    const earlier = (await key.ensureInstallKey())!;
    // The app is deleted and installed again: its own storage goes, the Keychain stays.
    fake.plain.clear();
    key = await load();
    expect(await key.installKey()).toBeNull();
    const fresh = (await key.ensureInstallKey())!;
    expect(fresh.publicKey).not.toBe(earlier.publicKey);
    expect((await key.installKey())?.publicKey).toBe(fresh.publicKey);
  });

  it('goes whole when forgotten', async () => {
    const key = await load();
    await key.ensureInstallKey();
    await key.forgetInstallKey();
    expect(fake.keychain.size).toBe(0);
    expect(fake.plain.size).toBe(0);
    expect(await key.installKey()).toBeNull();
  });

  it('on Android needs no mark: the Keystore goes with the app', async () => {
    fake.os = 'android';
    const key = await load();
    const made = (await key.ensureInstallKey())!;
    expect(fake.plain.size).toBe(0);
    expect((await key.installKey())?.publicKey).toBe(made.publicKey);
  });
});
