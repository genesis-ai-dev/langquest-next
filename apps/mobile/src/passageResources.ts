import { materialsFor, recordAudioHashes, unitAncestry, type BlobRef, type PartitionState } from '@langquest-next/core';

export type AudioItem = { id: string; label: string; hash: string; format: BlobRef['format'] };

function formatFor(state: PartitionState, hash: string): BlobRef['format'] {
  for (const recording of Object.values(state.recordings)) {
    const card = recording.cards.find((c) => c.hash === hash);
    if (card) return card.format ?? 'wav';
  }
  return 'm4a';
}

export function getReferenceSlides(state: PartitionState, laneId: string, unitId: string): AudioItem[] {
  const items: AudioItem[] = [];
  for (const material of materialsFor(state, { laneId, unitId }).filter((m) => !m.scope.laneId || m.scope.laneId === laneId)) {
    if (material.kind === 'questions') continue;
    for (const field of material.fields) {
      if (field.blobHash) items.push({ id: `${material.materialId}:${field.fieldId}`, label: material.title, hash: field.blobHash, format: formatFor(state, field.blobHash) });
    }
  }
  const ancestors = unitAncestry(state, unitId);
  // Voice notes, spoken feedback and back translations are source-language
  // cards too, but they belong to the record, not to the reference material.
  const recordAudio = recordAudioHashes(state);
  for (const [id, recording] of Object.entries(state.recordings)) {
    if (recording.kind !== 'source' || recording.laneId !== laneId ||
        !ancestors.has(recording.unitId)) continue;
    recording.cards.forEach((card, index) => recordAudio.has(card.hash) ? undefined : items.push({
      id: `source:${id}:${index}`, label: 'Source audio', hash: card.hash,
      format: card.format ?? 'wav'
    }));
  }
  for (const [id, ref] of Object.entries(state.references)) {
    if (ancestors.has(ref.unitId) && ref.blobHash && ref.kind !== 'review_questions' && ref.kind !== 'questions') items.push({ id, label: ref.kind.replaceAll('_', ' '), hash: ref.blobHash, format: formatFor(state, ref.blobHash) });
  }
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

export function referenceRunSignature(items: AudioItem[]): string {
  return JSON.stringify(items.slice().sort((a, b) => a.id.localeCompare(b.id)).map((item) => [item.id, item.hash]));
}
