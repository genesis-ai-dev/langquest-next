import { getReferenceSlides, referenceRunSignature } from '../src/passageResources';

function state() {
  return {
    units: {
      book: { parentUnitId: null },
      passage: { parentUnitId: 'book' }
    },
    materials: {
      bookAudio: {
        kind: 'brief', title: 'Walkthrough', scope: { unitId: 'book' },
        createdBy: 'a', locked: { value: false },
        fields: { intro: { hlc: '1', value: { blobHash: 'm1' } } }
      },
      questions: {
        kind: 'questions', title: 'Questions', scope: {},
        createdBy: 'a', locked: { value: false },
        fields: { q: { hlc: '1', value: { blobHash: 'q1' } } }
      }
    },
    recordings: {},
    takes: {}, keyTerms: {}, keyTermLinks: {},
  } as any;
}

describe('passage reference resources', () => {
  it('inherits ancestor material audio and excludes question audio', () => {
    const slides = getReferenceSlides(state(), 'passage');
    expect(slides.map((s) => s.hash)).toEqual(['m1']);
  });

  it('creates an order-independent stable signature', () => {
    const a = getReferenceSlides(state(), 'passage');
    expect(referenceRunSignature(a)).toBe(referenceRunSignature(a.slice().reverse()));
  });

  it('includes source recordings, without target audio', () => {
    const s = state();
    s.recordings = {
      source: { kind: 'source', unitId: 'passage',
        cards: [{ hash: 'source', format: 'wav' }] },
      target: { kind: 'target', unitId: 'passage',
        cards: [{ hash: 'target', format: 'wav' }] }
    };
    expect(getReferenceSlides(s, 'passage').map((item) => item.hash))
      .toEqual(['m1', 'source']);
  });
});
