/**
 * Where a phone keeps its disguise (decisions.md 171): which look and the
 * notepad's text in the app's key-value store, the code's salted hash in the
 * Keychain or Keystore. disguise.ts writes and reads them. An iPhone build
 * has none of this (decisions.md 171, amended 2026-11-05): what iPhone build
 * 45 kept under these keys stays unread, and a later iPhone build that has the
 * disguise again must not take it up as its own.
 */
export const LOOK_KEY = 'disguise-look';
export const NOTES_KEY = 'disguise-notes';
export const CODE_KEY = 'disguise-code';
