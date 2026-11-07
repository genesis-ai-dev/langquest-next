// The script only builds SQL; who may grant what is held by server/nearbySmoke.sql.
import { answerText, featureOf, FEATURES, listText, parseArgs } from './org-feature';

describe('npm run org-feature (docs/nearby-sync-plan.md 5.10)', () => {
  it('reads the command, the organization, the feature and where to work', () => {
    expect(parseArgs(['grant', 'org-test', 'nearby', '--hosted'])).toEqual({
      command: 'grant', org: 'org-test', feature: 'nearby', hosted: true, json: false, workdir: undefined
    });
    expect(parseArgs(['list', '--workdir', '/tmp/stack', '--json'])).toMatchObject({ command: 'list', hosted: false, json: true, workdir: '/tmp/stack' });
    expect(parseArgs([]).command).toBe('list');
  });

  it('takes only a feature org_features knows', () => {
    expect(Object.keys(FEATURES)).toEqual(['nearby', 'nearby_join']);
    expect(featureOf('nearby')).toBe('nearby');
    expect(featureOf('nearby_join')).toBe('nearby_join');
    for (const bad of [undefined, '', 'toString', 'nearby\'; drop table x; --', 'NEARBY']) expect(() => featureOf(bad)).toThrow(/Name the feature/);
  });

  it('says what each answer means, and refuses what the database refused', () => {
    expect(answerText('grant', 'nearby', 'granted')).toMatch(/certificate/);
    expect(answerText('grant', 'nearby_join', 'granted')).toMatch(/only while nearby is on/);
    expect(answerText('revoke', 'nearby', 'revoked')).toMatch(/joining offline stops too/);
    expect(answerText('revoke', 'nearby_join', 'revoked')).toMatch(/no new passes/);
    expect(() => answerText('grant', 'nearby', 'no_org')).toThrow('No organization has that id.');
    expect(() => answerText('revoke', 'nearby', 'not_granted')).toThrow(/does not have that feature on/);
    expect(() => answerText('grant', 'nearby', 'say_who')).toThrow(/git config user.name/);
    expect(() => answerText('grant', 'nearby', undefined)).toThrow('No answer.');
  });

  it('lists live and revoked grants with who did each', () => {
    expect(listText([])).toBe('No organization has a feature on.');
    const text = listText([
      { org_id: 'o1', org_name: 'Test Org', feature: 'nearby', granted_at: '2026-11-07', granted_by: 'Carl Sauder', revoked_at: null, revoked_by: null },
      { org_id: 'o2', org_name: null, feature: 'nearby_join', granted_at: '2026-11-01', granted_by: 'Carl Sauder', revoked_at: '2026-11-02', revoked_by: 'Caleb' }
    ]);
    expect(text).toContain('Test Org  (o1)  nearby  on since 2026-11-07 (Carl Sauder)');
    expect(text).toContain('o2  (o2)  nearby_join  OFF since 2026-11-02 (Caleb)');
  });
});
