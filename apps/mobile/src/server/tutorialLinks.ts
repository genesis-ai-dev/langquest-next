// i18n-ignore-file: a request to our own server, never shown.
import type { LinkVideo } from '@langquest-next/core';

/**
 * The tutorial videos chosen for a language, from the app's own server
 * (LAN-244, docs/decisions/2026-11-17-help-page-tutorial-video-links.md). Null when there is no address to ask, or
 * nothing answered: the help page then shows no link.
 */
export async function tutorialVideos(origin: string | null, language: string): Promise<LinkVideo[] | null> {
  if (!origin) return null;
  try {
    const res = await fetch(`${origin}/api/tutorial-links?lang=${encodeURIComponent(language)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { videos?: LinkVideo[] };
    return Array.isArray(body.videos) ? body.videos.filter((v) => typeof v?.title === 'string') : null;
  } catch {
    return null;
  }
}
