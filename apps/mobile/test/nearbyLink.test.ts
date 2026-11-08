import { OfflineError } from '@langquest-next/sync';
import type { NearbyLink, SeenPhone } from '@langquest-next/sync/nearby';
import { NEARBY_DROP_CODES, type NativeCapabilities, type NearbyLinkEvents } from '../modules/nearby-link';
import { NearbyNativeError, nearbyRadioOver, type NearbyBinding } from '../src/nearby/nearbyLink.android';

/**
 * The nearby module as sync's radio and link (src/nearby/nearbyLink.android.ts; docs/nearby-sync-plan.md
 * 5.12): over a fake binding, every call rejects with `OfflineError` on a drop and names any other
 * code, events come up field for field, and links are kept by id with what `onLinkDown` said.
 */

vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

type Listener = (e: unknown) => void;

const CAPS: NativeCapabilities = {
  sdk: 33, bluetoothLe: true, advertise: true, directByName: true, band5: false, hotspot: true, joinHotspot: true, bluetoothOn: true, wifiOn: true,
  locationOn: false, granted: true
};

/** A binding that records each call and answers as told. */
function fakeBinding() {
  const listeners = new Map<string, Set<Listener>>();
  const calls: [string, ...unknown[]][] = [];
  let nextLink = 0;
  const fail = new Map<string, unknown>();
  const answers = new Map<string, unknown>();
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const method = (name: string) => async (...args: unknown[]) => {
    calls.push([name, ...args]);
    if (fail.has(name)) throw fail.get(name);
    if (name === 'hostLink' || name === 'join' && answers.get('join') === 'wait') {
      return new Promise((resolve, reject) => { pending.set(name, { resolve, reject }); });
    }
    if (answers.has(name)) return answers.get(name);
    if (name === 'openPipe') return `link-${++nextLink}`;
    return null;
  };
  const names = [
    'capabilities', 'configureLinks', 'startFind', 'updateFind', 'stopFind', 'holdScan', 'holdSalt', 'openPipe', 'host', 'hostLink', 'takeDown', 'join',
    'sendOpening', 'receiveOpening', 'secure', 'send', 'receive', 'sendFile', 'receiveFile', 'cancelFile', 'closeLink', 'stopAll'
  ];
  const native = Object.fromEntries(names.map((n) => [n, method(n)])) as unknown as NearbyBinding;
  native.addListener = ((name: string, listener: Listener) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(listener);
    return { remove: () => { listeners.get(name)!.delete(listener); } };
  }) as NearbyBinding['addListener'];
  const emit = <K extends keyof NearbyLinkEvents>(name: K, e: Parameters<NearbyLinkEvents[K]>[0]) => {
    for (const l of [...(listeners.get(name) ?? [])]) l(e);
  };
  return { native, calls, fail, answers, pending, emit, listening: (name: string) => listeners.get(name)?.size ?? 0 };
}

const coded = (code: string) => Object.assign(new Error('native'), { code });

async function pipe(radio: ReturnType<typeof nearbyRadioOver>): Promise<NearbyLink> {
  return radio.openPipe('peer', 'salt', 0);
}

describe('events come up field for field', () => {
  it('hands up a teammate seen as SeenPhone, with rssi only when native sent one, and stops when told', () => {
    const f = fakeBinding();
    const radio = nearbyRadioOver(f.native);
    const seen: SeenPhone[] = [];
    const off = radio.onFound((s) => seen.push(s));
    const base = { peer: 'p', salt: 's', r: 'r', tag: 'aabbccddeeff', summary: '01020304', echo: 'e', connectable: true, scan: 1 };
    f.emit('onFound', { ...base, rssi: -60, extra: 'dropped' } as never);
    f.emit('onFound', base);
    expect(seen).toEqual([{ ...base, rssi: -60 }, base]);
    off();
    f.emit('onFound', base);
    expect(seen).toHaveLength(2);
    expect(f.listening('onFound')).toBe(0);
  });

  it('hands up salts no key matched, this phone\'s salt and Find\'s errors', () => {
    const f = fakeBinding();
    const radio = nearbyRadioOver(f.native);
    const form: unknown[][] = [];
    const salts: string[] = [];
    const errors: string[] = [];
    radio.onFormSalt((...a) => form.push(a));
    radio.onSalt((s) => salts.push(s));
    radio.onFindError((c) => errors.push(c));
    f.emit('onFormSalt', { salt: 'a', rssi: -70 });
    f.emit('onFormSalt', { salt: 'b' });
    f.emit('onSalt', { salt: 'mine' });
    f.emit('onFindError', { code: 'ADVERTISE_FAILED' });
    expect(form).toEqual([['a', -70], ['b']]);
    expect(salts).toEqual(['mine']);
    expect(errors).toEqual(['ADVERTISE_FAILED']);
  });

  it('gives someone who connected as a Bluetooth link bound to its id, which moves no files', async () => {
    const f = fakeBinding();
    const radio = nearbyRadioOver(f.native);
    const got: [NearbyLink, string][] = [];
    radio.onPipe((link, salt) => got.push([link, salt]));
    f.emit('onPipe', { linkId: 'L7', salt: 'S' });
    expect(got).toHaveLength(1);
    const [link, salt] = got[0]!;
    expect([link.kind, link.canMoveFiles, salt]).toEqual(['bluetooth', false, 'S']);
    await link.send(new Uint8Array([1, 2]));
    expect(f.calls.at(-1)).toEqual(['send', 'L7', new Uint8Array([1, 2])]);
  });
});

describe('calls, as the binding wants them', () => {
  it('says only what sync\'s capabilities name, and everything through facts', async () => {
    const f = fakeBinding();
    f.answers.set('capabilities', CAPS);
    const radio = nearbyRadioOver(f.native);
    const { bluetoothLe: _le, granted: _g, ...rest } = CAPS;
    expect(await radio.capabilities()).toEqual(rest);
    expect(await radio.facts()).toEqual(CAPS);
  });

  it('starts Find with every scan key end to end, and refuses a key that is not 32 bytes', async () => {
    const f = fakeBinding();
    const radio = nearbyRadioOver(f.native);
    const k1 = new Uint8Array(32).fill(1);
    const k2 = new Uint8Array(32).fill(2);
    const tunables = { rotateMinMs: 1, rotateMaxMs: 2, scanStartGapMs: 3, scanRestartMs: 4, connectRetries: 5, connectable: 'always' as const };
    await radio.startFind({ kFind: k1, scanKeys: [k1, k2], payload: new Uint8Array(14), r: new Uint8Array(2), tunables });
    const [, kFind, scanKeys, payload, r, sent] = f.calls.at(-1)!;
    expect(kFind).toEqual(k1);
    expect((scanKeys as Uint8Array).length).toBe(64);
    expect([...(scanKeys as Uint8Array).slice(30, 34)]).toEqual([1, 1, 2, 2]);
    expect([(payload as Uint8Array).length, (r as Uint8Array).length]).toEqual([14, 2]);
    expect(sent).toEqual(tunables);
    await expect(radio.startFind({ kFind: k1, scanKeys: [new Uint8Array(31)], payload: new Uint8Array(14), r: new Uint8Array(2), tunables }))
      .rejects.toMatchObject({ name: 'NearbyNativeError', code: 'BAD_ARGUMENT' });
  });

  it('sends a view of a larger buffer as its own bytes, and keys as copies native may zero', async () => {
    const f = fakeBinding();
    const link = await pipe(nearbyRadioOver(f.native));
    const big = new Uint8Array([9, 8, 7, 6, 5]);
    await link.send(big.subarray(1, 3));
    const sent = f.calls.at(-1)![2] as Uint8Array;
    expect([...sent]).toEqual([8, 7]);
    expect(sent.buffer.byteLength).toBe(2);
    const keys = { send: new Uint8Array(32).fill(3), receive: new Uint8Array(32).fill(4) };
    await link.secure(keys);
    const [, , s, r] = f.calls.at(-1)! as [string, string, Uint8Array, Uint8Array];
    s.fill(0);
    r.fill(0);
    expect(keys.send[0]).toBe(3);
    expect(keys.receive[0]).toBe(4);
  });

  it('reads bytes as they come up: null at a clean close, and an array as bytes', async () => {
    const f = fakeBinding();
    const link = await pipe(nearbyRadioOver(f.native));
    f.answers.set('receive', null);
    expect(await link.receive()).toBeNull();
    f.answers.set('receive', [1, 2, 3]);
    expect(await link.receive()).toEqual(new Uint8Array([1, 2, 3]));
    f.answers.set('receiveOpening', new Uint8Array([4]));
    expect(await link.receiveOpening(1, 500)).toEqual(new Uint8Array([4]));
    expect(f.calls.at(-1)).toEqual(['receiveOpening', 'link-1', 1, 500]);
  });

  it('moves files by the link\'s id and answers a received file with its size and hash only', async () => {
    const f = fakeBinding();
    const link = await pipe(nearbyRadioOver(f.native));
    f.answers.set('receiveFile', { size: 10, sha256: 'ab', other: 1 });
    expect(await link.receiveFile({ transferId: 't', stagingUri: 'file:///x.nearby.part', maxBytes: 100, minFreeBytes: 5 })).toEqual({ size: 10, sha256: 'ab' });
    expect(f.calls.at(-1)).toEqual(['receiveFile', 'link-1', 't', 'file:///x.nearby.part', 100, 5]);
    await link.sendFile({ transferId: 't2', uri: 'file:///y', size: 3 });
    expect(f.calls.at(-1)).toEqual(['sendFile', 'link-1', 't2', 'file:///y', 3]);
    await link.cancelFile('t2');
    expect(f.calls.at(-1)).toEqual(['cancelFile', 'link-1', 't2']);
  });
});

describe('a drop rejects with OfflineError', () => {
  it('maps every drop code to OfflineError and any other code to its name', async () => {
    for (const code of NEARBY_DROP_CODES) {
      const f = fakeBinding();
      const link = await pipe(nearbyRadioOver(f.native));
      f.fail.set('send', coded(code));
      await expect(link.send(new Uint8Array(1))).rejects.toBeInstanceOf(OfflineError);
    }
    const f = fakeBinding();
    const radio = nearbyRadioOver(f.native);
    f.fail.set('openPipe', coded('PIPE_TIMEOUT'));
    const refused = await radio.openPipe('p', 's', 0).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(NearbyNativeError);
    expect((refused as NearbyNativeError).code).toBe('PIPE_TIMEOUT');
    f.fail.set('stopFind', new Error('no code'));
    await expect(radio.stopFind()).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('refuses at once, without native, every call on a link onLinkDown named', async () => {
    const f = fakeBinding();
    const radio = nearbyRadioOver(f.native);
    const a = await pipe(radio);
    const b = await pipe(radio);
    f.emit('onLinkDown', { linkId: 'link-1', code: 'LINK_DROPPED' });
    const before = f.calls.length;
    await expect(a.send(new Uint8Array(1))).rejects.toBeInstanceOf(OfflineError);
    await expect(a.receive()).rejects.toBeInstanceOf(OfflineError);
    await expect(a.receiveFile({ transferId: 't', stagingUri: 'u', maxBytes: 1, minFreeBytes: 1 })).rejects.toBeInstanceOf(OfflineError);
    expect(f.calls.length).toBe(before);
    // Another link is untouched.
    await b.send(new Uint8Array(1));
    expect(f.calls.at(-1)?.[1]).toBe('link-2');
  });

  it('closes a link once, and it takes no call after', async () => {
    const f = fakeBinding();
    const link = await pipe(nearbyRadioOver(f.native));
    await link.close();
    await link.close();
    expect(f.calls.filter((c) => c[0] === 'closeLink')).toEqual([['closeLink', 'link-1']]);
    await expect(link.send(new Uint8Array(1))).rejects.toBeInstanceOf(OfflineError);
  });

  it('takes every link down with stopAll', async () => {
    const f = fakeBinding();
    const radio = nearbyRadioOver(f.native);
    const link = await pipe(radio);
    await radio.stopAll();
    expect(f.calls.at(-1)).toEqual(['stopAll']);
    await expect(link.send(new Uint8Array(1))).rejects.toBeInstanceOf(OfflineError);
  });
});

describe('hosting and joining', () => {
  it('hosts with its options and deadline, gives the details, the first link, refusals for this group alone, and takes it down', async () => {
    const f = fakeBinding();
    f.answers.set('host', { hostId: 'H1', kind: 'wifi-direct', ssid: 'DIRECT-ab', passphrase: 'pw', port: 4000, band: '2.4' });
    const radio = nearbyRadioOver(f.native, { hostDeadlineMs: 1234 });
    const hosted = await radio.host('wifi-direct', { ssid: 'DIRECT-ab', passphrase: 'pw', band5: false });
    expect(f.calls.find((c) => c[0] === 'host')).toEqual(['host', 'wifi-direct', { ssid: 'DIRECT-ab', passphrase: 'pw', band5: false }, 1234]);
    expect({ kind: hosted.kind, ssid: hosted.ssid, passphrase: hosted.passphrase, port: hosted.port, band: hosted.band, security: hosted.security })
      .toEqual({ kind: 'wifi-direct', ssid: 'DIRECT-ab', passphrase: 'pw', port: 4000, band: '2.4', security: undefined });
    let refused = 0;
    hosted.onRefused(() => { refused += 1; });
    f.emit('onRefused', { hostId: 'H2' });
    f.emit('onRefused', { hostId: 'H1' });
    expect(refused).toBe(1);
    f.pending.get('hostLink')!.resolve('L9');
    const link = await hosted.link;
    expect([link.kind, link.canMoveFiles]).toEqual(['wifi-direct', true]);
    await hosted.takeDown();
    expect(f.calls.at(-1)).toEqual(['takeDown', 'H1']);
  });

  it('does not leave an abandoned group\'s link as an unhandled rejection', async () => {
    const f = fakeBinding();
    f.answers.set('host', { hostId: 'H1', kind: 'hotspot', port: 1 });
    const hosted = await nearbyRadioOver(f.native).host('hotspot', { band5: false });
    f.pending.get('hostLink')!.reject(coded('HOST_TAKEN_DOWN'));
    await expect(hosted.link).rejects.toMatchObject({ code: 'HOST_TAKEN_DOWN' });
  });

  it('joins with the host\'s details, and says a hotspot join is under way while its dialog may show', async () => {
    const f = fakeBinding();
    f.answers.set('join', 'wait');
    const radio = nearbyRadioOver(f.native, { joinDeadlineMs: 999 });
    const joining = radio.join('hotspot', { kind: 'hotspot', ssid: 'net', passphrase: 'pw', port: 5, security: 'wpa2' });
    await Promise.resolve();
    expect(radio.joiningHotspot()).toBe(true);
    expect(f.calls.at(-1)).toEqual(['join', 'hotspot', { ssid: 'net', passphrase: 'pw', port: 5, security: 'wpa2' }, 999]);
    f.pending.get('join')!.resolve('J1');
    const link = await joining;
    expect([link.kind, link.canMoveFiles, radio.joiningHotspot()]).toEqual(['hotspot', true, false]);
    f.answers.delete('join');
    f.fail.set('join', coded('JOIN_TIMEOUT'));
    await expect(radio.join('hotspot', { kind: 'hotspot' })).rejects.toMatchObject({ code: 'JOIN_TIMEOUT' });
    expect(radio.joiningHotspot()).toBe(false);
  });
});
