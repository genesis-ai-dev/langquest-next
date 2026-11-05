import { addWords, type UiLanguage } from '../i18n';
import en from './i18n/en.json';

/**
 * The disguise's words (decisions.md 171), kept out of the app's catalogs
 * in src/i18n so that an iPhone build, which has no disguise, carries none
 * of them: only Android's files import this. They join the app's words for
 * the language showing, as the catalogs' own do (src/i18n/catalogs.ts), and
 * `native.calculator` and `native.notes` also name Android's icons
 * (plugins/withAndroidAppIcons.js).
 */
function wordsFor(code: UiLanguage): object | null {
  switch (code) {
    case 'en': return en;
    case 'es': return require('./i18n/es.json');
    case 'pt': return require('./i18n/pt.json');
    case 'fr': return require('./i18n/fr.json');
    case 'ar': return require('./i18n/ar.json');
    case 'sw': return require('./i18n/sw.json');
    case 'ha': return require('./i18n/ha.json');
    case 'am': return require('./i18n/am.json');
    case 'hi': return require('./i18n/hi.json');
    case 'bn': return require('./i18n/bn.json');
    case 'ne': return require('./i18n/ne.json');
    case 'id': return require('./i18n/id.json');
    case 'zh-Hans': return require('./i18n/zh-Hans.json');
    case 'th': return require('./i18n/th.json');
    case 'my': return require('./i18n/my.json');
    case 'tl': return require('./i18n/tl.json');
    default: return null;
  }
}

addWords(wordsFor);
