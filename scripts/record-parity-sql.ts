/**
 * SQL that holds the server's validate_payload and fixed-role privilege
 * table to core's, for every passage-record and library event in the
 * fixtures plus broken variants of each (every field missing, wrong-typed or
 * null). The fitness function for invariant 11; `npm run db:test` runs it.
 */
import { writeFileSync } from 'node:fs';
import { EVENT_PRIVILEGE, LIBRARY_EVENT_TYPES, PRIVILEGES, privilegeAllows, privilegeFor, privilegesOfFixedRole, validateEvent, type AnyEvent, type Role } from '@langquest-next/core';
import { buildOrgFixture, buildRecordFixture } from '../packages/core/test/fixtures';

const sql = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
// The record's own event types; the fixture also carries a v1 flow selection.
const RECORD_TYPES = new Set(['v1.ReviewKindDefined', 'v2.WorkflowStepSet', 'v1.ReviewRecorded', 'v1.DepartureRecorded',
  'v1.DepartureUndone', 'v1.RequestMade', 'v1.RequestWithdrawn', 'v1.NoteAdded', 'v1.StudyStepMarked', 'v1.LaneNamed']);
// The library's: org-partition items and versions, and a language's use of them.
const LIBRARY_TYPES = new Set<string>([...LIBRARY_EVENT_TYPES, 'v2.LaneTemplateSelected', 'v1.LaneUnitHidden', 'v2.LaneFlowSelected']);
// The organization's license (license.ts).
const LICENSE_TYPES = new Set(['v1.OrgLicenseSet']);
const events = [...buildRecordFixture(), ...buildOrgFixture()].filter((e) => RECORD_TYPES.has(e.type) || LIBRARY_TYPES.has(e.type) || LICENSE_TYPES.has(e.type));
void EVENT_PRIVILEGE;
// Optional fields each payload may carry, so a wrong type is tried even when
// the fixture leaves the field out.
const OPTIONAL: Partial<Record<string, string[]>> = {
  'v1.ReviewKindDefined': ['description', 'usualReviewer', 'withholdsContext', 'produces'],
  'v2.WorkflowStepSet': ['laneId'],
  'v1.ReviewRecorded': ['comment', 'commentBlobHash', 'answers', 'skipped', 'people', 'place', 'givenBy', 'requestId', 'artifacts'],
  'v1.DepartureRecorded': ['kindId', 'stepId', 'reviewId', 'reasonBlobHash'],
  'v1.RequestMade': ['kindId', 'profileId', 'guest', 'dueDate', 'note', 'noteBlobHash', 'questions'],
  'v1.NoteAdded': ['text', 'blobHash', 'photoHash', 'onTakeId'],
  'v1.LibraryItemDefined': ['copiedFrom'],
  'v1.LibraryVersionPublished': ['note'],
  'v2.LaneTemplateSelected': ['books']
};
const HASH = 'a'.repeat(64);
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
  if (LIBRARY_TYPES.has(e.type)) {
    for (const k of ['itemId', 'docHash', 'unitPrefix', 'flowId']) {
      if (!(k in p)) continue;
      for (const bad of ['a/b', 'a@b', 'a b', '-a', 'A'.repeat(64), 'a'.repeat(63), 'x'.repeat(122), '']) variants.push({ ...p, [k]: bad });
    }
    if ('kind' in p) variants.push({ ...p, kind: 'song' }, { ...p, kind: 'Template' });
    if ('catalogVersion' in p) variants.push({ ...p, catalogVersion: 1 }, { ...p, catalogVersion: '2' }, { ...p, catalogVersion: 2.5 });
    if ('description' in p) variants.push({ ...p, description: '' });
  }
  if (e.type === 'v1.OrgLicenseSet') {
    for (const bad of ['MIT', 'cc0-1.0', 'CC-BY-ND-4.0', 'All rights reserved', '', ['CC0-1.0'], true]) variants.push({ ...p, license: bad });
  }
  if (e.type === 'v1.LibraryItemDefined') {
    const from = { orgId: 'o', orgName: 'O', itemId: 'i', docHash: HASH };
    variants.push({ ...p, copiedFrom: from }, { ...p, copiedFrom: 'o' }, { ...p, copiedFrom: [from] });
    for (const k of Object.keys(from)) {
      const { [k]: _, ...rest } = from;
      variants.push({ ...p, copiedFrom: rest }, { ...p, copiedFrom: { ...from, [k]: '' } }, { ...p, copiedFrom: { ...from, [k]: 5 } });
    }
    variants.push({ ...p, copiedFrom: { ...from, docHash: 'abc' } });
  }
  if (e.type === 'v2.LaneTemplateSelected') {
    variants.push({ ...p, books: [] }, { ...p, books: ['GEN', '1SA'] }, { ...p, books: ['GEN', 'gen'] }, { ...p, books: ['GENE'] },
      { ...p, books: [5] }, { ...p, books: 'GEN' }, { ...p, books: ['GEN', null] });
    const { books: _, ...rest } = p;
    variants.push(rest);
  }
  return variants.map((payload) => ({ ...e, payload }) as AnyEvent);
});
const rows = [...events, ...broken].map((e) => ({ type: e.type, payload: e.payload, valid: validateEvent(e) === null }));
const roles: Role[] = ['owner', 'coordinator', 'translator', 'reviewer', 'viewer'];
// Library events need the privilege that manages their kind: try every kind, and one core does not know.
const withKinds = events.flatMap((e) => (LIBRARY_EVENT_TYPES as readonly string[]).includes(e.type)
  ? ['template', 'flow', 'material', 'versification', 'song'].map((kind) => ({ ...e, payload: { ...e.payload, kind } }) as AnyEvent)
  : [e]);
const perms = withKinds.flatMap((e) => roles.map((role) => ({ role, type: e.type, payload: e.payload, allowed: privilegeAllows(privilegeFor(e), privilegesOfFixedRole(role)) })));
// Each privilege alone, so two that every fixed role holds together are still told apart.
const single = withKinds.flatMap((e) => PRIVILEGES.map((priv) => ({ priv, type: e.type, payload: e.payload, allowed: privilegeAllows(privilegeFor(e), new Set([priv])) })));
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
  for r in select * from jsonb_array_elements(${sql(single)}) loop
    if coalesce(string_to_array(public.event_privilege(r->>'type', r->'payload'), ',') && array[r->>'priv'], false) is distinct from (r->>'allowed')::boolean then
      raise exception 'event_privilege disagrees with core: %', r;
    end if;
  end loop;
end $$;
select ${rows.length} as payload_checks, ${perms.length + single.length} as permission_checks;
`);
