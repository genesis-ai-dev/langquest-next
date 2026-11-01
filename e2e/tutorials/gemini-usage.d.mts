// Types for gemini-usage.mjs, which node runs as it is (tutorials.yml).
export interface Usage { model: string; plan?: boolean; requests?: number; in?: number; out?: number; thinking?: number; usd?: number }
export function geminiDollars(model: string, m: { in: number; out: number; thinking: number }, now?: Date): number | null;
export function summary(jobs: readonly Usage[], now?: Date): string[];
