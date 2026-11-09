import { describe, expect, it } from 'vitest';
import {
  commands, derivePassage, emptyLanguageState, flowTemplate, foldLanguage, foldOrg, HlcClock, instantiateFlow, SEED_ROLES,
  type AnyEvent, type EventPayloads, type EventType
} from '@langquest-next/core';
import { planOrgExport } from '../src/orgExport';

/**
 * A fuller organization for the export (decisions.md 206): every kind of voice
 * note, verse labels, a WAV part, a cleaned part, a key term, roles at two
 * scopes, a passage across two chapters and one outside the Bible. Each lands
 * in the manifest with its file beside the passage it belongs to.
 */

const h = (c: string) => c.repeat(64);
const [a, b, wav, cleaned, note, reason, ask, , change, art, term, cmt] = ['a', 'b', 'c', 'd', 'e', 'f', '1', '2', '3', '4', '5', '6'].map(h) as [string, string, string, string, string, string, string, string, string, string, string, string];

function build() {
  const events: AnyEvent[] = [];
  let wall = Date.UTC(2026, 8, 1);
  let seq = 0;
  const clocks = new Map<string, HlcClock>();
  const emit = <T extends EventType>(actorId: string, type: T, payload: EventPayloads[T], stream = 'din') => {
    const clock = clocks.get(actorId) ?? new HlcClock(actorId, () => wall);
    clocks.set(actorId, clock);
    wall += 86_400_000;
    seq += 1;
    events.push({ id: `y${seq}`, type, orgId: 'o', streamId: stream, actorId, deviceId: actorId, hlc: clock.next(), payload } as AnyEvent);
  };
  const state = () => foldLanguage(events.filter((e) => e.streamId === 'din'), emptyLanguageState());
  const run = (actorId: string, build: (c: ReturnType<typeof commands>) => { type: EventType; payload: unknown }[]) => {
    for (const spec of build(commands(state()))) emit(actorId, spec.type, spec.payload as never);
  };
  emit('lead', 'v1.OrgCreated', { name: 'Dinka Team' }, '_org');
  for (const r of SEED_ROLES) emit('lead', 'v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges }, '_org');
  emit('lead', 'v1.MemberAdded', { profileId: 'lead', roleId: 'org_admin', scope: { level: 'org' } }, '_org');
  emit('lead', 'v1.MemberAdded', { profileId: 'akol', roleId: 'translator', scope: { level: 'language', languageId: 'din' } }, '_org');
  emit('lead', 'v1.LanguageAdded', { languageId: 'din', name: 'Dinka', code: 'din', sourceCode: 'eng' }, '_org');
  emit('lead', 'v1.UnitAdded', { unitId: 'john', parentUnitId: null, kind: 'book', label: 'John', order: 'b' });
  emit('lead', 'v1.UnitAdded', { unitId: 'span', parentUnitId: 'john', kind: 'passage', label: 'John 3:1-4:5', order: 'b1' });
  emit('lead', 'v1.UnitAdded', { unitId: 'intro', parentUnitId: null, kind: 'passage', label: 'Welcome', order: 'c' });
  for (const step of instantiateFlow('standard_bible')) emit('lead', 'v1.FlowStepSet', step);
  emit('lead', 'v1.FlowSelected', { flowId: 'standard_bible', name: flowTemplate('standard_bible')!.name });

  emit('akol', 'v1.RecordingAdded', { recordingId: 'r1', unitId: 'span', kind: 'target', cards: [{ hash: a, durationMs: 1000, format: 'm4a' }, { hash: b, durationMs: 2000, format: 'm4a' }, { hash: wav, durationMs: 500, format: 'wav' }] });
  emit('akol', 'v1.CardVerseSet', { unitId: 'span', hash: a, mark: 'set', from: '3:1', to: '3:5' });
  emit('akol', 'v1.CardVerseSet', { unitId: 'span', hash: b, mark: 'next' });
  emit('akol', 'v1.CardCleanUpSet', { unitId: 'span', hash: wav, use: 'cleaned', cleanedHash: cleaned, cleanedFormat: 'm4a', tool: 'dfn3' });
  run('akol', (c) => c.publishVersion({ commandId: 'p1', unitId: 'span', cardHashes: [a, b, wav] }));
  run('akol', (c) => c.publishVersion({ commandId: 'p2', unitId: 'span', cardHashes: [a, b, cleaned], note: 'Cleaned the last part.', noteBlobHash: change }));
  const take = derivePassage(state(), 'span').latest!.takeId;
  emit('ayen', 'v1.ReviewRecorded', { reviewId: 'rv1', takeId: take, kindId: 'peer', outcome: 'looks_good', via: 'app', commentBlobHash: cmt, artifacts: [{ hash: art, durationMs: 400, atMs: 1200 }] });
  run('lead', (c) => c.depart({ commandId: 'd1', unitId: 'span', type: 'skip', kindId: 'peer', reason: 'No reviewer here.', reasonBlobHash: reason }));
  run('lead', (c) => c.ask({ commandId: 'q1', unitId: 'span', what: 'record', profileId: 'akol', noteBlobHash: ask }));
  run('akol', (c) => c.addNote({ commandId: 'n1', unitId: 'span', anchor: { kind: 'version', takeId: take }, blobHash: note, text: 'Listen here.' }));
  run('akol', (c) => c.addNote({ commandId: 'n2', unitId: 'span', anchor: { kind: 'passage' }, text: 'A plain note.' }));
  run('akol', (c) => c.defineKeyTerm({ commandId: 'k1', termId: 'light', term: 'light', gloss: 'not dark', unitScope: ['span'], rendering: 'nyin', note: 'Heard it said so.', blobHash: term }));
  run('akol', (c) => c.linkKeyTerms({ commandId: 'k2', takeId: take, termIds: ['light'] }));
  return { events, take, lang: state(), org: foldOrg(events.filter((e) => e.streamId === '_org')) };
}

const plan = () => { const f = build(); return planOrgExport({ orgId: 'o', org: f.org, languages: [{ languageId: 'din', state: f.lang }], nameOf: (id) => id.toUpperCase(), now: Date.UTC(2026, 10, 1) }); };

describe('organization export, a fuller organization', () => {
  it('lists every kind of voice note beside its passage, with who and what', () => {
    const p = plan();
    const kinds = new Map(p.manifest.map((r) => [r.hash, r]));
    expect(kinds.get(cmt)).toMatchObject({ kind: 'review_comment', outcome: 'looks_good', by: 'AYEN', version: 2 });
    expect(kinds.get(art)).toMatchObject({ kind: 'review_artifact', version: 2 });
    expect(kinds.get(reason)).toMatchObject({ kind: 'departure_reason', text: 'No reviewer here.' });
    expect(kinds.get(ask)).toMatchObject({ kind: 'request_note' });
    expect(kinds.get(note)).toMatchObject({ kind: 'note', version: 2, text: 'Listen here.' });
    expect(kinds.get(change)).toMatchObject({ kind: 'response', version: 2, text: 'Cleaned the last part.' });
    expect(kinds.get(term)).toMatchObject({ kind: 'term_note', passage: 'light', text: 'Heard it said so.' });
    expect(kinds.get(term)!.file).toMatch(/^Dinka \(din\)\/Key terms\//);
    for (const r of p.manifest) expect(r.file).not.toBe('');
  });

  it('keeps verse labels, formats, and the cleaned part with the original recorder', () => {
    const p = plan();
    const rec = (hash: string, v: number) => p.manifest.find((r) => r.kind === 'recording' && r.hash === hash && r.version === v)!;
    expect(rec(a, 1)).toMatchObject({ verseMark: 'set', verseFrom: '3:1', verseTo: '3:5', durationMs: 1000 });
    expect(rec(b, 1)).toMatchObject({ verseMark: 'next', verseFrom: '' });
    expect(rec(wav, 1)).toMatchObject({ format: 'wav', verseMark: 'none' });
    expect(rec(cleaned, 2)).toMatchObject({ format: 'm4a', by: 'AKOL', durationMs: 500 });
    expect(p.audio.find((x) => x.hash === wav)!.ext).toBe('wav');
  });

  it('puts a passage across two chapters, and one outside the Bible, where a person looks for them', () => {
    const p = plan();
    expect(p.manifest.find((r) => r.hash === a)!.file).toMatch(/^Dinka \(din\)\/43 John\/Chapters 03-04\//);
    const sheet = p.texts.find((t) => t.path === 'metadata/passages.csv')!.content;
    expect(sheet).toContain('Welcome');
    expect(sheet).toContain('Other');
  });

  it('says who works where: roles by scope, languages, and what each person did', () => {
    const p = plan();
    const people = p.texts.find((t) => t.path === 'spreadsheets/people.csv')!.content;
    expect(people).toContain('Organization Admin (organization)');
    expect(people).toMatch(/AKOL,akol,Translator \(Dinka\),Dinka,2,/);
    const months = p.texts.find((t) => t.path === 'spreadsheets/activity-by-month.csv')!.content;
    expect(months).toContain('2026-09');
    const terms = p.texts.find((t) => t.path === 'metadata/key-terms.csv')!.content;
    expect(terms).toContain('light,not dark,nyin');
    expect(p.texts.find((t) => t.path === 'metadata/notes.csv')!.content).toContain('A plain note.');
  });

  it('marks the approved version when the review cleared its step, and writes each file once', () => {
    const p = plan();
    expect(new Set(p.audio.map((x) => x.path)).size).toBe(p.audio.length);
    expect(p.manifest.some((r) => r.current)).toBe(true);
  });

  it('exports an organization with no languages as sheets with headers only', () => {
    const f = build();
    const p = planOrgExport({ orgId: 'o', org: f.org, languages: [], nameOf: (id) => id, now: 0 });
    expect(p.manifest).toEqual([]);
    expect(p.texts.find((t) => t.path === 'manifest.csv')!.content).toContain('kind,language');
  });
});
