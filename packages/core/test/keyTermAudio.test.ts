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
 * (decision 205). It must fold the same on every phone in any order, refuse
 * a malformed payload, and leave the written rendering's shape alone.
 */
describe('v1.KeyTermAudioRenderingAdded', () => {
  const base = foldLanguage([...buildFixture(), ...buildStep11Fixture()].filter((e) => e.parentEventId === undefined), emptyLanguageState());
  const spec = (commandId: string, durationMs = 900) => commands(base).addKeyTermAudio({ commandId, termId: 'kt-logos', blobHash: `sha256:${commandId}`, durationMs });
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
    expect(() => commands(base).addKeyTermAudio({ commandId: 'z', termId: 'nope', blobHash: 'h', durationMs: 900 })).toThrow(CommandError);
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
