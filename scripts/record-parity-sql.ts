/**
 * SQL that holds the server's validate_payload and fixed-role privilege
 * table to core's, for every passage-record event in the fixture plus
 * broken variants of each (every field missing, wrong-typed or null). The
 * fitness function for invariant 11; `npm run db:test` runs it.
 */
import { writeFileSync } from 'node:fs';
import { EVENT_PRIVILEGE, privilegeAllows, privilegeFor, privilegesOfFixedRole, validateEvent, type AnyEvent, type Role } from '@langquest-next/core';
import { buildRecordFixture } from '../packages/core/test/fixtures';

const sql = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
// The record's own event types; the fixture also carries a v1 flow selection.
const RECORD_TYPES = new Set(['v1.ReviewKindDefined', 'v2.WorkflowStepSet', 'v1.ReviewRecorded', 'v1.DepartureRecorded',
  'v1.DepartureUndone', 'v1.RequestMade', 'v1.RequestWithdrawn', 'v1.NoteAdded', 'v1.StudyStepMarked', 'v1.LaneNamed']);
const events = buildRecordFixture().filter((e) => RECORD_TYPES.has(e.type));
void EVENT_PRIVILEGE;
// Optional fields each payload may carry, so a wrong type is tried even when
// the fixture leaves the field out.
const OPTIONAL: Partial<Record<string, string[]>> = {
  'v1.ReviewKindDefined': ['description', 'usualReviewer', 'withholdsContext', 'produces'],
  'v2.WorkflowStepSet': ['laneId'],
  'v1.ReviewRecorded': ['comment', 'commentBlobHash', 'answers', 'skipped', 'people', 'place', 'givenBy', 'requestId', 'artifacts'],
  'v1.DepartureRecorded': ['kindId', 'stepId', 'reviewId', 'reasonBlobHash'],
  'v1.RequestMade': ['kindId', 'profileId', 'guest', 'dueDate', 'note', 'noteBlobHash', 'questions'],
  'v1.NoteAdded': ['text', 'blobHash', 'photoHash', 'onTakeId']
};
const broken: AnyEvent[] = events.flatMap((e) => {
  const p = e.payload as Record<string, unknown>;
  const variants: Record<string, unknown>[] = [];
  // Every field missing, then every field (present or optional) as a number and as null.
  for (const k of Object.keys(p)) { const { [k]: _, ...rest } = p; variants.push(rest); }
  for (const k of new Set([...Object.keys(p), ...(OPTIONAL[e.type] ?? [])])) {
    variants.push({ ...p, [k]: 5 }, { ...p, [k]: null });
  }
  if ('outcome' in p) variants.push({ ...p, outcome: 'approve' });
  if ('type' in p) variants.push({ ...p, type: 'ignore' });
  if ('anchor' in p) {
    const anchor = p['anchor'] as Record<string, unknown>;
    variants.push({ ...p, anchor: { kind: 'page' } });
    for (const kind of ['version', 'verse', 'study', 'term']) variants.push({ ...p, anchor: { kind } });
    for (const k of Object.keys(anchor)) { const { [k]: _, ...rest } = anchor; variants.push({ ...p, anchor: rest }); }
  }
  if (e.type === 'v1.ReviewRecorded') {
    variants.push({ ...p, outcome: 'recorded', artifacts: [] }, { ...p, artifacts: [{ hash: 'x' }] }, { ...p, artifacts: ['x'] });
  }
  if (e.type === 'v1.RequestMade') {
    variants.push({ ...p, questions: [{ id: 'q', text: 't', type: 'yesno', required: 'yes' }] }, { ...p, questions: [{ id: 'q', text: 't', type: 'essay' }] },
      { ...p, guest: { name: 'n', channel: 'email', contact: 'c' } });
  }
  return variants.map((payload) => ({ ...e, payload }) as AnyEvent);
});
const rows = [...events, ...broken].map((e) => ({ type: e.type, payload: e.payload, valid: validateEvent(e) === null }));
const roles: Role[] = ['owner', 'coordinator', 'translator', 'reviewer', 'viewer'];
const perms = events.flatMap((e) => roles.map((role) => ({ role, type: e.type, payload: e.payload, allowed: privilegeAllows(privilegeFor(e), privilegesOfFixedRole(role)) })));
writeFileSync(process.argv[2] ?? '/tmp/record-parity.sql', `do $$ declare r jsonb; begin
  for r in select * from jsonb_array_elements(${sql(rows)}) loop
    if (public.validate_payload(r->>'type', r->'payload') is null) is distinct from (r->>'valid')::boolean then
      raise exception 'validate_payload disagrees with core: % (sql says %)', r, public.validate_payload(r->>'type', r->'payload');
    end if;
  end loop;
  for r in select * from jsonb_array_elements(${sql(perms)}) loop
    if public.role_may_emit_event(r->>'role', r->>'type', r->'payload') is distinct from (r->>'allowed')::boolean then
      raise exception 'role_may_emit_event disagrees with core: %', r;
    end if;
  end loop;
end $$;
select ${rows.length} as payload_checks, ${perms.length} as permission_checks;
`);
