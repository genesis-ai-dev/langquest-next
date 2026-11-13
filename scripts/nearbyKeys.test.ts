// The script only builds SQL; who may revoke and raise is held by server/nearbyRelaySmoke.sql.
import { limit, listText, parseArgs, raiseText, revokeText, who, type KeyRow } from './nearby-keys';

describe('npm run nearby-keys (docs/nearby-sync-plan.md section 6)', () => {
  it('reads the command, its words and where to work', () => {
    expect(parseArgs(['raise', 'id', 'key', '10', '20', '--hosted'])).toEqual({ command: 'raise', rest: ['id', 'key', '10', '20'], hosted: true, json: false, workdir: undefined });
    expect(parseArgs(['list', 'a@b.org', '--workdir', '/tmp/stack', '--json'])).toMatchObject({ command: 'list', rest: ['a@b.org'], json: true, workdir: '/tmp/stack' });
    expect(parseArgs([]).command).toBe('list');
  });

  it('takes an email or an account id, and whole numbers for limits, and nothing that would change the SQL', () => {
    expect(who('a@b.org')).toBe("'a@b.org'");
    expect(who('5E000000-0000-0000-0000-00000000000A')).toBe("'5E000000-0000-0000-0000-00000000000A'");
    for (const bad of [undefined, '', 'nobody', "a'@b.org", 'a@b.org\'; drop table x; --']) expect(() => who(bad)).toThrow(/email or id/);
    expect(limit('50000', 'the events')).toBe('50000');
    for (const bad of [undefined, '', '-1', '1.5', '1e9', '9999999999999999']) expect(() => limit(bad, 'the events')).toThrow(/whole number/);
  });

  it('says what each answer means, and refuses what the database refused', () => {
    expect(revokeText('revoked 2')).toMatch(/Revoked 2 keys and ended their sessions/);
    expect(revokeText('revoked 0')).toMatch(/Nothing more to revoke/);
    expect(() => revokeText('No account has that email or id.')).toThrow('No account has that email or id.');
    expect(raiseText('raised')).toMatch(/Try again/);
    expect(() => raiseText('no_key')).toThrow(/no such key/);
    expect(() => raiseText('say_who')).toThrow(/git config user.name/);
  });

  it('lists each key with what a revoked one delivered against its cap', () => {
    expect(listText([])).toBe('No nearby keys for that account.');
    const row: KeyRow = {
      public_key: 'k'.repeat(43), install_id: 'd1', created_at: '2026-11-01', last_certified_at: '2026-11-07', revoked_at: null, revoked_by: null,
      after_revoked_events: 0, after_revoked_events_limit: 50000, after_revoked_bytes: 0, after_revoked_bytes_limit: 104857600, after_revoked_raised_by: null
    };
    expect(listText([row])).toContain('good');
    const text = listText([{ ...row, revoked_at: '2026-11-08', revoked_by: 'New password', after_revoked_events: 12, after_revoked_bytes: 2_097_152, after_revoked_raised_by: 'Carl Sauder' }]);
    expect(text).toContain('REVOKED 2026-11-08 (New password); since then delivered 12 of 50000 events, 2.0 MB of 100.0 MB; raised by Carl Sauder');
  });
});
