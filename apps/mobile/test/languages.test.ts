import { foldOrg, type AnyEvent } from '@langquest-next/core';
import { openLanguage } from '../src/languages';

let seq = 0;
const org = (events: [string, unknown][]) => foldOrg(events.map(([type, payload]) => ({
  id: `e${++seq}`, type, orgId: 'o', partitionId: '_org', actorId: 'lead', deviceId: 'd', hlc: `${String(seq).padStart(15, '0')}:000000:d`, payload
}) as AnyEvent));

describe('the language a phone opens (decision 37)', () => {
  const o = org([
    ['v1.PartitionRegistered', { partitionId: 'L-nus', name: 'Nuer' }],
    ['v1.PartitionRegistered', { partitionId: 'L-din', name: 'Dinka' }],
    ['v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate'] }],
    ['v1.OrgMemberAdded', { profileId: 'akol', roleId: 'translator', scope: { level: 'lane', partitionId: 'L-nus', laneId: 'L-nus' } }]
  ]);

  it('opens the language a screen is about, then the last one opened, then your own, then the first by name', () => {
    expect(openLanguage(o, 'akol', { param: 'L-din', saved: 'L-nus' })).toEqual({ laneId: 'L-din', partitionId: 'L-din' });
    expect(openLanguage(o, 'akol', { saved: 'L-din' }).laneId).toBe('L-din');
    expect(openLanguage(o, 'akol', {}).laneId).toBe('L-nus');
    expect(openLanguage(o, 'lead', {}).laneId).toBe('L-din');
  });

  it('ignores a language the organization does not have, and opens an empty partition before it has any', () => {
    expect(openLanguage(o, 'lead', { param: 'L-gone', saved: 'L-other' }).laneId).toBe('L-din');
    expect(openLanguage(org([]), 'lead', {})).toEqual({ laneId: null, partitionId: 'work' });
  });
});
