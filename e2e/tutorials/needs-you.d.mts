// Types for needs-you.mjs, which node runs as it is (gemini-voice.mjs imports it too).
export interface NeedsYou { title: string; text: string; link: string }
export const NEEDS_YOU_FILE: string;
export function needsYou(problem: NeedsYou): void;
export function geminiNeedsYou(status: number, body: string): NeedsYou | null;
export function annotations(lines: readonly string[]): string[];
