/**
 * The passage on screen and the ones on each side of it, in the language's
 * order: what memory holds of a language kept on disk (decisions.md 110),
 * so the next or previous passage opens without waiting. A passage the
 * order does not list (a section of a book being broken up) is held alone.
 */
export function nearUnits(passages: readonly string[], unitId: string, around = 2): string[] {
  const i = passages.indexOf(unitId);
  if (i < 0) return [unitId];
  return passages.slice(Math.max(0, i - around), i + around + 1);
}
