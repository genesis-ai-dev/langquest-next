// Whether a choice on the Language sheet (uiLanguage.tsx) changes the
// language showing. Only then does the app restart (i18n/start.ts
// `chooseLanguage`); picking the language already showing just saves the
// choice, so the sheet closes instead of saying it is changing.
import { pickLanguage, type UiLanguage } from './languages';

export function choiceChangesLanguage(code: UiLanguage | null, showing: UiLanguage, deviceTags: readonly string[]): boolean {
  return pickLanguage(code, deviceTags) !== showing;
}
