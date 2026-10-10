// `t('area.key')` only accepts keys that exist in the English catalog, so a
// typo or a removed key fails `npm run typecheck`.
import 'i18next';
import type en from './en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
    returnNull: false;
  }
}
