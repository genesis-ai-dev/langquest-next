// The small pure helpers beside the reference and break-up actions (src/reference/failureModel.ts, src/breakup/model.ts).
import { describe, expect, it, vi } from 'vitest';
import { CommandError } from '@langquest-next/core';
import { t } from '../src/i18n';
import { templateUsersFor } from '../src/breakup/model';
import { levelOf, NETWORK, referenceFailure, serverRefusal } from '../src/reference/failureModel';
import { BibleError } from '../src/sources/bibleBrain';

// The diagnostics module reads the device (expo, react-native); a failure it cannot name is said as its label here.
vi.mock('../src/diagnostics/report', () => ({ failureMessage: (where: string) => `unexpected: ${where}` }));

describe('the level a reference screen changes things at', () => {
  it('is the language in its params when that is the open language, else the organization', () => {
    expect(levelOf({ params: { languageId: 'L1' }, language: { languageId: 'L1' } })).toEqual({ kind: 'language', languageId: 'L1' });
    expect(levelOf({ params: { languageId: 'L2' }, language: { languageId: 'L1' } })).toEqual({ kind: 'org' });
    expect(levelOf({ params: {}, language: { languageId: 'L1' } })).toEqual({ kind: 'org' });
  });
});

describe('what a reference failure says', () => {
  it('recognises a lost connection by the words of the error', () => {
    for (const m of ['Network request failed', 'fetch failed', 'You are offline', 'request timed out', 'timeout', 'Not connected']) expect(NETWORK.test(m)).toBe(true);
    expect(NETWORK.test('permission denied')).toBe(false);
  });

  it('says "not connected" plainly, a command\'s own words, and Bible Brain\'s words, and else the fault with a code', () => {
    expect(referenceFailure('x', new Error('Network request failed'))).toBe(t('common.notConnected'));
    // A command or Bible Brain error that mentions the network is still its own.
    expect(referenceFailure('x', new CommandError('network'))).not.toBe(t('common.notConnected'));
    expect(referenceFailure('x', new BibleError('network is busy', 'unavailable'))).toBe('network is busy');
    expect(referenceFailure('where', new Error('boom'))).toBe('unexpected: where');
  });

  it('turns a server refusal into the person\'s words', () => {
    expect(serverRefusal({ message: 'FetchError: network down' }).message).toBe(t('common.notConnected'));
    expect(serverRefusal({ message: 'denied', code: '42501' }).message).toBe(t('reference.errors.notAllowed'));
    expect(serverRefusal({ message: 'other', code: '23505' }).message).toBe(t('reference.errors.serverRefused'));
    expect(serverRefusal({ message: 'x' })).toBeInstanceOf(CommandError);
  });
});

describe('who a template\'s change reaches', () => {
  const users = [
    { language_id: 'L1', item_id: 'item', unit_prefix: 'u', books: ['RUT'] },
    { language_id: 'L2', item_id: 'item', unit_prefix: 'v', books: null },
    { language_id: 'L3', item_id: 'other', unit_prefix: 'w' }
  ];
  const names: Record<string, string> = { L1: 'Bari', L2: 'Dinka' };

  it('is unknown offline', () => {
    expect(templateUsersFor({ users: null, itemId: 'item', nameOf: (id) => id, mayChange: () => true })).toBeNull();
  });

  it('lists the languages using that template, named, with whether this person may change each and the books it has', () => {
    const out = templateUsersFor({ users, itemId: 'item', nameOf: (id) => names[id]!, mayChange: (id) => id === 'L1' })!;
    expect(out).toEqual([
      { languageId: 'L1', name: 'Bari', mayChange: true, unitPrefix: 'u', books: ['RUT'] },
      { languageId: 'L2', name: 'Dinka', mayChange: false, unitPrefix: 'v' }
    ]);
    expect(out[1]).not.toHaveProperty('books');
  });
});
