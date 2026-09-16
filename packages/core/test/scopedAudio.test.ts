import { deriveDownloadWork } from '../src/blobs';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { buildFixture } from './fixtures';

function prepared() {
  const state = fold(buildFixture(), emptyState()) as any;
  const reg = (blobHash: string) => ({ hlc: '1', eventId: blobHash, value: { blobHash } });
  state.materials.global = {
    kind: 'brief', title: 'Global', scope: {}, createdBy: 'a', hlc: '1', locked: { value: false },
    fields: { audio: reg('global') }
  };
  state.materials.lane = {
    kind: 'brief', title: 'L1', scope: { laneId: 'L1' }, createdBy: 'a', hlc: '1', locked: { value: false },
    fields: { audio: reg('lane') }
  };
  state.materials.otherLane = {
    kind: 'brief', title: 'L2', scope: { laneId: 'L2' }, createdBy: 'a', hlc: '1', locked: { value: false },
    fields: { audio: reg('other-lane') }
  };
  state.materials.questionsAudio = {
    kind: 'questions', title: 'Questions', scope: { laneId: 'L1' }, createdBy: 'a', hlc: '1', locked: { value: false },
    fields: { audio: reg('question') }
  };
  state.keyTerms['earlier'] = {
    laneId: 'L1', term: 'Earlier', gloss: '', unitScope: ['luke'], renderings: {},
    adjustments: { audio: { blobHash: 'term', duringTakeId: 'take2', actorId: 't1', hlc: '1' } }
  };
  state.responses = { take2: { respondsToTakeId: 'take1', blobHash: 'response', actorId: 't1', hlc: '1' } };
  for (const hash of ['global', 'lane', 'other-lane', 'question', 'term', 'response', 'sha256:ov1', 'c1']) state.blobs[hash] = { stored: true, size: 1 };
  return state;
}

describe('scoped reference and term audio', () => {
  it('includes inherited, global, matching-lane, prior-term, response, and question audio', () => {
    const hashes = deriveDownloadWork(prepared(), new Set(), new Set(['luke1'])).map((x) => x.hash);
    expect(hashes).toEqual(expect.arrayContaining(['sha256:ov1', 'global', 'lane', 'term', 'response', 'question']));
    expect(hashes).not.toContain('other-lane');
  });

  it('keeps a shared hash when its canonical recording belongs elsewhere', () => {
    const state = prepared();
    state.materials.lane.fields.audio.value.blobHash = 'c1';
    expect(deriveDownloadWork(state, new Set(), new Set(['luke1'])).map((x) => x.hash)).toContain('c1');
  });

  it('does not download anything for an empty explicit scope', () => {
    expect(deriveDownloadWork(prepared(), new Set(), new Set())).toEqual([]);
  });
});
