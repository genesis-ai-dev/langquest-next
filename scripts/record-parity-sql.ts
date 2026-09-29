/**
 * SQL that holds the server's validate_payload and fixed-role privilege
 * table to core's, for every passage-record event in the fixture plus
 * broken variants of each. Run: npx tsx scripts/record-parity-sql.ts out.sql,
 * then psql -f out.sql against a database with the migrations applied.
 */
import { writeFileSync } from 'node:fs';
import { EVENT_PRIVILEGE, privilegeAllows, privilegeFor, privilegesOfFixedRole, validateEvent, type AnyEvent, type Role } from '@langquest-next/core';
import { buildRecordFixture } from '../packages/core/test/fixtures';

const sql = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
// The record's own event types; the fixture also carries a v1 flow selection.
const RECORD_TYPES = new Set(['v1.ReviewKindDefined', 'v2.WorkflowStepSet', 'v1.ReviewRecorded', 'v1.DepartureRecorded',
  'v1.DepartureUndone', 'v1.RequestMade', 'v1.RequestWithdrawn', 'v1.NoteAdded', 'v1.StudyStepMarked', 'v1.RecordingAdded']);
const events = buildRecordFixture().filter((e) => RECORD_TYPES.has(e.type));
void EVENT_PRIVILEGE;
const broken: AnyEvent[] = events.flatMap((e) => {
  const p = e.payload as Record<string, unknown>;
  const variants: Record<string, unknown>[] = [];
  for (const k of Object.keys(p)) { const { [k]: _, ...rest } = p; variants.push(rest); }
  if ('outcome' in p) variants.push({ ...p, outcome: 'approve' });
  if ('type' in p) variants.push({ ...p, type: 'ignore' });
  if ('anchor' in p) variants.push({ ...p, anchor: { kind: 'page' } });
  if (e.type === 'v1.ReviewRecorded') variants.push({ ...p, outcome: 'recorded', artifactHashes: [] });
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
