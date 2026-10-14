import type { LocalEvent } from '@langquest-next/sync';
import { lastSyncText, refusedHere, remoteRowView, speed, syncSummary, unsentWork } from '../src/account/model';
import { t } from '../src/i18n';
import { formatNumber } from '../src/i18n/format';

describe('the account screens\' words for sync', () => {
  const quiet = { refused: null, pending: 0, live: false, online: true, lastSync: 'up to date' };
  it('says the most pressing thing first: refused, waiting, live, offline, then the last sync', () => {
    expect(syncSummary({ ...quiet, refused: 'NOT_MEMBER', pending: 3, live: true })).toBe(t('account.more.syncRefused'));
    expect(syncSummary({ ...quiet, pending: 3, live: true })).toBe(t('account.more.syncPending', { count: 3 }));
    expect(syncSummary({ ...quiet, live: true, online: false })).toBe(t('account.more.syncLive'));
    expect(syncSummary({ ...quiet, online: false })).toBe(t('account.more.syncOffline'));
    expect(syncSummary(quiet)).toBe(t('account.more.syncUpToDate'));
  });

  it('reads the last sync token, never shows it', () => {
    expect(lastSyncText('pushed 1, pulled 2, rejected 0')).toBe(t('account.more.syncUpToDate'));
    expect(lastSyncText('error: boom')).toBe(t('account.more.syncError'));
    expect(lastSyncText('never')).toBe(t('account.more.syncSaved'));
  });

  it('speeds in the unit that reads best', () => {
    expect(speed(500)).toBe(t('account.sync.speedB', { value: '500' }));
    expect(speed(2048)).toBe(t('account.sync.speedKB', { value: formatNumber(2, { maximumFractionDigits: 0 }) }));
    expect(speed(3 * 1024 * 1024)).toBe(t('account.sync.speedMB', { value: formatNumber(3, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));
  });
});

describe('what waits before sign-out (unsentWork)', () => {
  const none = { refused: null, pending: 0, orgPending: 0, uploads: 0, accountQueued: 0 };
  it('names each kind of work still to send', () => {
    expect(unsentWork(none)).toEqual([]);
    expect(unsentWork({ ...none, pending: 2, uploads: 1, accountQueued: 1 })).toHaveLength(3);
  });
  it('work the server refused this person is not waiting: it will never go', () => {
    expect(unsentWork({ ...none, refused: 'NOT_MEMBER', pending: 2, uploads: 1, orgPending: 1 })).toEqual([t('account.unsent.orgChanges', { count: 1 })]);
  });
});

describe('refused changes, once each, oldest first', () => {
  const ev = (id: string, hlc: string) => ({ event: { id, hlc } } as unknown as LocalEvent);
  it('merges the clients\' view with the log\'s', () => {
    const out = refusedHere({ rejected: [ev('b', '2'), ev('a', '1')] }, null, { rejected: [ev('b', '2')] });
    expect(out.map((l) => l.event.id)).toEqual(['a', 'b']);
  });
});

describe('server notifications in the Inbox (remoteRowView)', () => {
  const here = { orgId: 'org1', languageId: 'din', requestsListed: false, reportsListed: false, mayAdmitAndAssign: true, mayModerate: true };
  const row = (o: Partial<{ org_id: string; kind: string; language_id: string | null }>) => ({ org_id: 'org1', kind: 'update', language_id: 'din', ...o });
  it('another organization\'s rows show, saying so', () => {
    expect(remoteRowView(row({ org_id: 'org2' }), here)).toBe('otherOrg');
  });
  it('the open language\'s updates come from its record, not the server', () => {
    expect(remoteRowView(row({}), here)).toBeNull();
    expect(remoteRowView(row({ language_id: 'nus' }), here)).toBe('otherLanguage');
  });
  it('join requests and reports show from the server only until they are listed here', () => {
    expect(remoteRowView(row({ kind: 'join_request', language_id: null }), here)).toBe('openMembers');
    expect(remoteRowView(row({ kind: 'join_request', language_id: null }), { ...here, requestsListed: true })).toBeNull();
    expect(remoteRowView(row({ kind: 'content_report' }), here)).toBe('connectToSee');
    expect(remoteRowView(row({ kind: 'content_report' }), { ...here, mayModerate: false })).toBeNull();
  });
});
