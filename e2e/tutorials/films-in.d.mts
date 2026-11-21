// Types for films-in.mjs, which node runs as it is in tutorials.yml.
export const FILMED_API: string;
export function sayFilmsIn(
  env: Record<string, string | undefined>,
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>
): Promise<{ ok: boolean; said: string }>;
export function askLanguages(
  env: Record<string, string | undefined>,
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>
): Promise<{ languages: string[] | null; said: string }>;
