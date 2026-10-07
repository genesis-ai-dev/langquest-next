import { deriveDownloadWork } from '../src/blobs';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState } from '../src/state';
import { buildFixture } from './fixtures';

function prepared() {
  const state = foldLanguage(buildFixture(), emptyLanguageState()) as any;
  const reg = (blobHash: string) => ({ hlc: '1', eventId: blobHash, value: { blobHash } });
  state.materials.global = {
    kind: 'brief', title: 'Global', scope: {}, createdBy: 'a', hlc: '1', locked: { value: false },
    fields: { audio: reg('global') }
  };
  // Scoped to the book that contains luke1: inherited.
  state.materials.book = {
    kind: 'brief', title: 'Luke', scope: { unitId: 'luke' }, createdBy: 'a', hlc: '1', locked: { value: false },
    fields: { audio: reg('book') }
  };
  // Scoped to a unit luke1 does not sit under: not inherited.
  state.materials.otherUnit = {
    kind: 'brief', title: 'John', scope: { unitId: 'john' }, createdBy: 'a', hlc: '1', locked: { value: false },
    fields: { audio: reg('other-unit') }
  };
  state.materials.questionsAudio = {
    kind: 'questions', title: 'Questions', scope: {}, createdBy: 'a', hlc: '1', locked: { value: false },
    fields: { audio: reg('question') }
  };
  state.keyTerms['earlier'] = {
    term: 'Earlier', gloss: '', unitScope: ['luke'], renderings: {},
    adjustments: { audio: { blobHash: 'term', duringTakeId: 'take2', actorId: 't1', hlc: '1' } }
  };
  state.responses = { take2: { respondsToTakeId: 'take1', blobHash: 'response', actorId: 't1', hlc: '1' } };
  for (const hash of ['global', 'book', 'other-unit', 'question', 'term', 'response', 'c1']) state.blobs[hash] = { stored: true, size: 1 };
  return state;
}

describe('scoped reference and term audio', () => {
  it('includes inherited, global, ancestor-scoped, prior-term, response, and question audio', () => {
    // Why: a passage kept offline must bring the reference audio it inherits
    // from the language and its book, and nothing scoped to other passages.
    const hashes = deriveDownloadWork(prepared(), new Set(), new Set(['luke1'])).map((x) => x.hash);
    expect(hashes).toEqual(expect.arrayContaining(['c1', 'global', 'book', 'term', 'response', 'question']));
    expect(hashes).not.toContain('other-unit');
  });

  it('keeps a shared hash when its canonical recording belongs elsewhere', () => {
    const state = prepared();
    state.materials.book.fields.audio.value.blobHash = 'c1';
    expect(deriveDownloadWork(state, new Set(), new Set(['luke1'])).map((x) => x.hash)).toContain('c1');
  });

  it('does not download anything for an empty explicit scope', () => {
    expect(deriveDownloadWork(prepared(), new Set(), new Set())).toEqual([]);
  });
});
