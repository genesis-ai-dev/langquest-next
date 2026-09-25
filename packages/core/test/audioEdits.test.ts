import { validTakeMetadata, type TakeMetadata } from '../src/audioEdits';
import { changeEdit, editDuration, redoEdit, replaceSegments, undoEdit, type EditHistory } from '../../../apps/mobile/src/audioEditModel';

const metadata: TakeMetadata = { name: 'Passage', milestones: [
  { verseStart: 1, verseEnd: 2, startMs: 0, endMs: 500 },
  { verseStart: 3, verseEnd: 3, startMs: 500 }
] };

describe('verse milestone validation', () => {
  it('accepts point markers and verse ranges inside the rendered audio', () => {
    expect(validTakeMetadata(metadata, 1000)).toBe(true);
  });
  it.each([
    { verseStart: 0 }, { verseStart: 1.5 }, { verseStart: 3 },
    { startMs: -1 }, { startMs: NaN }, { startMs: Infinity },
    { endMs: 0 }, { endMs: 1001 }, { startMs: 1000 }
  ])('rejects invalid milestones: %j', patch => {
    expect(validTakeMetadata({ ...metadata, milestones: [{ ...metadata.milestones[0], ...patch }] }, 1000)).toBe(false);
  });
  it('rejects blank names and unsorted offsets', () => {
    expect(validTakeMetadata({ ...metadata, name: ' ' })).toBe(false);
    expect(validTakeMetadata({ ...metadata, milestones: [...metadata.milestones].reverse() })).toBe(false);
  });
});

describe('non-destructive audio edit history', () => {
  const initial: EditHistory = { past: [], future: [], present: {
    segments: [{ id: 'a', hash: 'original', startMs: 100, endMs: 1100 }], metadata
  } };
  it('invalidates verse times when audio changes, restores them on undo, and redoes the edit', () => {
    const edited = replaceSegments(initial.present, [{ id: 'b', hash: 'replacement', startMs: 0, endMs: 2000 }]);
    const history = changeEdit(initial, edited);
    expect(editDuration(history.present)).toBe(2000);
    expect(history.present.metadata.milestones).toEqual([]);
    const undone = undoEdit(history);
    expect(undone.present).toEqual(initial.present);
    expect(redoEdit(undone).present).toEqual(edited);
    expect(initial.present.segments[0]!.hash).toBe('original');
  });
  it('discards the redo branch after another edit and bounds undo memory', () => {
    let history = changeEdit(initial, { ...initial.present, metadata: { ...metadata, name: 'One' } });
    history = changeEdit(undoEdit(history), { ...initial.present, metadata: { ...metadata, name: 'Two' } });
    expect(history.future).toEqual([]);
    expect(redoEdit(history)).toBe(history);
    for (let i = 0; i < 70; i++) history = changeEdit(history, history.present);
    expect(history.past).toHaveLength(50);
  });
});
