// In a browser the other languages' catalogs are files beside the page
// (/i18n/<code>.json: copied there by scripts/export-web.mjs, served by
// Metro in development), fetched when someone picks one, so the JavaScript
// every visit downloads carries English only (the web budget, decisions.md 58).
import { BUILD_ID } from '../webBuild';
import type { UiLanguage } from './languages';

export function loadCatalog(_code: Exclude<UiLanguage, 'en'>): object | null {
  return null;
}

export async function loadCatalogAsync(code: Exclude<UiLanguage, 'en'>): Promise<object> {
  const res = await fetch(`/i18n/${code}.json${BUILD_ID ? `?v=${encodeURIComponent(BUILD_ID)}` : ''}`);
  if (!res.ok) throw new Error(`catalog ${code}: ${res.status}`);
  return (await res.json()) as object;
}
