import { deriveDownloadWork, isStored, offlineByUnit, offlineSummary, referencedBlobs } from '../src/blobs';
import type { AnyEvent } from '../src/events';
import { unitAncestry } from '../src/materials';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState, type LanguageState } from '../src/state';
import { buildFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

/**
 * Offline planning was quadratic: for every passage it walked every audio
 * file, material and key term in the language (performance-audit.md item 6).
 * This holds the indexed version to the old one, copied here as it was,
 * on states with audio at every level a passage can inherit from.
 */
function referenceHashes(state: LanguageState, scope: ReadonlySet<string>): Set<string> {
  const needed = new Set<string>();
  for (const ref of referencedBlobs(state).values()) if (scope.has(ref.unitId)) needed.add(ref.hash);
  for (const unitId of scope) {
    const ancestors = unitAncestry(state, unitId);
    for (const material of Object.values(state.materials)) {
      if (material.scope.unitId && !ancestors.has(material.scope.unitId)) continue;
      if (material.scope.stepId) continue;
      for (const field of Object.values(material.fields)) if (field.value.blobHash) needed.add(field.value.blobHash);
    }
    for (const term of Object.values(state.keyTerms)) {
      if (term.unitScope.length && !term.unitScope.some((id) => ancestors.has(id))) continue;
      for (const adjustment of Object.values(term.adjustments)) if (adjustment.blobHash) needed.add(adjustment.blobHash);
    }
  }
  return needed;
}

function referenceCounts(state: LanguageState, unitId: string, present: ReadonlySet<string>) {
  let here = 0, toFetch = 0, bytesToFetch = 0, notSent = 0;
  const hashes = referenceHashes(state, new Set([unitId]));
  for (const hash of hashes) {
    if (present.has(hash)) here++;
    else if (isStored(state, hash)) { toFetch++; bytesToFetch += state.blobs[hash]?.size ?? 0; }
    else notSent++;
  }
  return { audio: hashes.size, here, toFetch, bytesToFetch, notSent };
}

/** The fixtures' language, plus audio at every level a passage inherits from, and the cases the old code treated specially. */
function withInheritedAudio(): LanguageState {
  const events: AnyEvent[] = [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture()];
  const state = foldLanguage(events, emptyLanguageState());
  const reg = (blobHash: string) => ({ value: { blobHash }, hlc: '1', eventId: blobHash });
  const material = (scope: { unitId?: string; stepId?: string }, ...hashes: string[]) => ({
    kind: 'brief', title: 't', scope, createdBy: 'a', hlc: '1', locked: { value: false, hlc: '', eventId: '' },
    fields: Object.fromEntries(hashes.map((h, i) => [`f${i}`, reg(h)]))
  });
  Object.assign(state.materials, {
    global: material({}, 'global-a', 'global-b'),
    emptyUnit: material({ unitId: '' }, 'empty-unit'),
    book: material({ unitId: 'luke' }, 'book', 'c1'),
    passage: material({ unitId: 'luke1' }, 'passage-only'),
    other: material({ unitId: 'john' }, 'other-unit'),
    step: material({ stepId: 'community' }, 'step-only')
  });
  const term = (unitScope: string[], hash: string) => ({
    term: 'x', gloss: '', unitScope, hlc: '1', renderings: {}, adjustments: { a: { note: '', blobHash: hash, actorId: 'a', hlc: '1' } }
  });
  Object.assign(state.keyTerms, {
    everywhere: term([], 'term-everywhere'),
    luke: term(['luke'], 'term-luke'),
    blankScope: term([''], 'term-blank'),
    johnOrLuke1: term(['john', 'luke1'], 'term-luke1')
  });
  for (const h of ['global-a', 'book', 'passage-only', 'term-luke', 'c1']) state.blobs[h] = { size: 10, hlc: '1', eventId: h, stored: true };
  return state;
}

describe('offline planning, indexed', () => {
  const state = withInheritedAudio();
  const units = Object.keys(state.units);
  const presentSets = [new Set<string>(), new Set(['c1', 'global-a', 'term-luke']), new Set(Object.keys(state.blobs))];

  it('counts every passage the way the per-passage scan did', () => {
    for (const present of presentSets) {
      const got = offlineByUnit(state, units, present, 't1', new Set());
      for (const unitId of units) {
        const { reason: _reason, ready: _ready, ...counts } = got.get(unitId)!;
        expect(counts, unitId).toEqual(referenceCounts(state, unitId, present));
      }
    }
  });

  it('downloads the same files for any scope', () => {
    for (const scope of [new Set(['luke1']), new Set(['luke']), new Set(units), new Set(['nowhere'])]) {
      const got = new Set(deriveDownloadWork(state, new Set(), scope).map((r) => r.hash));
      const want = new Set([...referencedBlobs(state).values()].filter((r) => isStored(state, r.hash) && referenceHashes(state, scope).has(r.hash)).map((r) => r.hash));
      expect(got).toEqual(want);
    }
  });

  it('sums the offline scope the same way', () => {
    const chosen = new Set(['luke1']);
    const summary = offlineSummary(state, presentSets[1]!, 't1', chosen);
    expect(summary.kept).toBeGreaterThan(0);
    let filesToFetch = 0, bytesToFetch = 0, notSent = 0;
    const kept = new Set([...chosen, ...[...offlineByUnit(state, units, presentSets[1]!, 't1', chosen)].filter(([, u]) => u.reason !== null).map(([id]) => id)]);
    for (const hash of referenceHashes(state, kept)) {
      if (presentSets[1]!.has(hash)) continue;
      if (isStored(state, hash)) { filesToFetch++; bytesToFetch += state.blobs[hash]?.size ?? 0; } else notSent++;
    }
    expect({ kept: summary.kept, filesToFetch: summary.filesToFetch, bytesToFetch: summary.bytesToFetch, notSent: summary.notSent })
      .toEqual({ kept: kept.size, filesToFetch, bytesToFetch, notSent });
  });
});
