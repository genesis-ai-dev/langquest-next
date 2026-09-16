import { getReferenceSlides, referenceRunSignature } from '../src/passageResources';

function state() {
  return {
    units: {
      book: { parentUnitId: null },
      passage: { parentUnitId: 'book' }
    },
    materials: {
      laneAudio: {
      kind: 'brief', title: 'Walkthrough', scope: { laneId: 'L' },
        createdBy: 'a', locked: { value: false },
        fields: { intro: { hlc: '1', value: { blobHash: 'm1' } } }
      },
      questions: {
        kind: 'questions', title: 'Questions', scope: { laneId: 'L' },
        createdBy: 'a', locked: { value: false },
        fields: { q: { hlc: '1', value: { blobHash: 'q1' } } }
      }
    },
    references: {
      inherited: { unitId: 'book', kind: 'source_audio', blobHash: 'r1' },
      excluded: { unitId: 'passage', kind: 'review_questions', blobHash: 'r2' },
    },
    recordings: {},
    takes: {}, keyTerms: {}, keyTermLinks: {}, lanes: {},
  } as any;
}

describe('passage reference resources', () => {
  it('inherits ancestor audio and excludes question audio', () => {
    const slides = getReferenceSlides(state(), 'L', 'passage');
    expect(slides.map((s) => s.hash)).toEqual(['r1', 'm1']);
  });

  it('creates an order-independent stable signature', () => {
    const a = getReferenceSlides(state(), 'L', 'passage');
    expect(referenceRunSignature(a)).toBe(referenceRunSignature(a.slice().reverse()));
  });
});
