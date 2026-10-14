import { DurableOutbox, DeliveryError } from '../src/durableOutbox';

describe('durable outbox', () => {
  const storageFor = () => {
    const map = new Map<string, string>();
    return {
      getItem: async (key: string) => map.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        map.set(key, value);
      },
      map,
    };
  };

  it('restarts after an offline delivery failure without losing the write', async () => {
    const storage = storageFor();
    const offline = new DurableOutbox('actor1', storage, async () => {
      throw new DeliveryError('offline', true);
    });
    await offline.enqueue({ id: '1', kind: 'profile', payload: { name: 'Ada' } });
    await expect(offline.flush()).resolves.toBe(false);

    // Why: a queued action must survive a restart and be delivered once
    // connectivity comes back, not be stuck forever or silently dropped.
    const deliver = vi.fn(async () => {});
    const restarted = new DurableOutbox('actor1', storage, deliver);
    await expect(restarted.flush()).resolves.toBe(true);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ id: '1', status: 'queued' }));
    await expect(restarted.list()).resolves.toEqual([
      expect.objectContaining({ id: '1', status: 'sent' }),
    ]);
  });

  it('keeps actors isolated in the same storage', async () => {
    const storage = storageFor();
    const alice = new DurableOutbox('alice', storage, vi.fn(async () => {}));
    const bob = new DurableOutbox('bob', storage, vi.fn(async () => {}));

    await alice.enqueue({ id: 'a1', kind: 'user_event', payload: {} });

    await expect(bob.list()).resolves.toEqual([]);
    await expect(alice.list()).resolves.toHaveLength(1);
  });

  it('sends once when flush is called concurrently', async () => {
    const storage = storageFor();
    let resolveDelivery!: () => void;
    const deliver = vi.fn(
      () => new Promise<void>((resolve) => { resolveDelivery = resolve; })
    );
    const outbox = new DurableOutbox('actor1', storage, deliver);
    await outbox.enqueue({ id: '1', kind: 'join_request', payload: { org: 'org1' } });

    const first = outbox.flush();
    const second = outbox.flush();
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));

    resolveDelivery();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
