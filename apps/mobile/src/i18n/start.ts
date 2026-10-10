// Picks the app's language on a phone or in a browser, before the first
// screen draws (apps/mobile/index.ts imports this before App): the person's
// choice on this device, else the phone's language when its catalog has been
// reviewed, else English (languages.ts). Arabic turns the layout right to
// left; on a phone that takes a restart, so the app restarts once when the
// direction it opened in is not the language's.
import { getLocales } from 'expo-localization';
import * as Updates from 'expo-updates';
import { DevSettings, I18nManager, Platform } from 'react-native';
import { loadCatalog, loadCatalogAsync } from './catalogs';
import { lastDirectionReload, noteDirectionReload, readChoice, writeChoice } from './choice';
import { addCatalog, currentLanguage, showLanguage } from './index';
import { catalogFor, isUiLanguage, languageInfo, pickLanguage, type UiLanguage } from './languages';

function deviceTags(): string[] {
  try { return getLocales().map((l) => l.languageTag); } catch { return []; }
}

let ready = true;
const waiting: (() => void)[] = [];

function show(code: UiLanguage) {
  if (code === 'en') { showLanguage(code); return; }
  const catalog = loadCatalog(code);
  if (catalog) { addCatalog(code, catalog); showLanguage(code); return; }
  // A browser fetches the catalog; the first screen waits for it (languageReady).
  ready = false;
  const done = () => { ready = true; waiting.splice(0).forEach((f) => f()); };
  loadCatalogAsync(code).then((c) => { addCatalog(code, c); showLanguage(code); }, () => { /* stays in English */ }).finally(done);
}

/** Whether the language's words are here; on a phone always, in a browser once its catalog arrives. */
export function languageReady(): boolean {
  return ready;
}

export function onLanguageReady(then: () => void) {
  if (ready) then();
  else waiting.push(then);
}

function restart() {
  if (Platform.OS === 'web') { globalThis.location?.reload(); return; }
  if (__DEV__) { DevSettings.reload(); return; }
  void Updates.reloadAsync().catch(() => DevSettings.reload());
}

/** Lay the app out in the language's direction; on a phone, say whether a restart is needed for it. */
function applyDirection(code: UiLanguage): boolean {
  const info = languageInfo(code);
  const rtl = info.dir === 'rtl';
  if (Platform.OS === 'web') {
    const root = (globalThis as { document?: { documentElement: { lang: string; dir: string } } }).document?.documentElement;
    if (root) { root.lang = info.locale; root.dir = info.dir; }
    return false;
  }
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  I18nManager.swapLeftAndRightInRTL(true);
  return I18nManager.isRTL !== rtl;
}

export function startLanguage() {
  const code = pickLanguage(readChoice(), deviceTags());
  show(code);
  if (applyDirection(code)) {
    const now = Date.now();
    // Restart at most once a minute: if the direction does not take, the app still opens.
    if (now - lastDirectionReload() > 60_000) { noteDirectionReload(now); restart(); }
  }
}

/** The phone's own language, if the app has a catalog for it (reviewed or not). */
export function phoneLanguage(): UiLanguage | null {
  for (const tag of deviceTags()) {
    const code = catalogFor(tag);
    if (code) return code;
  }
  return null;
}

/** What the person picked on this device, or null when the app follows the phone. */
export function chosenLanguage(): UiLanguage | null {
  const c = readChoice();
  return isUiLanguage(c) ? c : null;
}

/**
 * Show the app in this language (null: follow the phone). The app restarts,
 * so every screen, list and the layout direction start over in it; nothing
 * unsent is lost, it is all in the event log.
 */
export function chooseLanguage(code: UiLanguage | null) {
  writeChoice(code);
  const next = pickLanguage(code, deviceTags());
  if (next === currentLanguage()) return;
  applyDirection(next);
  restart();
}
