import type { Look } from './disguiseModel';

/**
 * An iPhone wears no disguise (decisions.md 171, amended 2026-11-03): Apple
 * refused build 48 for its icons (App Review Guideline 2.5.19), so an iPhone
 * build has none of it. disguise.ts is Android's; DisguiseGate.ios.tsx clears
 * what an older iPhone build kept.
 */
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
