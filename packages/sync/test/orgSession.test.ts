import { HlcClock, orgName } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { OrgSession } from '../src/orgSession';
import { FakeServer } from '../src/testing/fakeServer';

function phone() {
  const server = new FakeServer();
  const wall = { t: 0 };
  const open = () => OrgSession.open({
    orgId: 'org1', actorId: 'akol', deviceId: 'phone', store: new MemoryStore(), transport: server.transportFor(),
    client: { clock: new HlcClock('phone', () => (wall.t += 1)), newId: () => `e${(wall.t += 1)}` }
  });
  return { server, open };
}

describe('OrgSession: the organization stream on a device (decisions.md 103)', () => {
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
