// i18n-ignore-file: a request to our own server, never shown.
import type { LinkVideo } from '@langquest-next/core';

/**
 * The tutorial videos chosen for a language, from the app's own server
 * (LAN-244, decisions.md 209). Null when there is no address to ask, or
 * nothing answered: the help page then shows no link.
 */
export async function tutorialVideos(origin: string | null, language: string): Promise<LinkVideo[] | null> {
  if (!origin) return null;
  try {
    const res = await fetch(`${origin}/api/tutorial-links?lang=${encodeURIComponent(language)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { videos?: LinkVideo[] };
    return Array.isArray(body.videos) ? body.videos : null;
  } catch {
    return null;
  }
}
