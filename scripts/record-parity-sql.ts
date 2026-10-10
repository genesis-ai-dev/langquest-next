/**
 * SQL that holds the server's validate_payload, privilege table and
 * language-of-event rule to core's, for every event type in the fixtures
 * (both streams) plus broken variants of each (every field missing,
 * wrong-typed or null, and the edge cases each type has). The fitness
 * function for invariant 11; `npm run db:test` runs it.
 */
import { writeFileSync } from 'node:fs';
import {
  EVENT_PRIVILEGE, LIBRARY_EVENT_TYPES, PRIVILEGES, entityKeyOf, languageOfOrgEvent, privilegeAllows, privilegeFor, privilegesOfFixedRole,
  validateEvent, type AnyEvent, type Role
} from '@langquest-next/core';
import { buildFixture, buildOrgFixture, buildRecordFixture, buildStep11Fixture } from '../packages/core/test/fixtures';

const sql = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;

// A few of each type is enough; the variants below do the rest.
const perType = new Map<string, number>();
const events = [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture(), ...buildOrgFixture()].filter((e) => {
  const n = perType.get(e.type) ?? 0;
  perType.set(e.type, n + 1);
  return n < 3;
});
for (const type of Object.keys(EVENT_PRIVILEGE)) {
  if (!perType.has(type)) throw new Error(`no fixture event of type ${type}: add one to packages/core/test/fixtures.ts`);
}

// Optional fields each payload may carry, so a wrong type is tried even when
// the fixture leaves the field out.
const OPTIONAL: Partial<Record<string, string[]>> = {
  'v1.ReviewKindDefined': ['description', 'usualReviewer', 'withholdsContext', 'produces'],
  'v1.ReviewRecorded': ['comment', 'commentBlobHash', 'answers', 'skipped', 'people', 'place', 'givenBy', 'requestId', 'artifacts'],
  'v1.DepartureRecorded': ['kindId', 'stepId', 'reviewId', 'reasonBlobHash'],
  'v1.RequestMade': ['kindId', 'profileId', 'guest', 'teamId', 'dueDate', 'note', 'noteBlobHash', 'questions'],
  'v1.NoteAdded': ['text', 'blobHash', 'photoHash', 'onTakeId'],
  'v1.LibraryItemDefined': ['copiedFrom'],
  'v1.LibraryVersionPublished': ['note'],
  'v1.TemplateSelected': ['books'],
  'v1.FlowSelected': ['itemId', 'docHash', 'name'],
  'v1.ReferencesUsed': ['takeId', 'reviewId'],
  'v1.TakeSubmitted': ['questionSetIds'],
  'v1.ResponseRecorded': ['note', 'blobHash'],
  'v1.CardVerseSet': ['from', 'to'],
  'v1.MaterialDefined': ['templateRef'],
  'v1.MaterialFieldSet': ['text', 'blobHash'],
  'v1.KeyTermAdjusted': ['blobHash', 'duringTakeId'],
  'v1.KeyTermLinked': ['note', 'adjustmentId'],
  'v1.Redacted': ['reason'],
  'v1.BlobInvalidated': ['reason']
};
const HASH = 'a'.repeat(64);
const GUEST = { name: 'n', channel: 'sms', contact: 'c' };
const SCOPED = new Set(['v1.MemberAdded', 'v1.MemberRemoved', 'v1.InviteIssued']);

const broken: AnyEvent[] = events.flatMap((e) => {
  const p = e.payload as Record<string, unknown>;
  const variants: Record<string, unknown>[] = [];
  // Every field missing, then every field (present or optional) as a number and as null.
  for (const k of Object.keys(p)) { const { [k]: _, ...rest } = p; variants.push(rest); }
  for (const k of new Set([...Object.keys(p), ...(OPTIONAL[e.type] ?? [])])) {
    variants.push({ ...p, [k]: 5 }, { ...p, [k]: null }, { ...p, [k]: '' });
  }
  if ('outcome' in p) variants.push({ ...p, outcome: 'approve' });
  if ('type' in p) variants.push({ ...p, type: 'ignore' });
  if ('anchor' in p) {
    const anchor = p['anchor'] as Record<string, unknown>;
    variants.push({ ...p, anchor: { kind: 'page' } }, { ...p, anchor: { kind: 5 } }, { ...p, anchor: [] });
    for (const kind of ['version', 'verse', 'study', 'term']) variants.push({ ...p, anchor: { kind } });
    for (const k of Object.keys(anchor)) { const { [k]: _, ...rest } = anchor; variants.push({ ...p, anchor: rest }); }
  }
  if (SCOPED.has(e.type)) {
    for (const scope of [{ level: 'team' }, { level: 'language' }, { level: 'language', languageId: '' }, { level: 'org', languageId: 'x' },
      { level: 'language', languageId: 'x', teamId: 'y' }, { level: 'language', languageId: 5 }, [], 'org']) variants.push({ ...p, scope });
  }
  switch (e.type) {
    case 'v1.ReviewRecorded':
      variants.push({ ...p, outcome: 'recorded', artifacts: [] }, { ...p, artifacts: [{ hash: 'x' }] }, { ...p, artifacts: ['x'] },
        { ...p, people: -1 }, { ...p, answers: { q: 5 } }, { ...p, answers: [] }, { ...p, via: 'email' },
        ...[0, 4200, -1, 1.5, '3', null].map((atMs) => ({ ...p, artifacts: [{ hash: 'x', durationMs: 900, format: 'm4a', atMs }] })));
      break;
    case 'v1.RecordingAdded':
      variants.push({ ...p, cards: [{ hash: '', durationMs: 1 }] }, { ...p, cards: [{ hash: 'x', durationMs: '1' }] }, { ...p, cards: {} });
      break;
    case 'v1.RoleDefined':
      variants.push({ ...p, privileges: ['fly'] }, { ...p, privileges: 'translate' }, { ...p, privileges: [] });
      break;
    case 'v1.LanguageAdded':
      for (const languageId of ['_org', 'a b', '-x', 'a/b', 'x'.repeat(82)]) variants.push({ ...p, languageId });
      break;
    case 'v1.LanguageCountrySet':
      variants.push({ ...p, country: 'ss' }, { ...p, country: 'SSD' });
      break;
    case 'v1.LanguageCodeSet':
      variants.push({ ...p, languoidId: 'nyan1308' }, { ...p, languoidId: '' }, { ...p, languoidId: 5 }, { ...p, code: '' },
        { ...p, code: 'x'.repeat(41) }, { ...p, code: 'x'.repeat(40) }, { ...p, languoidId: '5870452D-7878-4328-916D-F4FECC0B79F2' });
      break;
    case 'v1.LanguageTargetSet':
      variants.push({ ...p, scope: 'psalms' }, { ...p, startDate: '2026-1-1' }, { ...p, targetDate: p['startDate'] },
        { ...p, startDate: '2027-01-01', targetDate: '2026-01-01' }, { ...p, targetDate: 'soon' });
      break;
    case 'v1.ReferenceSet':
      variants.push({ ...p, state: 'pinned' });
      break;
    case 'v1.ReferenceLanguageSet':
      variants.push({ ...p, language: '' }, { ...p, language: 'French' }, { ...p, language: 'x' }, { ...p, language: 'x'.repeat(41) }, { ...p, language: 7 });
      break;
    case 'v1.ReviewTeamKindSet':
      variants.push({ ...p, kindId: ['peer'] });
      break;
    case 'v1.FlowStepLinksSet':
      variants.push({ ...p, allowed: 'yes' }, { ...p, stepId: '' });
      break;
    case 'v1.BookNameSet':
      variants.push({ ...p, book: 'luk' }, { ...p, book: 'LUKE' }, { ...p, book: '1 SA' });
      break;
    case 'v1.VersionReleased':
      variants.push({ ...p, live: 1 }, { ...p, channel: '' }, { ...p, channel: 'x'.repeat(61) }, { ...p, channel: '🎧'.repeat(60) }, { ...p, url: '' }, { ...p, url: ' ' });
      break;
    case 'v1.ExternalValueSet':
      for (const key of ['/a', 'a/', 'a//b', 'a b', 'a?b', 'a%b', '.', '..', 'a/./b', 'a/../b', '...', 'a.b/c~d:e@f+g-h_i', 'x'.repeat(256), 'x'.repeat(257), 'é', '🎧']) {
        variants.push({ ...p, key });
      }
      variants.push({ ...p, data: [] }, { ...p, data: [1] }, { ...p, data: true }, { ...p, data: {} }, { ...p, data: { nested: { deep: [1, null] } } });
      break;
    case 'v1.UnitAdded':
    case 'v1.TakeComposed':
      variants.push({ ...p, parentUnitId: 'x', parentTakeId: 'x' });
      break;
    case 'v1.FlowSelected':
      for (const flowId of ['a/b', 'a@b', 'a b']) variants.push({ ...p, flowId });
      variants.push({ ...p, docHash: 'abc' }, { ...p, docHash: HASH });
      break;
    case 'v1.MaterialDefined':
      variants.push({ ...p, scope: { teamId: 'x' } }, { ...p, scope: { unitId: '' } }, { ...p, scope: [] }, { ...p, scope: { unitId: 5 } },
        { ...p, scope: { unitId: 'u', stepId: 's' } });
      break;
    case 'v1.ReferencesUsed': {
      const item = (p['items'] as Record<string, unknown>[])[0]!;
      variants.push({ ...p, items: [] }, { ...p, items: 'x' }, { ...p, items: [5] }, { ...p, takeId: 't', reviewId: 'r' },
        { ...p, items: Array.from({ length: 201 }, () => item) });
      for (const k of Object.keys(item)) {
        const { [k]: _, ...rest } = item;
        variants.push({ ...p, items: [rest] }, { ...p, items: [{ ...item, [k]: 5 }] });
      }
      for (const k of ['docHash', 'ref', 'detail', 'copyright']) variants.push({ ...p, items: [{ ...item, [k]: 5 }] });
      variants.push({ ...p, items: [{ ...item, kind: 'video' }] }, { ...p, items: [{ ...item, opened: 'yes' }] }, { ...p, items: [{ ...item, itemId: '' }] });
      break;
    }
    case 'v1.RequestMade': {
      // Exactly one addressee: a person, a guest or a team.
      const { profileId: _a, guest: _b, teamId: _c, ...none } = p;
      variants.push(none, { ...none, profileId: 'r1' }, { ...none, guest: GUEST }, { ...none, teamId: 't1' },
        { ...none, profileId: 'r1', teamId: 't1' }, { ...none, profileId: 'r1', guest: GUEST }, { ...none, teamId: 't1', guest: GUEST },
        { ...none, profileId: 'r1', teamId: '' }, { ...none, teamId: 't1', what: 'review' });
      variants.push({ ...p, questions: [{ id: 'q', text: 't', type: 'yesno', required: 'yes' }] }, { ...p, questions: [{ id: 'q', text: 't', type: 'essay' }] },
        { ...p, questions: [{ id: 'q', text: 't', type: 'text' }] }, { ...none, guest: { name: 'n', channel: 'email', contact: 'c' } });
      break;
    }
    case 'v1.LicenseSet':
      for (const bad of ['MIT', 'cc0-1.0', 'CC-BY-ND-4.0', 'All rights reserved', ['CC0-1.0'], true]) variants.push({ ...p, license: bad });
      break;
    case 'v1.LibraryItemDefined': {
      const from: Record<string, unknown> = { orgId: 'o', orgName: 'O', itemId: 'i', docHash: HASH };
      variants.push({ ...p, copiedFrom: from }, { ...p, copiedFrom: 'o' }, { ...p, copiedFrom: [from] });
      for (const k of Object.keys(from)) {
        const { [k]: _, ...rest } = from;
        variants.push({ ...p, copiedFrom: rest }, { ...p, copiedFrom: { ...from, [k]: '' } }, { ...p, copiedFrom: { ...from, [k]: 5 } });
      }
      variants.push({ ...p, copiedFrom: { ...from, docHash: 'abc' } });
      break;
    }
    case 'v1.TemplateSelected': {
      variants.push({ ...p, books: [] }, { ...p, books: ['GEN', '1SA'] }, { ...p, books: ['GEN', 'gen'] }, { ...p, books: ['GENE'] },
        { ...p, books: [5] }, { ...p, books: 'GEN' }, { ...p, books: ['GEN', null] }, { ...p, unitPrefix: 'a b' }, { ...p, unitPrefix: 'a/b' });
      const { books: _, ...rest } = p;
      variants.push(rest);
      break;
    }
  }
  if ((LIBRARY_EVENT_TYPES as readonly string[]).includes(e.type) || e.type === 'v1.TemplateSelected') {
    for (const k of ['itemId', 'docHash']) {
      if (!(k in p)) continue;
      for (const bad of ['a/b', 'a@b', 'a b', '-a', 'A'.repeat(64), 'a'.repeat(63), 'x'.repeat(122)]) variants.push({ ...p, [k]: bad });
    }
    if ('kind' in p) variants.push({ ...p, kind: 'song' }, { ...p, kind: 'Template' });
    if ('description' in p) variants.push({ ...p, description: '' });
  }
  return variants.map((payload) => ({ ...e, payload }) as AnyEvent);
});
const rows = [...events, ...broken].map((e) => ({ type: e.type, payload: e.payload, valid: validateEvent(e) === null }));

const roles: Role[] = ['owner', 'coordinator', 'translator', 'reviewer', 'viewer'];
// Events whose privilege depends on the payload: try each value that matters.
const withKinds = events.flatMap((e): AnyEvent[] => {
  if ((LIBRARY_EVENT_TYPES as readonly string[]).includes(e.type)) {
    return ['template', 'flow', 'material', 'versification', 'song'].map((kind) => ({ ...e, payload: { ...e.payload, kind } }) as AnyEvent);
  }
  if (e.type === 'v1.MaterialDefined') return ['questions', 'tmf'].map((kind) => ({ ...e, payload: { ...e.payload, kind } }) as AnyEvent);
  if (e.type === 'v1.ReviewRecorded') return ['app', 'link', 'logged'].map((via) => ({ ...e, payload: { ...e.payload, via } }) as AnyEvent);
  if (e.type === 'v1.DepartureRecorded') return ['skip', 'override', 'keep'].map((type) => ({ ...e, payload: { ...e.payload, type } }) as AnyEvent);
  return [e];
});
const perms = withKinds.flatMap((e) => roles.map((role) => ({ role, type: e.type, payload: e.payload, allowed: privilegeAllows(privilegeFor(e), privilegesOfFixedRole(role)) })));
// Each privilege alone, so two that every fixed role holds together are still told apart.
const single = withKinds.flatMap((e) => PRIVILEGES.map((priv) => ({ priv, type: e.type, payload: e.payload, allowed: privilegeAllows(privilegeFor(e), new Set([priv])) })));
// The language an organization-stream event is authorized against.
const scopedLanguage = [...events, ...broken.filter((e) => SCOPED.has(e.type) && validateEvent(e) === null)]
  .map((e) => ({ type: e.type, payload: e.payload, language: languageOfOrgEvent(e) ?? null }));

// The entity a creating event names (one event per entity in a stream, decisions.md 75).
const entities = events.map((e) => ({ type: e.type, payload: e.payload, key: entityKeyOf(e) }));

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
  for r in select * from jsonb_array_elements(${sql(scopedLanguage)}) loop
    if public.language_of_org_event(r->>'type', r->'payload') is distinct from r->>'language' then
      raise exception 'language_of_org_event disagrees with core: %', r;
    end if;
  end loop;
  for r in select * from jsonb_array_elements(${sql(entities)}) loop
    if public._entity_key(r->>'type', r->'payload') is distinct from r->>'key' then
      raise exception '_entity_key disagrees with core: % (sql says %)', r, public._entity_key(r->>'type', r->'payload');
    end if;
  end loop;
end $$;
select ${rows.length} as payload_checks, ${perms.length + single.length} as permission_checks, ${scopedLanguage.length} as scope_checks,
  ${entities.length} as entity_checks;
`);
