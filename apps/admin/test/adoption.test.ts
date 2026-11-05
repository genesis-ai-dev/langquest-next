import { describe, expect, it, vi } from 'vitest';
import { adoptionFrom, adoptionSection, INSTALLS_SQL, type InstallCount } from '../src/sources/adoption';

// Shaped like EAS's answer on 2026-10-26: each publish is a group per platform,
// and iOS and Android run different runtimes.
const IOS_RT = '0c2ad5e07830909c1755879758e77f0c7ae4d94e';
const AND_RT = '045b6480190e433eb433109f526c53f505020d79';
const update = (id: string, platform: string, runtime: string, at: string, rollBackToEmbedded = false) =>
  [{ id, platform, runtimeVersion: runtime, createdAt: at, isRollBackToEmbedded: rollBackToEmbedded }];
const eas = {
  data: { app: { byId: {
    updateChannels: [{ name: 'production', updateBranches: [{ name: 'production' }] }, { name: 'preview', updateBranches: [{ name: 'preview' }] }],
    updateBranches: [
      { name: 'production', updateGroups: [
        update('01a1786d-ios', 'ios', IOS_RT, '2026-10-26T13:36:00Z'), update('01a1786d-and', 'android', AND_RT, '2026-10-26T13:36:00Z'),
        update('01a17868-ios', 'ios', IOS_RT, '2026-10-26T13:30:00Z'), update('01a17867-and', 'android', AND_RT, '2026-10-26T13:30:00Z')
      ] },
      { name: 'preview', updateGroups: [update('01a10ecd-and', 'android', 'old-runtime', '2026-10-06T01:22:00Z', true)] }
    ]
  } } }
};
const count = (over: Partial<InstallCount> & { n: number }): InstallCount =>
  ({ channel: 'production', platform: 'android', runtime: AND_RT, embedded: false, updateId: '01a1786d-and', ...over });

describe('update adoption', () => {
  it('counts installs on the newest update, an older one, and the embedded one, per channel, platform and runtime', () => {
    const rows = adoptionFrom(eas, [
      count({ n: 6 }),
      count({ updateId: '01a17867-and', n: 3 }),
      count({ updateId: 'gone-from-eas', n: 1 }),
      count({ embedded: true, updateId: 'embedded-manifest', n: 2 }),
      count({ platform: 'ios', runtime: IOS_RT, updateId: '01a17868-ios', n: 4 })
    ]);
    expect(rows).toEqual([
      { channel: 'production', platform: 'android', runtime: AND_RT, newest: { id: '01a1786d-and', at: '2026-10-26T13:36:00Z', rollBackToEmbedded: false },
        installs: 12, onNewest: 6, older: 4, embedded: 2 },
      { channel: 'production', platform: 'ios', runtime: IOS_RT, newest: { id: '01a1786d-ios', at: '2026-10-26T13:36:00Z', rollBackToEmbedded: false },
        installs: 4, onNewest: 0, older: 4, embedded: 0 }
    ]);
  });

  it('says when nothing was published for a runtime, and counts a rollback to embedded as the newest', () => {
    const rows = adoptionFrom(eas, [
      count({ runtime: 'store-build-only', embedded: true, n: 5 }),
      count({ channel: 'preview', runtime: 'old-runtime', embedded: true, n: 2 })
    ]);
    expect(rows.find((r) => r.runtime === 'store-build-only')).toMatchObject({ newest: null, installs: 5, embedded: 5, onNewest: 0 });
    expect(rows.find((r) => r.channel === 'preview')).toMatchObject({ newest: { rollBackToEmbedded: true }, onNewest: 2, embedded: 0 });
  });

  it('reads phones only, as counts, over the active window', async () => {
    expect(INSTALLS_SQL).toContain("in ('ios', 'android')");
    expect(INSTALLS_SQL).toContain('count(*)');
    const queries: unknown[][] = [];
    const fetcher = vi.fn(async () => Response.json(eas)) as unknown as typeof fetch;
    const diag = async <T,>(fn: (q: (sql: string, params?: (string | number)[]) => Promise<T>) => Promise<T>) =>
      fn(async (sql, params) => { queries.push([sql, params]); return [count({ n: 1 })] as T; });
    const s = await adoptionSection({ ADMIN_EXPO_TOKEN: 't', EXPO_PROJECT_ID: 'p' }, fetcher, diag as never);
    expect(queries).toEqual([[INSTALLS_SQL, [7]]]);
    expect(s).toMatchObject({ state: 'ok', data: { activeDays: 7, rows: [{ onNewest: 1 }] } });
    expect(await adoptionSection({ EXPO_PROJECT_ID: 'p' }, fetcher, diag as never)).toMatchObject({ state: 'off', setup: expect.stringContaining('ADMIN_EXPO_TOKEN') });
  });
});
