// A word's sheet and a check's key words load the first time one opens, not
// with the recorder or the review (src/shell/lazyScreens.tsx keeps the web
// app's first visit inside its budget, decision 123). Until the module is
// here nothing shows; a phone has it in its one bundle already.
import { Suspense, type ComponentProps } from 'react';
import { readModule, registerLoader } from '../shell/lazyModules';
import type * as Sheets from './KeyWordSheets';

const loadSheets = () => import('./KeyWordSheets');
registerLoader(loadSheets);

function LoadedWord(props: ComponentProps<typeof Sheets.KeyWordSheet>) {
  const Sheet = readModule(loadSheets).KeyWordSheet;
  return <Sheet {...props} />;
}

function LoadedReview(props: ComponentProps<typeof Sheets.ReviewKeyWordsSheet>) {
  const Sheet = readModule(loadSheets).ReviewKeyWordsSheet;
  return <Sheet {...props} />;
}

export function KeyWordSheet(props: ComponentProps<typeof Sheets.KeyWordSheet>) {
  return <Suspense fallback={null}><LoadedWord {...props} /></Suspense>;
}

export function ReviewKeyWordsSheet(props: ComponentProps<typeof Sheets.ReviewKeyWordsSheet>) {
  return <Suspense fallback={null}><LoadedReview {...props} /></Suspense>;
}
