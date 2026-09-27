import { describe, expect, it } from 'vitest';
import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { encodeHlc } from '../src/hlc';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { clockOf, contextNotes, passageNotes, studyNotes, verseNotes, versionNotes } from '../src/context';
import { derivePassageRecord } from '../src/record';
import { deriveDownloadWork, referencedBlobs } from '../src/blobs';
import { EVENT_REGISTRY } from '../src/eventRegistry';
const validatePayload = (_t: 'v1.ContextItemAdded', p: Record<string, unknown>) => EVENT_REGISTRY['v1.ContextItemAdded'].validate(p);

function log() {
  const events: AnyEvent[] = [];
  let tick = 0;
  const add = <T extends EventType>(actorId: string, type: T, payload: EventPayloads[T]) => {
    tick++;
    events.push({
      id: `e${String(tick).padStart(3, '0')}`, type, orgId: 'o', projectId: 'p', actorId, deviceId: `d-${actorId}`,
      hlc: encodeHlc(1_700_000_000_000 + tick * 1000, 0, `d-${actorId}`), payload
    } as AnyEvent);
  };
  add('lead', 'v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
  add('lead', 'v1.MemberAdded', { profileId: 't1', role: 'translator' });
  add('lead', 'v1.LaneAdded', { laneId: 'L', languoidId: 'xyz' });
  add('lead', 'v1.LaneAdded', { laneId: 'M', languoidId: 'abc' });
  add('lead', 'v1.UnitAdded', { unitId: 'p1', parentUnitId: null, kind: 'passage', label: 'Mark 2:1-12', order: 'a1' });
  add('lead', 'v1.UnitAdded', { unitId: 'p2', parentUnitId: null, kind: 'passage', label: 'Mark 2:13-17', order: 'a2' });
  const note = (itemId: string, extra: Partial<EventPayloads['v1.ContextItemAdded']>) =>
    add('t1', 'v1.ContextItemAdded', { itemId, kind: 'note', home: { level: 'unit', laneId: 'L', unitId: 'p1' }, anchors: [{ type: 'unit', unitId: 'p1' }], text: itemId, ...extra });
  return { events, add, note };
}
const state = (events: AnyEvent[]) => fold(events, emptyState());

describe('anchored notes (ContextItemAdded)', () => {
  it('many notes follow one passage; nothing overwrites an earlier note', () => {
    // Why (J-REC-2): the old sheet kept one note per passage and a second
    // note replaced the first. Notes are facts, each with its own id.
    const l = log();
    l.note('n1', {});
    l.add('t1', 'v1.ContextItemAdded', { itemId: 'n2', kind: 'note', home: { level: 'unit', laneId: 'L', unitId: 'p1' }, anchors: [], blobHash: 'voice' });
    l.note('other-lane', { home: { level: 'unit', laneId: 'M', unitId: 'p1' } });
    const s = state(l.events);
    expect(passageNotes(s, 'p1', 'L').map((n) => n.itemId)).toEqual(['n1', 'n2']);
    expect(passageNotes(s, 'p1', 'L')[0]).toMatchObject({ by: 't1', kind: 'note', text: 'n1' });
    expect(referencedBlobs(s).get('voice')).toMatchObject({ unitId: 'p1', format: 'm4a' });
  });

  it('legacy ReferenceAttached and the guideline note fold in as unit notes', () => {
    // Why: a passage's older notes must not vanish when the new sheet opens.
    const l = log();
    l.add('lead', 'v1.ReferenceAttached', { unitId: 'p1', refId: 'r1', kind: 'passage_note', text: 'Old note' });
    l.add('lead', 'v1.MaterialDefined', { materialId: 'tg:L', kind: 'translation_guidelines', title: 'Guidelines', scope: { laneId: 'L' } } as EventPayloads['v1.MaterialDefined']);
    l.add('t1', 'v1.MaterialFieldSet', { materialId: 'tg:L', fieldId: 'p1', text: 'Guideline note' });
    const s = state(l.events);
    const notes = passageNotes(s, 'p1', 'L');
    expect(notes.map((n) => n.legacy).sort()).toEqual(['guidelines', 'reference']);
    expect(notes.some((n) => n.text === 'Old note')).toBe(true);
    // Legacy notes stay out of the record history (a reference note has no clock or author).
    expect(derivePassageRecord(s, 'p1', 'L', 't1').history.some((h) => h.kind === 'note')).toBe(false);
  });

  it('a study note at a moment keeps integer ms and sorts by moment', () => {
    // Why (J-STUDY-2): "Add a note at 3:12" must seek back to 3:12; a
    // string "3:12" could not sort or seek reliably.
    const l = log();
    l.note('late', { anchors: [{ type: 'study', materialId: 'fia', stepId: 'stage', atMs: 192_000 }] });
    l.note('early', { anchors: [{ type: 'study', materialId: 'fia', stepId: 'stage', atMs: 65_000 }] });
    l.note('section', { anchors: [{ type: 'study', materialId: 'fia', stepId: 'stage', sectionId: 's1' }] });
    const s = state(l.events);
    expect(studyNotes(s, 'fia', 'stage').map((n) => n.itemId)).toEqual(['early', 'late', 'section']);
    expect(clockOf(192_000)).toBe('3:12');
    expect(validatePayload('v1.ContextItemAdded', { itemId: 'x', kind: 'note', home: { level: 'unit', unitId: 'p1' },
      anchors: [{ type: 'study', materialId: 'fia', stepId: 'stage', atMs: '3:12' }], text: 'x' })).toMatch(/whole milliseconds/);
  });

  it('verse notes group by verse; version notes by the take they are about', () => {
    const l = log();
    l.note('v', { anchors: [{ type: 'verse', unitId: 'p1', verse: '2:5', translation: 'WEB' }] });
    l.note('about', { aboutTakeId: 'take1', anchors: [{ type: 'take', takeId: 'take1' }] });
    const s = state(l.events);
    expect(verseNotes(s, 'p1').get('2:5')?.map((n) => n.itemId)).toEqual(['v']);
    expect(versionNotes(s, 'take1').map((n) => n.itemId)).toEqual(['about']);
  });

  it('notes appear in the passage record history', () => {
    const l = log();
    l.note('n1', {});
    const h = derivePassageRecord(state(l.events), 'p1', 'L', 't1').history;
    expect(h).toContainEqual(expect.objectContaining({ kind: 'note', by: 't1', id: 'note:n1' }));
  });

  it('a note says something and has a valid home', () => {
    const base = { itemId: 'x', kind: 'note', anchors: [] };
    expect(validatePayload('v1.ContextItemAdded', { ...base, home: { level: 'unit', unitId: 'p1' } })).toMatch(/say something/);
    expect(validatePayload('v1.ContextItemAdded', { ...base, home: { level: 'lane' }, text: 'x' })).toMatch(/lane home/);
    expect(validatePayload('v1.ContextItemAdded', { ...base, home: { level: 'project' }, text: 'x', anchors: [{ type: 'room' }] })).toMatch(/anchor type/);
    expect(validatePayload('v1.ContextItemAdded', { ...base, home: { level: 'project' }, text: 'x' })).toBeNull();
  });

  it('notes on a passage download with it offline', () => {
    const l = log();
    l.note('n1', { blobHash: 'voice' });
    l.add('server', 'v1.BlobStored', { hash: 'voice', size: 3 });
    const s = state(l.events);
    expect(deriveDownloadWork(s, new Set(), new Set(['p1'])).map((r) => r.hash)).toEqual(['voice']);
    expect(contextNotes(s)).toHaveLength(1);
  });
});
