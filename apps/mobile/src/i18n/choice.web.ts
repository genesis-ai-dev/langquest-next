// The language someone picked in this browser (localStorage, read before the
// first screen draws). It stays in the browser.
const KEY = 'ui-language:v1';

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function readChoice(): string | null {
  try { return storage()?.getItem(KEY) ?? null; } catch { return null; }
}

export function writeChoice(code: string | null) {
  try {
    if (code) storage()?.setItem(KEY, code);
    else storage()?.removeItem(KEY);
  } catch { /* private browsing: the choice lasts this visit */ }
}

/** A browser changes direction without restarting. */
export function lastDirectionReload(): number { return 0; }
export function noteDirectionReload(_at: number) { /* nothing to guard */ }
