import { addWords, type UiLanguage } from '../i18n';
import en from './i18n/en.json';

/**
 * Nearby sync's words (src/nearby/i18n), kept out of the app's catalogs so the web, which never
 * runs nearby sync, does not carry them on every visit (the web budget, decision 228). A phone
 * loads them all at start (src/i18n/catalogs.ts imports this), and they join the app's words for
 * the language showing, as the disguise's do (src/disguise/disguiseWords.ts). The web's are in
 * nearbyWords.web.ts.
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
