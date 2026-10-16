// The Language sheet restarts the app only when a choice changes the
// language showing (ACCT-033): picking the one already showing saves the
// choice and closes the sheet, instead of waiting on a restart that never
// comes.
import { describe, expect, it } from 'vitest';
import { choiceChangesLanguage } from '../src/i18n/uiLanguageChoice';

describe('a choice on the Language sheet', () => {
  it('changes nothing when it names the language showing', () => {
    expect(choiceChangesLanguage('en', 'en', ['en-US'])).toBe(false);
    expect(choiceChangesLanguage('es', 'es', ['en-US'])).toBe(false);
  });

  it('changes nothing when following the phone lands on the language showing', () => {
    expect(choiceChangesLanguage(null, 'en', ['en-US'])).toBe(false);
    expect(choiceChangesLanguage(null, 'fr', ['fr-FR'])).toBe(false);
  });

  it('changes the language otherwise', () => {
    expect(choiceChangesLanguage('ar', 'en', ['en-US'])).toBe(true);
    expect(choiceChangesLanguage(null, 'es', ['en-US'])).toBe(true);
  });
});
