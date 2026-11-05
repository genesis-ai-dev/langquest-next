import type { AnyEvent } from '../src/events';
import { foldLanguage, keptRecording, keptVerdict } from '../src/reducer';
import { emptyLanguageState } from '../src/state';

/**
 * Why: a phone that keeps recordings and file verdicts on disk (decisions.md
 * 104) folds a new event without the stored copy in memory, then combines
 * the two. That must give what folding both events together gives, in any
 * order, or a phone's language would drift from the server's.
 */
const ev = (id: string, type: string, payload: unknown, hlc: string, actorId = 't1'): AnyEvent =>
  ({ id, type, orgId: 'o', streamId: 'L', actorId, deviceId: 'd', hlc, payload }) as AnyEvent;
const fold = (events: AnyEvent[]) => foldLanguage(events, emptyLanguageState());

describe('combining a kept copy with a newly folded one', () => {
  const recordings = [
    ev('a', 'v1.RecordingAdded', { recordingId: 'r', unitId: 'u1', kind: 'target', cards: [{ hash: 'h1', durationMs: 1 }] }, '0002'),
    ev('b', 'v1.RecordingAdded', { recordingId: 'r', unitId: 'u1', kind: 'target', cards: [{ hash: 'h2', durationMs: 1 }] }, '0001'),
    ev('c', 'v1.RecordingAdded', { recordingId: 'r', unitId: 'u2', kind: 'target', cards: [{ hash: 'h3', durationMs: 1 }] }, '0001', 't0'),
    ev('d', 'v1.RecordingAdded', { recordingId: 'r', unitId: 'u1', kind: 'source', cards: [] }, '0001')
  ];

  it('keeps the recording the fold keeps, for every pair in either order', () => {
    for (const x of recordings) for (const y of recordings) {
      if (x === y) continue;
      const together = fold([x, y]).recordings['r'];
      const one = fold([x]).recordings['r']!;
      const other = fold([y]).recordings['r']!;
      expect(keptRecording(one, other)).toEqual(together);
      expect(keptRecording(other, one)).toEqual(together);
    }
  });

  it('keeps the file verdict the fold keeps, for every pair in either order', () => {
    const verdicts = [
      ev('s1', 'v1.BlobStored', { hash: 'h', size: 10 }, '0005'),
      ev('s2', 'v1.BlobStored', { hash: 'h', size: 11 }, '0005'),
      ev('i1', 'v1.BlobInvalidated', { hash: 'h', reason: 'hash mismatch' }, '0006'),
      ev('s0', 'v1.BlobStored', { hash: 'h', size: 9 }, '0001')
    ];
    for (const x of verdicts) for (const y of verdicts) {
      if (x === y) continue;
      const together = fold([x, y]).blobs['h'];
      const one = fold([x]).blobs['h']!;
      const other = fold([y]).blobs['h']!;
      expect(keptVerdict(one, other)).toEqual(together);
      expect(keptVerdict(other, one)).toEqual(together);
    }
  });
});
