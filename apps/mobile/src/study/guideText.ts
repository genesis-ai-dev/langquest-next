// Words for a study guide (study/guide.tsx).
import type { StudyGuide } from './guides';

/** The guide's language, from its source line ("… · English"), without naming where it came from. */
export function guideLanguage(g: Pick<StudyGuide, 'source'>): string {
  const parts = g.source.split('·').map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1]! : '';
}
