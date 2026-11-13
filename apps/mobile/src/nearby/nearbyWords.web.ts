import { addWords, type UiLanguage } from '../i18n';
import en from './i18n/en.json';

/**
 * Nearby sync's words on the web (nearbyWords.ts): English comes with the screens that show them
 * (screens/nearby.tsx imports this), not on every visit, and another language's come inside its
 * catalog file, which the export and Metro serve with these merged in (scripts/export-web.mjs,
 * metro.config.js).
 */
addWords((code: UiLanguage) => (code === 'en' ? en : null));
