// Reporting and blocking (decisions.md 48): what the phone believes about a
// block list while changes wait to send, what a report sends, and how open
// reports read to whoever acts on them.
import { describe, expect, it } from 'vitest';
import type { AccountAction } from '../src/durableOutbox';
import {
  blockedIds, groupReports, personTarget, reportPayload, reportSummary, reportTitle, type OpenReport, type ReportTarget
} from '../src/moderation';

const block = (id: string, profileId: string, blocked: boolean, status: AccountAction['status'] = 'queued'): AccountAction =>
  ({ id, kind: 'block', status, payload: { profileId, blocked } });

describe('the block list', () => {
  it('lays changes on the server\'s list in the order they were made', () => {
    expect(blockedIds(['a'], [block('1', 'b', true), block('2', 'a', false), block('3', 'b', false), block('4', 'b', true)])).toEqual(['b']);
  });

  it('leaves out a change the server refused for good, so the phone agrees with it', () => {
    expect(blockedIds([], [block('1', 'b', true, 'failed')])).toEqual([]);
  });

  it('ignores other account changes', () => {
    const profile: AccountAction = { id: 'p', kind: 'profile', status: 'queued', payload: { displayName: 'Deng' } };
    expect(blockedIds(['a'], [profile])).toEqual(['a']);
  });
});

const note: ReportTarget = { kind: 'note', id: 'n1', profileId: 'deng', orgId: 'org', partitionId: 'din', unitId: 'john3', laneId: 'din' };

describe('a report', () => {
  it('sends what the server checks, trimmed, and leaves out what is empty', () => {
    expect(reportPayload(note, 'offensive', '  rude  ')).toEqual({
      orgId: 'org', partitionId: 'din', kind: 'note', targetId: 'n1', profileId: 'deng', reason: 'offensive',
      details: 'rude', unitId: 'john3', laneId: 'din'
    });
    expect(reportPayload(note, 'spam', '   ')).not.toHaveProperty('details');
    expect(String(reportPayload(note, 'other', 'x'.repeat(2000)).details)).toHaveLength(1000);
  });

  it('about a person goes in the organization\'s partition', () => {
    expect(personTarget(note)).toEqual({ kind: 'person', id: 'deng', profileId: 'deng', orgId: 'org', partitionId: '_org' });
  });
});

const row = (id: string, over: Partial<OpenReport>): OpenReport => ({
  id, partition_id: 'din', target_kind: 'note', target_id: 'n1', unit_id: null, lane_id: null,
  reported_profile: 'deng', reason: 'offensive', details: null, created_at: '2026-09-30T10:00:00Z', ...over
});

describe('open reports for a moderator', () => {
  it('are one item per thing reported, with the reasons most given first and never who reported', () => {
    const groups = groupReports('org', [
      row('r1', { reason: 'spam', details: 'first' }),
      row('r2', { created_at: '2026-09-30T12:00:00Z', details: 'second', unit_id: 'john3', lane_id: 'din' }),
      row('r3', { created_at: '2026-09-30T11:00:00Z' }),
      row('r4', { target_kind: 'person', target_id: 'ayen', reported_profile: 'ayen', partition_id: '_org', created_at: '2026-09-29T00:00:00Z' })
    ]);
    expect(groups).toHaveLength(2);
    const [n, person] = groups;
    expect(n!.count).toBe(3);
    expect(n!.reasons).toEqual(['offensive', 'spam']);
    expect(n!.details).toEqual(['second', 'first']);
    // A later report said where it was.
    expect(n!.target).toMatchObject({ kind: 'note', id: 'n1', profileId: 'deng', unitId: 'john3', laneId: 'din' });
    expect(reportSummary(n!)).toBe('Hateful or offensive, Spam or unrelated · 3 reports');
    expect(reportTitle(n!.target, (id) => id)).toBe('A note was reported');
    expect(reportTitle(person!.target, () => 'Ayen')).toBe('Ayen was reported');
    expect(JSON.stringify(groups)).not.toContain('r1');
  });
});
