import type { AnyEvent } from '../src/events';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState } from '../src/state';
import { externalKeyError, validateEvent } from '../src/validate';
import { buildRecordFixture } from './fixtures';

const value = (id: string, hlc: string, key: string, data: Record<string, unknown> | null, deviceId = 'api-tok1'): AnyEvent => ({
  id, type: 'v1.ExternalValueSet', orgId: 'org1', streamId: 'L1', actorId: 'p1', deviceId, hlc, payload: { key, data }
});

describe('external values (decisions.md 79)', () => {
  it('keeps the newest write to a key, in any order, with who wrote it', () => {
    const events = [
      value('a', '001700000001000:000000:api-tok1', 'app/k', { n: 1 }),
      value('b', '001700000002000:000000:api-tok2', 'app/k', { n: 2 }, 'api-tok2')
    ];
    for (const order of [events, [...events].reverse()]) {
      const s = foldLanguage(order, emptyLanguageState());
      expect(s.externalValues['app/k']).toEqual({ value: { data: { n: 2 }, actorId: 'p1', deviceId: 'api-tok2' }, hlc: '001700000002000:000000:api-tok2', eventId: 'b' });
    }
  });

  it('settles a clock tie by the higher id, and keeps a deleted key as null', () => {
    // Why: two Worker requests can stamp the same millisecond; every device must pick the same one.
    const hlc = '001700000001000:000000:api-tok1';
    const tie = [value('x1', hlc, 'app/k', { n: 1 }), value('x2', hlc, 'app/k', null)];
    for (const order of [tie, [...tie].reverse()]) {
      expect(foldLanguage(order, emptyLanguageState()).externalValues['app/k']!.value.data).toBeNull();
    }
  });

  it('folds the fixture: the later of two tokens wins, and a deleted playlist reads null', () => {
    const s = foldLanguage(buildRecordFixture(), emptyLanguageState());
    expect(s.externalValues['org.everylanguage.listening/plays/luke1/2026-10-08']!.value.data).toEqual({ count: 42 });
    expect(s.externalValues['org.everylanguage.listening/playlist/7']!.value.data).toBeNull();
  });

  it('accepts keys that read back unchanged as a URL path, and nothing else', () => {
    expect(externalKeyError('org.everylanguage.listening/plays/MRK.1.1-8/2026-10-08')).toBeNull();
    expect(externalKeyError('a:b@c~d+e_f')).toBeNull();
    for (const bad of ['', '/lead', 'trail/', 'a//b', 'a b', 'a?b', 'a#b', 'a%20b', '.', 'a/../b', 'a/./b', 'x'.repeat(257), 5, null]) {
      expect(externalKeyError(bad), String(bad)).not.toBeNull();
    }
    expect(externalKeyError('x'.repeat(256))).toBeNull();
  });

  it('takes an object or null as data, never a bare value', () => {
    const e = value('v', '001700000001000:000000:api-tok1', 'app/k', null);
    for (const data of [[1], 'text', 3, true, undefined]) {
      expect(validateEvent({ ...e, payload: { key: 'app/k', data } } as never)).toMatch(/data/);
    }
    expect(validateEvent(e)).toBeNull();
  });
});
