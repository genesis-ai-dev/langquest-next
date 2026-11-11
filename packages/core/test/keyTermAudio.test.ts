import { CommandError, commands, type EventSpec } from '../src/commands';
import { keyTermView } from '../src/materials';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState, type LanguageState } from '../src/state';
import { validateEvent } from '../src/validate';
import { EVENT_PRIVILEGE } from '../src/org';
import { buildFixture, buildStep11Fixture } from './fixtures';
import type { AnyEvent } from '../src/events';

/**
 * Why: a recorded example of a key term is what a later check listens for
 * (decision 206). It must fold the same on every phone in any order, refuse
 * a malformed payload, and leave the written rendering's shape alone.
 */
describe('v1.KeyTermAudioRenderingAdded', () => {
  const base = foldLanguage([...buildFixture(), ...buildStep11Fixture()].filter((e) => e.parentEventId === undefined), emptyLanguageState());
  const spec = (commandId: string, durationMs = 900) => commands(base).addKeyTermAudio({ commandId, termId: 'kt-logos', blobHash: `sha256:${commandId}`, durationMs, wayId: 'way:a' });
  const at = (s: EventSpec, n: number, deviceId = 'dB'): AnyEvent =>
    ({ ...s, orgId: 'o', streamId: 'L1', actorId: 't1', deviceId, hlc: `${900000000000000 + n}:000000:${deviceId}` }) as AnyEvent;
  const fold = (events: AnyEvent[]): LanguageState => foldLanguage(events, foldLanguage([...buildFixture(), ...buildStep11Fixture()].filter((e) => e.parentEventId === undefined), emptyLanguageState()));

  it('lists examples oldest first and keeps the written renderings as they were', () => {
    const view = keyTermView(fold([...spec('b'), ...spec('a')].map((s, i) => at(s, i))), 'kt-logos')!;
    expect(view.audioRenderings.map((r) => r.renderingId)).toEqual(['ra1', 'audio:b', 'audio:a']);
    expect(view.renderings).toEqual(keyTermView(base, 'kt-logos')!.renderings);
  });

  it('folds to the same state in any order and when repeated', () => {
    const events = [...spec('a'), ...spec('b'), ...spec('c')].map((s, i) => at(s, i));
    const forward = fold(events).keyTerms;
    expect(fold([...events].reverse()).keyTerms).toEqual(forward);
    expect(fold([...events, ...events]).keyTerms).toEqual(forward);
  });

  it('a retried command is absorbed, and a clip that is empty or long is refused', () => {
    expect(spec('a')).toEqual(spec('a'));
    expect(() => spec('z', 0)).toThrow(CommandError);
    expect(() => spec('z', 31000)).toThrow(CommandError);
    expect(() => commands(base).addKeyTermAudio({ commandId: 'z', termId: 'nope', blobHash: 'h', durationMs: 900, wayId: 'w' })).toThrow(CommandError);
  });

  it('validates its payload and needs fill_reference', () => {
    const ok = at(spec('a')[0]!, 1);
    expect(validateEvent(ok)).toBeNull();
    for (const bad of [{ durationMs: 0 }, { durationMs: 900.5 }, { durationMs: 30001 }, { durationMs: '9' }, { blobHash: '' }, { termId: '' }]) {
      expect(validateEvent({ ...ok, payload: { ...ok.payload, ...bad } } as AnyEvent), JSON.stringify(bad)).not.toBeNull();
    }
    expect(EVENT_PRIVILEGE['v1.KeyTermAudioRenderingAdded']).toBe('fill_reference');
  });
});

describe('v1.KeyTermAudioRenderingAdded and the ways a term is said', () => {
  const base = foldLanguage([...buildFixture(), ...buildStep11Fixture()].filter((e) => e.parentEventId === undefined), emptyLanguageState());
  const clip = (commandId: string, wayId: string) =>
    commands(base).addKeyTermAudio({ commandId, termId: 'kt-logos', blobHash: `sha256:${commandId}`, durationMs: 900, wayId });
  const at = (s: EventSpec, n: number): AnyEvent =>
    ({ ...s, orgId: 'o', streamId: 'L1', actorId: 't1', deviceId: 'dB', hlc: `${900000000000000 + n}:000000:dB` }) as AnyEvent;

  it('keeps repeats of one written rendering apart from another rendering', () => {
    const state = foldLanguage([...clip('a', 'r1'), ...clip('b', 'r1'), ...clip('c', 'r2'), ...clip('d', 'way:oral')].map((s, i) => at(s, i)), base);
    const by: Record<string, string[]> = {};
    for (const e of keyTermView(state, 'kt-logos')!.audioRenderings) (by[e.wayId] ??= []).push(e.renderingId);
    expect(by).toEqual({ r1: ['ra1', 'audio:a', 'audio:b'], r2: ['audio:c'], 'way:oral': ['audio:d'] });
  });

  it('needs a text wayId', () => {
    const ok = at(clip('a', 'r1')[0]!, 1);
    expect(validateEvent(ok)).toBeNull();
    for (const wayId of [7, '', undefined]) expect(validateEvent({ ...ok, payload: { ...ok.payload, wayId } } as unknown as AnyEvent)).not.toBeNull();
    expect(() => clip('q', '')).toThrow(CommandError);
  });

  it('remembers the take a clip was recorded during, so a way can name its passages', () => {
    const spec = commands(base).addKeyTermAudio({ commandId: 'dd', termId: 'kt-logos', blobHash: 'sha256:dd', durationMs: 900, wayId: 'way:a', duringTakeId: 'take2' });
    expect(spec[0]!.payload).toMatchObject({ wayId: 'way:a', duringTakeId: 'take2' });
    const clip = keyTermView(foldLanguage(spec.map((s, i) => at(s, i)), base), 'kt-logos')!.audioRenderings.find((c) => c.renderingId === 'audio:dd');
    expect(clip).toMatchObject({ duringTakeId: 'take2' });
    expect(validateEvent({ ...at(spec[0]!, 1), payload: { ...spec[0]!.payload, duringTakeId: 7 } } as unknown as AnyEvent)).not.toBeNull();
  });
});
