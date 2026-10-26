import type { Look } from './disguiseModel';

/** A browser has no app icon to change and nothing to disguise (decisions.md 169): disguise.ts is the phones'. */
export const ICONS_HERE = false;

const STATE = { look: null as Look | null, locked: false };

export function disguiseState(): { look: Look | null; locked: boolean } {
  return STATE;
}

export function onDisguiseChange(_listener: () => void): () => void {
  return () => undefined;
}

export function lockNow(): void {}

export async function codeLength(): Promise<number | null> {
  return null;
}

export async function tryCode(_candidate: string): Promise<boolean> {
  return false;
}

export async function wearDisguise(_look: Look, _code: string): Promise<void> {}

export async function dropDisguise(): Promise<void> {}

export function savedNotes(): string {
  return '';
}

export function keepNotes(_text: string): void {}
