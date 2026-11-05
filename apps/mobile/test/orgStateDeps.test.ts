import fs from 'node:fs';
import path from 'node:path';
import { emptyOrgState, foldOrg, type AnyEvent } from '@langquest-next/core';

// useOrg hands out a new state object on every change, but the fold changes
// its fields in place. A hook keyed on `org.state?.members` never sees a new
// member: names were read once and new members showed as "Teal Diamond".

const mobile = path.resolve(__dirname, '..');
const sources = [path.join(mobile, 'App.tsx'), ...fs.readdirSync(path.join(mobile, 'src'), { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(mobile, 'src', f))];
/** A hook's dependency array (`[...]);`) naming a field of the org state. */
const FIELD_DEP = /\[[^[\]]*\borg\.state\??\.\w+[^[\]]*\]\s*\);/g;

describe('hooks that read the organization state', () => {
  it('depend on the state, not on a field the fold changes in place', () => {
    const found = sources.flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(FIELD_DEP)]
      .map((m) => `${path.relative(mobile, file)}: ${m[0]}`));
    expect(found).toEqual([]);
  });

  it('the fold does change members in place, which is why', () => {
    const event = (n: number, profileId: string) => ({
      type: 'v1.MemberAdded', id: `e${n}`, actorId: 'admin', orgId: 'org', streamId: '_org', deviceId: 'd',
      hlc: `${String(n).padStart(15, '0')}:000000:d`, payload: { profileId, roleId: 'r', scope: { level: 'org' } }
    }) as AnyEvent;
    const state = foldOrg([event(1, 'a')], emptyOrgState());
    const members = state.members;
    const next = foldOrg([event(2, 'b')], state);
    expect(Object.keys(next.members).sort()).toEqual(['a', 'b']);
    expect(next.members).toBe(members);
  });
});
