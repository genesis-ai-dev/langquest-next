import { appendConfirmed, fetchOrgReports, fetchOrgSummary, NotSavedError, ReportsError, type ReportsServer } from '../src/reports';
import { FakeServer } from './fakeServer';

/** The dashboard's server as a device asks it (decision 44): HTTP only, faked here. */

const asOf = '2026-10-03T12:00:00.000Z';

function server(answer: (url: string, headers: Record<string, string>) => Response | Promise<Response>, token: string | null = 't'): ReportsServer & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    baseUrl: 'https://next.example',
    token: async () => token,
    fetch: (async (url: string, init?: RequestInit) => {
      urls.push(url);
      return answer(url, (init?.headers ?? {}) as Record<string, string>);
    }) as typeof fetch
  };
}

describe('fetching reports', () => {
  it('asks for the summary view, sends what it holds, and hears that nothing changed', async () => {
    const s = server((_url, headers) => headers['if-none-match'] === '"a"'
      ? new Response(null, { status: 304, headers: { etag: '"a"', 'x-as-of': asOf } })
      : new Response(JSON.stringify({ rows: [], asOf }), { status: 200, headers: { etag: '"a"' } }));
    const first = await fetchOrgSummary(s, 'org 1', { fresh: true });
    expect(first).toEqual({ status: 'changed', body: { rows: [], asOf }, etag: '"a"' });
    expect(s.urls[0]).toBe('https://next.example/api/orgs/org%201/reports?fresh=1&view=summary');
    expect(await fetchOrgSummary(s, 'org 1', { etag: '"a"' })).toEqual({ status: 'unchanged', asOf, etag: '"a"' });
  });

  it('tells offline, a refusal and a missing session apart', async () => {
    const down = server(() => { throw new TypeError('fetch failed'); });
    await expect(fetchOrgReports(down, 'o')).rejects.toMatchObject({ offline: true });
    const refused = server(() => new Response(JSON.stringify({ error: 'You are not a member of this organization.' }), { status: 403 }));
    await expect(fetchOrgReports(refused, 'o')).rejects.toEqual(new ReportsError('You are not a member of this organization.', 403));
    const signedOut = server(() => new Response('{}'), null);
    await expect(fetchOrgReports(signedOut, 'o')).rejects.toMatchObject({ status: 401 });
    expect(signedOut.urls).toEqual([]);
  });
});

describe('appendConfirmed', () => {
  const who = { orgId: 'org1', projectId: 'p1', actorId: 'a1', deviceId: 'd1' };

  it('resolves only once the server has the event', async () => {
    const fake = new FakeServer();
    await appendConfirmed({ ...who, transport: fake.transportFor() }, 'v1.LaneCountrySet', { laneId: 'din', country: 'SS' });
    expect(fake.log.map((e) => e.type)).toEqual(['v1.LaneCountrySet']);
  });

  it('says why nothing was saved', async () => {
    const offline = new FakeServer();
    offline.offline = true;
    await expect(appendConfirmed({ ...who, transport: offline.transportFor() }, 'v1.LaneCountrySet', { laneId: 'din', country: 'SS' }))
      .rejects.toEqual(new NotSavedError('No connection. Nothing was saved; try again when you are back online.', 'offline'));
    const refusing = new FakeServer();
    refusing.authorize = () => 'may not emit v1.LaneCountrySet';
    await expect(appendConfirmed({ ...who, transport: refusing.transportFor() }, 'v1.LaneCountrySet', { laneId: 'din', country: 'SS' }))
      .rejects.toMatchObject({ reason: 'refused' });
  });
});
