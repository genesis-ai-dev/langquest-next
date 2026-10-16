import { liveSessions } from '../worker/liveSessions';

describe('whether a token\'s session is still live', () => {
  // Why: a verified access token outlives its session by up to an hour, so a
  // lost phone signed out from another one kept reading recordings until then.
  it('refuses a session that is gone, and asks once per while', async () => {
    let asked = 0;
    let t = 0;
    const live = liveSessions(async (id) => { asked++; return id === 'here'; }, 30_000, () => t);
    expect(await live('here')).toBe(true);
    expect(await live('gone')).toBe(false);
    expect(await live('here')).toBe(true);
    expect(asked).toBe(2);
    t = 31_000;
    expect(await live('here')).toBe(true);
    expect(asked).toBe(3);
  });

  it('lets a verified token stand when the question cannot be answered', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const live = liveSessions(async () => { throw new Error('down'); });
    expect(await live('any')).toBe(true);
    err.mockRestore();
  });
});
