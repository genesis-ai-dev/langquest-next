// Door43's notes, key words and articles, and a ready-made flow's language
// link, loaded the first time one is drawn (shell/lazyScreens.tsx lazyPart):
// out of the web app's first visit, whose budget is nearly spent
// (apps/mobile/scripts/export-web.mjs).
import { lazyPart } from '../shell/lazyScreens';

const loadLibraryHelps = () => import('./libraryHelps');
const loadFlowLanguage = () => import('../checks/FlowLanguage');

export const LibraryNotes = lazyPart(loadLibraryHelps, 'LibraryNotes');
export const LibraryKeyWords = lazyPart(loadLibraryHelps, 'LibraryKeyWords');
export const ArticleSheet = lazyPart(loadLibraryHelps, 'ArticleSheet');
export const PassageHelpsSheet = lazyPart(loadLibraryHelps, 'PassageHelpsSheet');
export const FlowLanguageLink = lazyPart(loadFlowLanguage, 'FlowLanguageLink');
