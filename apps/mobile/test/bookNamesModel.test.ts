import { emptyLanguageState, type LibraryItemView, type NamesDoc } from '@langquest-next/core';
import type { SharedItem } from '../src/library/model';
import { nameSets, namesFor, namesInOrder, namesInUse, sampleNames } from '../src/templates/bookNamesModel';

const doc = (language: string, books: [string, string][]): NamesDoc => ({
  format: 'names@1', name: `Bible book names (${language})`, description: '', language, books: books.map(([book, name]) => ({ book, name })), deps: []
});
const NEPALI = doc('npi', [['GEN', 'उत्पत्ति'], ['MAT', 'मत्ती'], ['MRK', 'मर्कूस'], ['LUK', 'लूका'], ['JHN', 'यूहन्ना']]);
const HINDI = doc('hin', [['MAT', 'मत्ती']]);
const SWAHILI = doc('swh', [['MAT', 'Mathayo']]);
const shared = (item: string, hash: string): SharedItem => ({
  org_id: 'langquest', org_name: 'LangQuest', item_id: item, kind: 'names', name: item, description: '', subscribable: true, version_count: 1, latest_hash: hash, updated_hlc: ''
});
const own = { itemId: 'ours.npi', name: 'Our Nepali names', current: 'o'.repeat(64) } as LibraryItemView;

describe('book names by language (decision 193)', () => {
  const sets = nameSets([{ it: own, doc: NEPALI }], [
    { s: shared('langquest.names.npi', 'n'.repeat(64)), doc: NEPALI },
    { s: shared('langquest.names.hin', 'h'.repeat(64)), doc: HINDI },
    { s: shared('langquest.names.swa', 's'.repeat(64)), doc: SWAHILI },
    // A document not yet arrived, or not book names, is not a set.
    { s: shared('langquest.names.fra', 'f'.repeat(64)), doc: null }
  ]);

  it("lists the organization's own first, then what others share", () => {
    expect(sets.map((s) => s.key)).toEqual(['ours.npi', 'langquest/langquest.names.npi', 'langquest/langquest.names.hin', 'langquest/langquest.names.swa']);
    expect(sets[1]).toMatchObject({ itemId: null, from: 'LangQuest', docHash: 'n'.repeat(64) });
  });

  it("starts a new language on the first of its translators' languages that has names, its own before another's", () => {
    expect(namesFor(sets, ['npi', 'hin'])?.key).toBe('ours.npi');
    expect(namesFor(sets, ['tpi', 'hin'])?.key).toBe('langquest/langquest.names.hin');
    // Swahili written swa finds the names written swh.
    expect(namesFor(sets, ['swa'])?.key).toBe('langquest/langquest.names.swa');
    expect(namesFor(sets, ['tpi'])).toBeNull();
  });

  it("lists the team's languages first, in the team's order", () => {
    const { team, rest } = namesInOrder(sets, ['hin', 'npi']);
    expect(team.map((s) => s.key)).toEqual(['langquest/langquest.names.hin', 'ours.npi', 'langquest/langquest.names.npi']);
    expect(rest.map((s) => s.key)).toEqual(['langquest/langquest.names.swa']);
  });

  it('knows the set the language uses, by item or by version', () => {
    const state = { ...emptyLanguageState(), bookNamesFrom: { value: { itemId: 'ours.npi', docHash: 'x'.repeat(64), language: 'npi', names: {} }, hlc: '1', eventId: 'e' } };
    expect(sets.filter((s) => namesInUse(s, state)).map((s) => s.key)).toEqual(['ours.npi']);
    expect(namesInUse(sets[0]!, emptyLanguageState())).toBe(false);
  });

  it('shows a few names: the Gospels, else the first books', () => {
    expect(sampleNames(NEPALI, ', ')).toBe('मत्ती, मर्कूस, लूका, यूहन्ना');
    expect(sampleNames(doc('xyz', [['GEN', 'A'], ['EXO', 'B']]), ', ')).toBe('A, B');
  });
});
