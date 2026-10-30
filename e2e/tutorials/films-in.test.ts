import { FILMED_RULE } from '../../apps/web/worker/tutorialFilmed';
import { FILMED_API, sayFilmsIn } from './films-in.mjs';

/** The filming telling the app's Worker its films are in (decisions.md 192). */

const env = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner' };

describe('the films are in', () => {
  it('asks GitHub for a token for the Worker\'s door, and knocks with it', async () => {
    expect(FILMED_API).toBe(FILMED_RULE.audience);
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetcher = async (input: string, init?: RequestInit) => {
      calls.push({ input, init });
      return input === FILMED_API ? Response.json({ intake: 'started' }) : Response.json({ value: 'oidc' });
    };
    expect(await sayFilmsIn(env, fetcher)).toEqual({ ok: true, said: '{"intake":"started"}' });
    expect(calls.map((c) => c.input)).toEqual([`${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encodeURIComponent(FILMED_API)}`, FILMED_API]);
    expect(calls[0]!.init?.headers).toEqual({ authorization: 'bearer runner' });
    expect(calls[1]!.init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer oidc' } });
  });

  it('says why when it could not, and never throws: the intake at midnight takes the films in', async () => {
    expect((await sayFilmsIn({})).ok).toBe(false);
    expect(await sayFilmsIn(env, async (input) => (input === FILMED_API ? new Response('nope', { status: 401 }) : Response.json({ value: 'oidc' }))))
      .toEqual({ ok: false, said: `${FILMED_API}: HTTP 401 nope` });
    expect(await sayFilmsIn(env, async () => { throw new Error('offline'); })).toEqual({ ok: false, said: 'offline' });
  });
});
