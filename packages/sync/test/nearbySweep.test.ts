import { FakeServer } from '../src/testing/fakeServer';
import { SimDevice } from '../src/testing/fleet/device';
import { shapeTransport } from '../src/testing/shapedTransport';
import type { Transport } from '../src/types';
import { LANG, ORG } from './nearbyFixtures';

describe('the lists that wrap a transport', () => {
  // Why: `FakeServer`, `shapeTransport` and `SimDevice.observed` each list the optional methods by hand, and a list that
  // misses one turns its feature off and says nothing: a fleet scenario would pass with no sweep in it.
  const inner = new FakeServer().transportFor();
  const shape = () => shapeTransport(inner, {
    link: () => ({ latencyMs: 0, bytesPerSecond: Infinity, dropRate: 0, online: () => true }),
    now: () => 0, sleep: async () => undefined, random: () => 0.5
  });
  const observed = () => {
    const device = new SimDevice('d', 'a', null as never, null as never, null as never, { time: { now: () => 0 } } as never, null as never);
    return (device as unknown as { observed(t: Transport): Transport }).observed(inner);
  };

  it('FakeServer has what the sweep and claims ask', () => {
    expect(inner.knownEvents).toBeTypeOf('function');
    expect(inner.attest).toBeTypeOf('function');
  });

  it.each([['shapeTransport', shape], ['SimDevice.observed', observed]])('%s keeps every method', async (_name, wrap) => {
    const wrapped = wrap();
    expect(Object.keys(wrapped).sort()).toEqual(Object.keys(inner).sort());
    expect(await wrapped.knownEvents!(ORG, LANG, [])).toEqual([]);
    expect(await wrapped.attest!(ORG, LANG, 0)).toBeNull();
  });

  it('a transport with neither, wrapped, has neither, so a sweep cannot call what is not there', () => {
    const none = new FakeServer().transportFor();
    delete none.knownEvents;
    delete none.attest;
    const wrapped = shapeTransport(none, {
      link: () => ({ latencyMs: 0, bytesPerSecond: Infinity, dropRate: 0, online: () => true }),
      now: () => 0, sleep: async () => undefined, random: () => 0.5
    });
    expect(wrapped.knownEvents).toBeUndefined();
    expect(wrapped.attest).toBeUndefined();
  });
});
