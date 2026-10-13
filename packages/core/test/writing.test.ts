import { createHash } from 'node:crypto';
import { deriveUploadWork, referencedBlobs } from '../src/blobs';
import { commands } from '../src/commands';
import type { AnyEvent, EventType } from '../src/events';
import { encodeHlc } from '../src/hlc';
import { approvedVersion, derivePassage, madeGrid } from '../src/passage';
import { foldLanguage } from '../src/reducer';
import { validateEvent } from '../src/validate';
import { defaultBecomesVersion, isWrittenPart, mediaAllowed, partsMedium, sha256Hex, writtenPartId, writtenText } from '../src/writing';

/**
 * Writing beside recording, and steps that make something (decisions.md 93).
 */

const env = (type: EventType, payload: unknown, n = 1): AnyEvent =>
  ({ id: `e${n}`, type, orgId: 'o', streamId: 'L', actorId: 'p', deviceId: 'd', hlc: encodeHlc(1_700_000_000_000 + n * 1000, 0, 'd'), payload }) as AnyEvent;

describe('written part ids', () => {
  it('are w: and the SHA-256 of the UTF-8 words, as Node computes it', () => {
    for (const text of ['', 'abc', 'Ŋa lo kɔn i ka ti ɛ kine mia gelɛ?', 'ሰላም', '😀 emoji and ́ a combining mark', 'x'.repeat(2000)]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
    expect(writtenPartId('abc')).toBe('w:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(isWrittenPart(writtenPartId('x'))).toBe(true);
    expect(isWrittenPart('a'.repeat(64))).toBe(false);
  });

  it('tell a written take from a recorded one by its parts alone', () => {
    expect(partsMedium([writtenPartId('a'), writtenPartId('b')])).toBe('writing');
    expect(partsMedium(['a'.repeat(64)])).toBe('recording');
    expect(partsMedium([])).toBe('recording');
  });
});

describe('validation', () => {
  const part = (text: string) => ({ id: writtenPartId(text), text });
  it('takes written parts whose ids are their words', () => {
    expect(validateEvent(env('v1.WritingAdded', { writingId: 'w', unitId: 'u', parts: [part('One verse.')] }))).toBeNull();
    expect(validateEvent(env('v1.WritingAdded', { writingId: 'w', unitId: 'u', parts: [{ id: writtenPartId('Another'), text: 'One verse.' }] }))).toMatch(/SHA-256 of the text/);
    expect(validateEvent(env('v1.WritingAdded', { writingId: 'w', unitId: 'u', parts: [] }))).toMatch(/non-empty/);
    expect(validateEvent(env('v1.WritingAdded', { writingId: 'w', unitId: 'u', parts: [part('x'.repeat(2001))] }))).toMatch(/at most 2000/);
    expect(validateEvent(env('v1.WritingAdded', { writingId: 'w', unitId: 'u', parts: Array.from({ length: 101 }, (_, i) => part(`v${i}`)) }))).toMatch(/at most 100/);
  });

  it('refuses a take that mixes recorded and written parts', () => {
    expect(validateEvent(env('v1.TakeComposed', { takeId: 't', unitId: 'u', cardHashes: ['a'.repeat(64), writtenPartId('x')], parentTakeId: null }))).toMatch(/all recorded or all written/);
    expect(validateEvent(env('v1.TakeComposed', { takeId: 't', unitId: 'u', cardHashes: [writtenPartId('x'), writtenPartId('y')], parentTakeId: null }))).toBeNull();
  });

  it('needs something allowed, and the lead among what is allowed', () => {
    expect(validateEvent(env('v1.MediaAllowedSet', { recording: false, writing: false, first: 'writing' }))).toMatch(/must be allowed/);
    expect(validateEvent(env('v1.MediaAllowedSet', { recording: true, writing: false, first: 'writing' }))).toMatch(/first must be allowed/);
    expect(validateEvent(env('v1.MediaAllowedSet', { recording: true, writing: true, first: 'writing' }))).toBeNull();
  });

  it('lets only a step in the same language make the next version', () => {
    const makes = (m: object) => validateEvent(env('v1.StepMakesSet', { kindId: 'k', makes: { from: 'recording', to: 'recording', language: 'same', becomesVersion: false, ...m } }));
    expect(makes({ becomesVersion: true })).toBeNull();
    expect(makes({ becomesVersion: true, language: 'other' })).toMatch(/same language/);
    expect(makes({ otherLanguage: 'eng' })).toMatch(/another language only/);
    expect(makes({ language: 'other', otherLanguage: 'eng' })).toBeNull();
    expect(validateEvent(env('v1.StepMakesSet', { kindId: 'k', makes: null }))).toBeNull();
  });

  it('needs a made thing to say what it came from, and to hold parts or be a version', () => {
    const made = (p: object) => validateEvent(env('v1.Made', { madeId: 'm', unitId: 'u', ...p }));
    expect(made({ fromTakeId: 't', parts: [{ hash: writtenPartId('x'), durationMs: 0 }] })).toBeNull();
    expect(made({ fromTakeId: 't', fromMadeId: 'm0', parts: [{ hash: 'b', durationMs: 1 }] })).toMatch(/exactly one of fromTakeId/);
    expect(made({ parts: [{ hash: 'b', durationMs: 1 }] })).toMatch(/exactly one of fromTakeId/);
    expect(made({ fromTakeId: 't' })).toMatch(/exactly one of parts, takeId/);
    expect(made({ fromTakeId: 't', takeId: 't2', parts: [{ hash: 'b', durationMs: 1 }] })).toMatch(/exactly one of parts, takeId/);
    expect(made({ fromTakeId: 't', parts: [] })).toMatch(/must not be empty/);
    expect(made({ fromTakeId: 't', parts: [{ hash: 'b', durationMs: 1 }, { hash: writtenPartId('x'), durationMs: 0 }] })).toMatch(/all recorded or all written/);
    expect(made({ fromTakeId: 't', language: '', parts: [{ hash: 'b', durationMs: 1 }] })).toMatch(/language code/);
  });
});

/** One passage, its recorded Version 1, in a flow of peer, consultant, a final recording, then community. */
function world(...extra: [EventType, unknown][]) {
  const events: AnyEvent[] = [
    ['v1.UnitAdded', { unitId: 'u', parentUnitId: null, kind: 'passage', label: 'U', order: 'a' }],
    ['v1.FlowSelected', { flowId: 'f', name: 'F' }],
    ['v1.FlowStepSet', { stepId: 'f/s1', order: 's00', kindIds: ['peer'], checkpoint: false }],
    ['v1.FlowStepSet', { stepId: 'f/s2', order: 's01', kindIds: ['consultant'], checkpoint: true }],
    ['v1.ReviewKindDefined', { kindId: 'final', name: 'Final recording' }],
    ['v1.StepMakesSet', { kindId: 'final', makes: { from: 'recording', to: 'recording', language: 'same', becomesVersion: true } }],
    ['v1.FlowStepSet', { stepId: 'f/s3', order: 's02', kindIds: ['final'], checkpoint: false }],
    ['v1.FlowStepSet', { stepId: 'f/s4', order: 's03', kindIds: ['community'], checkpoint: false }],
    ['v1.TakeComposed', { takeId: 't1', unitId: 'u', cardHashes: ['a'.repeat(64)], parentTakeId: null }],
    ['v1.TakeSubmitted', { takeId: 't1' }],
    ...extra
  ].map(([type, payload], i) => env(type as EventType, payload, i + 1));
  const state = foldLanguage(events);
  return { state, s: derivePassage(state, 'u') };
}
const looksGood = (reviewId: string, takeId: string, kindId: string): [EventType, unknown] =>
  ['v1.ReviewRecorded', { reviewId, takeId, kindId, outcome: 'looks_good', via: 'app' }];

describe('a step whose result becomes the version', () => {
  const finalVersion: [EventType, unknown][] = [
    ['v1.TakeComposed', { takeId: 't2', unitId: 'u', cardHashes: ['b'.repeat(64)], parentTakeId: 't1' }],
    ['v1.TakeSubmitted', { takeId: 't2' }],
    ['v1.Made', { madeId: 'm', unitId: 'u', kindId: 'final', fromTakeId: 't1', takeId: 't2' }]
  ];

  it('makes the passage approved at the new version, with the checks before it counted from the old one', () => {
    const { s } = world(looksGood('r1', 't1', 'peer'), looksGood('r2', 't1', 'consultant'), ...finalVersion, looksGood('r3', 't2', 'community'));
    expect(s.versions.at(-1)).toMatchObject({ takeId: 't2', madeByKindId: 'final', madeFromTakeId: 't1' });
    expect(approvedVersion(s)?.takeId).toBe('t2');
    expect(s.steps[2]?.kinds[0]?.state).toBe('approved');
  });

  it('still needs the checks after it on the new version', () => {
    const { s } = world(looksGood('r1', 't1', 'peer'), looksGood('r2', 't1', 'consultant'), ...finalVersion, looksGood('r3', 't1', 'community'));
    expect(approvedVersion(s)?.takeId).not.toBe('t2');
  });

  it('is never inherited by a version someone records by hand', () => {
    const { s } = world(looksGood('r1', 't1', 'peer'), looksGood('r2', 't1', 'consultant'),
      ['v1.TakeComposed', { takeId: 't2', unitId: 'u', cardHashes: ['b'.repeat(64)], parentTakeId: 't1' }], ['v1.TakeSubmitted', { takeId: 't2' }],
      looksGood('r3', 't2', 'community'));
    expect(approvedVersion(s)).toBeNull();
  });

  it('leaves what it made out of the things made beside a version', () => {
    const { s } = world(...finalVersion);
    expect(s.made).toEqual([]);
  });
});

describe('things made from a version', () => {
  const words = ['Ŋa lo kɔn.', 'Ku lɔ yinga.'].map((text) => ({ id: writtenPartId(text), text }));
  const writeDown: [EventType, unknown][] = [
    ['v1.ReviewKindDefined', { kindId: 'write', name: 'Write it down' }],
    ['v1.StepMakesSet', { kindId: 'write', makes: { from: 'recording', to: 'writing', language: 'same', becomesVersion: false } }],
    ['v1.FlowStepSet', { stepId: 'f/s5', order: 's04', kindIds: ['write'], checkpoint: false }]
  ];

  it('mark a making step done once it made something, from any version, and stay with that version', () => {
    const before = world(...writeDown).s;
    expect(before.steps.find((st) => st.step.kindIds.includes('write'))?.kinds[0]?.state).toBe('locked'); // behind the consultant checkpoint
    const { state, s } = world(...writeDown,
      ['v1.WritingAdded', { writingId: 'w', unitId: 'u', parts: words }],
      ['v1.Made', { madeId: 'm', unitId: 'u', kindId: 'write', fromTakeId: 't1', parts: words.map((x) => ({ hash: x.id, durationMs: 0 })) }],
      ['v1.TakeComposed', { takeId: 't2', unitId: 'u', cardHashes: ['b'.repeat(64)], parentTakeId: 't1' }], ['v1.TakeSubmitted', { takeId: 't2' }]);
    expect(s.steps.find((st) => st.step.kindIds.includes('write'))?.kinds[0]?.state).toBe('approved');
    expect(s.made).toHaveLength(1);
    expect(s.made[0]).toMatchObject({ medium: 'writing', fromTakeId: 't1', kindId: 'write' });
    expect(writtenText(state, words[0]!.id)).toBe('Ŋa lo kɔn.');
    const grid = madeGrid(s);
    expect(grid.columns.map((c) => c.key)).toEqual(['kind:write']);
    expect(grid.byVersion.get('t1')?.get('kind:write')).toHaveLength(1);
    expect(grid.byVersion.get('t2')).toBeUndefined();
  });

  it('with no step (brought over from v2) get a column by what they are, only where they exist', () => {
    const { s } = world(['v1.Made', { madeId: 'm', unitId: 'u', fromTakeId: 't1', language: 'eng', parts: [{ hash: 'c'.repeat(64), durationMs: 900 }] }]);
    expect(madeGrid(s).columns).toEqual([{ key: 'recording:eng', medium: 'recording', language: 'eng' }]);
    expect(madeGrid(world().s).columns).toEqual([]);
  });

  it('close the request that asked for them', () => {
    const { s } = world(...writeDown,
      ['v1.RequestMade', { requestId: 'q', unitId: 'u', what: 'review', kindId: 'write', profileId: 'p2' }],
      ['v1.WritingAdded', { writingId: 'w', unitId: 'u', parts: words }],
      ['v1.Made', { madeId: 'm', unitId: 'u', kindId: 'write', fromTakeId: 't1', requestId: 'q', parts: words.map((x) => ({ hash: x.id, durationMs: 0 })) }]);
    expect(s.requests.find((r) => r.id === 'q')?.status).toBe('done');
  });

  it('are files only when recorded; written parts never upload', () => {
    const { state } = world(
      ['v1.WritingAdded', { writingId: 'w', unitId: 'u', parts: words }],
      ['v1.Made', { madeId: 'm1', unitId: 'u', fromTakeId: 't1', parts: words.map((x) => ({ hash: x.id, durationMs: 0 })) }],
      ['v1.Made', { madeId: 'm2', unitId: 'u', fromTakeId: 't1', language: 'eng', parts: [{ hash: 'c'.repeat(64), durationMs: 900, format: 'm4a' }] }]);
    const refs = referencedBlobs(state);
    expect(refs.has('c'.repeat(64))).toBe(true);
    expect([...refs.keys()].some(isWrittenPart)).toBe(false);
    expect(deriveUploadWork(state, new Set(words.map((x) => x.id))).length).toBe(0);
  });

  it('read a written version as written', () => {
    const { s } = world(['v1.WritingAdded', { writingId: 'w', unitId: 'u', parts: words }],
      ['v1.TakeComposed', { takeId: 't2', unitId: 'u', cardHashes: words.map((x) => x.id), parentTakeId: 't1' }], ['v1.TakeSubmitted', { takeId: 't2' }]);
    expect(s.versions.map((v) => v.medium)).toEqual(['recording', 'writing']);
  });
});

describe('commands', () => {
  const words = ['One.', 'Two.', 'One.'].map((text) => ({ id: writtenPartId(text), text }));
  it('write only the parts the log lacks, at most 100 an event', () => {
    const { state } = world(['v1.WritingAdded', { writingId: 'w0', unitId: 'u', parts: [words[0]] }]);
    const specs = commands(state).addWriting({ commandId: 'c', unitId: 'u', parts: words });
    expect(specs).toHaveLength(1);
    expect((specs[0]!.payload as { parts: unknown[] }).parts).toEqual([words[1]]);
    const many = Array.from({ length: 150 }, (_, i) => ({ id: writtenPartId(`v${i}`), text: `v${i}` }));
    expect(commands(state).addWriting({ commandId: 'c', unitId: 'u', parts: many }).map((x) => (x.payload as { parts: unknown[] }).parts.length)).toEqual([100, 50]);
  });

  it('make a version from a step, saying which step made it', () => {
    const { state } = world();
    const specs = commands(state).makeVersion({ commandId: 'c', unitId: 'u', kindId: 'final', fromTakeId: 't1', cardHashes: ['b'.repeat(64)], actorId: 'p' });
    expect(specs.map((x) => x.type)).toEqual(['v1.TakeComposed', 'v1.TakeSubmitted', 'v1.Made']);
    expect(specs[2]!.payload).toMatchObject({ kindId: 'final', fromTakeId: 't1', takeId: 'take:c' });
  });

  it('keep recorded and written parts apart, and need a published version to make from', () => {
    const { state } = world();
    expect(() => commands(state).make({ commandId: 'c', unitId: 'u', fromTakeId: 't1', parts: [{ hash: 'b', durationMs: 1 }, { hash: writtenPartId('x'), durationMs: 0 }] })).toThrow(/kept apart/);
    expect(() => commands(state).make({ commandId: 'c', unitId: 'u', fromTakeId: 'nope', parts: [{ hash: 'b', durationMs: 1 }] })).toThrow(/published version/);
  });

  it('allow what the team makes, defaulting to recording only', () => {
    expect(mediaAllowed(world().state)).toEqual({ recording: true, writing: false, first: 'recording' });
    const { state } = world(['v1.MediaAllowedSet', { recording: true, writing: true, first: 'writing' }]);
    expect(mediaAllowed(state).first).toBe('writing');
    expect(() => commands(state).setMediaAllowed({ commandId: 'c', recording: false, writing: false, first: 'writing' })).toThrow();
  });
});

describe('the switch on a making step', () => {
  it('starts on for the same kind in the same language, and off for writing a recording down', () => {
    expect(defaultBecomesVersion({ from: 'recording', to: 'recording', language: 'same' })).toBe(true);
    expect(defaultBecomesVersion({ from: 'writing', to: 'writing', language: 'same' })).toBe(true);
    expect(defaultBecomesVersion({ from: 'recording', to: 'writing', language: 'same' })).toBe(false);
    expect(defaultBecomesVersion({ from: 'recording', to: 'recording', language: 'other' })).toBe(false);
  });
});
