// The UI language list lives in packages/core (uiLanguages.ts) so the Worker
// can use it too; this file keeps the app's imports short.
export {
  UI_LANGUAGES, SOURCE_LANGUAGE, uiLanguageInfo as languageInfo, isUiLanguage, catalogFor, pickLanguage
} from '@langquest-next/core';
export type { UiLanguage, UiLanguageInfo } from '@langquest-next/core';
