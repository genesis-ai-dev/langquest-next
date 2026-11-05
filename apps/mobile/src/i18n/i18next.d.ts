// `t('area.key')` only accepts keys that exist in the English catalog, so a
// typo or a removed key fails `npm run typecheck`. The disguise's words are
// kept beside it (src/disguise/i18n, added by addWords on Android).
import 'i18next';
import type disguise from '../disguise/i18n/en.json';
import type en from './en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en & typeof disguise };
    returnNull: false;
  }
}
