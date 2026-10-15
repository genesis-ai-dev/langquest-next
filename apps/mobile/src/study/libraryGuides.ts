// The study guide for a passage, from the library (docs/library.md,
// docs/reference-material.md): what the organization or the language
// recommends, or an admin linked to the passage, first; then the rest of the
// organization's own, copied or followed material. What other organizations
// merely share is never offered: an admin follows or copies it first
// (`reference/offered.ts`). Matching is `guideMatch.ts`; this hook only
// gathers the documents.
export { useStudyGuide, useStudyGuides } from './useStudyGuides';

export { glossaryEntryOf } from './guideMatch';

