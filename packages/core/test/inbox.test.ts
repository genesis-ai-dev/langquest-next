import { fold } from '../src/reducer';
import { deriveInbox } from '../src/inbox';
import { foldOrg } from '../src/org';
import { withOrgMembers } from '../src/orgPartition';
import type { AnyEvent } from '../src/events';
import { buildFixture } from './fixtures';

describe('inbox eligibility', () => {
  const events = buildFixture().filter(e => !e.parentEventId);
  it('hides inbox entries from outsiders and removed members', () => {
    const state = fold(events);
    expect(deriveInbox(state, 'stranger')).toEqual([]);
    expect(deriveInbox(state, 'gone')).toEqual([]);
  });
  it('offers review only after submission and before a decision', () => {
    const pending = events.filter(e => e.type !== 'v1.ReviewSubmitted');
    expect(deriveInbox(fold(pending), 'r1').some(
      item => item.kind === 'review_requested')).toBe(true);
    expect(deriveInbox(fold(pending.filter(e =>
      e.type !== 'v1.TakeSubmitted')), 'r1')).toEqual([]);
    expect(deriveInbox(fold(events), 'r1').some(
      item => item.kind === 'review_requested')).toBe(false);
  });
  it('keeps decision identities stable across repeated projection passes', () => {
    const first = deriveInbox(fold(events), 't1');
    expect(first.some(item => item.kind === 'decision')).toBe(true);
    expect(deriveInbox(fold([...events, ...events]), 't1')).toEqual(first);
  });
  it('partitions org grants without broadening lane grants or mutating state', () => {
    const orgEvents = [
      ['v1.RoleDefined', { roleId:'translate', name:'Translator', privileges:['translate'] }],
      ['v1.OrgMemberAdded', { profileId:'new', roleId:'translate', scope:{ level:'org' } }],
      ['v1.OrgMemberAdded', { profileId:'lane', roleId:'translate', scope:{ level:'lane', partitionId:'p1', laneId:'L1' } }],
      ['v1.OrgMemberAdded', { profileId:'elsewhere', roleId:'translate', scope:{ level:'partition', partitionId:'p2' } }]
    ].map(([type,payload], i) => ({ ...events[0], id:`org-${i}`,
      partitionId:'_org', type, payload, hlc:`1700000000000:00000${i}:test` }) as AnyEvent);
    const original = fold(events);
    const projected = withOrgMembers(original, foldOrg(orgEvents), 'p1');
    expect(projected.members.new?.role.value).toBe('translator');
    expect(projected.members.lane).toBeUndefined();
    expect(projected.members.elsewhere).toBeUndefined();
    expect(original.members.new).toBeUndefined();
    expect(projected.members.lead).toEqual(original.members.lead);
  });
});
