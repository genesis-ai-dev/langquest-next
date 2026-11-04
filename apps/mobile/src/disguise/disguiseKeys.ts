/**
 * Where a phone keeps its disguise (decisions.md 171): which look and the
 * notepad's text in the app's key-value store, the code's salted hash in the
 * Keychain or Keystore. disguise.ts writes them; DisguiseGate.ios.tsx clears
 * them on an iPhone, which wears none.
 */
export const LOOK_KEY = 'disguise-look';
export const NOTES_KEY = 'disguise-notes';
export const CODE_KEY = 'disguise-code';
