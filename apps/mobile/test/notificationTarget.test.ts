// An Inbox row or a tapped push opens the task itself (demo design principle 11):
// an update opens its passage in its language and organization.
import { describe, expect, it } from 'vitest';
import { notificationTarget, openAfterSwitch } from '../src/notificationTarget';

const row = { id: '', org_id: 'org-a', language_id: null as string | null, kind: 'request', unit_id: null as string | null };

describe('notificationTarget', () => {
  it('opens the passage an update is about, in its language', () => {
    const update = { ...row, id: JSON.stringify(['org-a', 'L-din', 'me', 'request:r1']), language_id: 'L-din', unit_id: 'LUK.15.11-32' };
    const to = notificationTarget(update);
    expect(to).toEqual({ kind: 'passage', orgId: 'org-a', languageId: 'L-din', unitId: 'LUK.15.11-32' });
    expect(openAfterSwitch(to)).toEqual({ languageId: 'L-din', unitId: 'LUK.15.11-32' });
  });

  it('reads the request out of a join request row', () => {
    const join = { ...row, kind: 'join_request', id: JSON.stringify(['org-a', 'join', 'admin', 'req-9']) };
    expect(notificationTarget(join)).toEqual({ kind: 'join', orgId: 'org-a', requestId: 'req-9' });
    expect(openAfterSwitch(notificationTarget(join))).toBeUndefined();
  });

  it('keeps reports with the organization', () => {
    expect(notificationTarget({ ...row, kind: 'content_report' })).toEqual({ kind: 'report', orgId: 'org-a' });
  });

  it('opens at least the language when a row has no passage', () => {
    const to = notificationTarget({ ...row, language_id: 'L-nus' });
    expect(to).toEqual({ kind: 'organization', orgId: 'org-a', languageId: 'L-nus' });
    expect(openAfterSwitch(to)).toEqual({ languageId: 'L-nus' });
  });
});
