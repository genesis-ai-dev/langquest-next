// New language's six stages (decisions.md 145), in the order it asks them:
// the overview shows them all before the first question, and every page
// after it lights the one it belongs to.
import { t } from '../i18n';

export type Stage = 'language' | 'content' | 'pieces' | 'material' | 'flow' | 'people';

export const STAGES: readonly Stage[] = ['language', 'content', 'pieces', 'material', 'flow', 'people'];

/** Each stage's picture, as the kit's icons name them. */
export function stageIcon(s: Stage): 'globe' | 'book' | 'cut' | 'star' | 'flow' | 'people' {
  switch (s) {
    case 'language': return 'globe';
    case 'content': return 'book';
    case 'pieces': return 'cut';
    case 'material': return 'star';
    case 'flow': return 'flow';
    case 'people': return 'people';
  }
}

/** Its name: the same name a ready language's page gives the thing it sets (decision 138). */
export function stageLabel(s: Stage): string {
  switch (s) {
    case 'language': return t('org.newLanguage.stages.language');
    case 'content': return t('org.newLanguage.stages.content');
    case 'pieces': return t('org.newLanguage.stages.pieces');
    case 'material': return t('org.newLanguage.stages.material');
    case 'flow': return t('org.newLanguage.stages.flow');
    case 'people': return t('org.newLanguage.stages.people');
  }
}

/** What it is about, for help mode: the words the pictures leave out. */
export function stageHelp(s: Stage): string {
  switch (s) {
    case 'language': return t('org.newLanguage.stages.languageHelp');
    case 'content': return t('org.newLanguage.stages.contentHelp');
    case 'pieces': return t('org.newLanguage.stages.piecesHelp');
    case 'material': return t('org.newLanguage.stages.materialHelp');
    case 'flow': return t('org.newLanguage.stages.flowHelp');
    case 'people': return t('org.newLanguage.stages.peopleHelp');
  }
}

/**
 * The stage a page of New language is in. Its second question asks what
 * they translate and, for the Bible, its numbering (content), then how it
 * is broken up (pieces); something other than the Bible is broken up by
 * the outline chosen with it, so it has no page of pieces.
 */
export function stageOf(step: number, translatePage: string): Stage {
  if (step <= 1) return 'language';
  if (step === 2) return translatePage === 'ways' ? 'pieces' : 'content';
  if (step === 3) return 'material';
  if (step === 4) return 'flow';
  return 'people';
}
