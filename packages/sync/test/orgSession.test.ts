import { HlcClock, orgName } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { OrgSession } from '../src/orgSession';
import { FakeServer } from '../src/testing/fakeServer';

function phone(onSettled?: () => void) {
  const server = new FakeServer();
  const wall = { t: 0 };
  const open = () => OrgSession.open({
    orgId: 'org1', actorId: 'akol', deviceId: 'phone', store: new MemoryStore(), transport: server.transportFor(),
    client: { clock: new HlcClock('phone', () => (wall.t += 1)), newId: () => `e${(wall.t += 1)}` },
    ...(onSettled ? { onSettled } : {})
  });
  return { server, open };
}

describe('OrgSession: the organization stream on a device (decisions.md 104)', () => {
  it('is settled after the first attempt, and pulled only once the server answered', async () => {
    const { server, open } = phone();
    const session = await open();
    server.offline = true;
    await session.sync();
    expect(session.status).toMatchObject({ settled: true, pulled: false });
    server.offline = false;
    await session.sync();
    expect(session.status).toMatchObject({ settled: true, pulled: true });
    session.close();
  });

  it('says whether the fold changed or only the status, so a screen copies the fold only when it must', async () => {
    const { open } = phone();
    const session = await open();
    const told: string[] = [];
    session.subscribe((what) => told.push(what));
    await session.sync();
    expect(told).toContain('status');
    told.length = 0;
    await session.append('v1.OrgRenamed', { name: 'Village team' });
    expect(told[0]).toBe('state');
    expect(orgName(session.state)).toBe('Village team');
    session.close();
  });
});

describe('OrgSession: started, woken and closed', () => {
  it('starts syncing, can be woken, and says nothing once closed', async () => {
    const { open } = phone();
    const session = await open();
    session.start();
    session.wake();
    await until(() => session.status.settled);
    expect((await session.inspect()).pending).toEqual([]);
    let told = 0;
    session.subscribe(() => { told += 1; });
    session.close();
    session.close();
    await session.append('v1.OrgRenamed', { name: 'After' });
    expect(told).toBe(0);
  });

  it('a sync that throws still settles', async () => {
    const server = new FakeServer();
    const session = await OrgSession.open({
      orgId: 'org1', actorId: 'akol', deviceId: 'phone', store: new MemoryStore(), transport: server.transportFor(),
      aroundSync: async () => { throw new Error('boom'); }
    });
    await session.sync();
    expect(session.status).toMatchObject({ settled: true, pulled: false });
    session.close();
  });
});

async function until(ok: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('OrgSession: a moment to send diagnostics', () => {
  it('comes once the server answered and nothing of this person is left to send, or it refused them', async () => {
    // Why: only a language session sent diagnostics, so a phone that never
    // opened a language (a new member, a stuck invite) never sent any.
    let settled = 0;
    const { server, open } = phone(() => { settled += 1; });
    const session = await open();
    await session.append('v1.OrgRenamed', { name: 'Village team' });
    server.offline = true;
    await session.sync();
    expect(settled).toBe(0);
    server.offline = false;
    await session.sync();
    await until(() => settled === 1);
    await session.append('v1.OrgRenamed', { name: 'Another name' });
    server.refuse = 'not a member';
    await session.sync();
    expect(settled).toBe(2);
    session.close();
  });
});
