/**
 * Which tutorial videos the help page offers for a screen (LAN-244). Pure: the
 * app and the Worker hand it what they know, it says which videos, if any.
 * When nothing fits, nothing shows (Caleb's choice, docs/decisions/2026-11-17-help-page-tutorial-video-links.md): no English
 * stand-in, no warning.
 */
import { SCREEN_TUTORIALS } from './tutorialScreens';

/** One video the server has chosen for a language, as the Worker lists it. */
export interface LinkVideo {
  tutorial: string;
  sha256: string;
  /** The oldest app build it can be watched beside: the time (ms) of the update it was filmed from. Missing: any build. */
  filmedFrom?: number;
  /** The store builds (runtime versions) it was filmed for. Missing: any. */
  runtimes?: readonly string[];
  youtube: boolean;
  /** Its title in the language. */
  title: string;
}

/** What the app knows about itself. A browser always runs the newest page, so it has neither. */
export interface AppBuildInfo {
  runtime?: string;
  /** When the running update was made (ms). */
  updatedAt?: number;
}

export interface TutorialLink {
  tutorial: string;
  sha256: string;
  youtube: boolean;
  /** Its title in the language, as the videos page shows it. */
  title: string;
}

/**
 * The videos to link from `screen`, best first (SCREEN_TUTORIALS), or none.
 * The videos are those of the app's own language: one in another language
 * never stands in. A video made for a newer update or another store build
 * than the phone's is left out, since its buttons might not be on the
 * phone's screen.
 */
export function pickTutorialLinks(screen: string, videos: readonly LinkVideo[], build: AppBuildInfo = {}): TutorialLink[] {
  return (SCREEN_TUTORIALS[screen] ?? []).flatMap((tutorial) => {
    const v = videos.find((x) => x.tutorial === tutorial);
    if (!v) return [];
    if (v.runtimes && v.runtimes.length > 0 && build.runtime !== undefined && !v.runtimes.includes(build.runtime)) return [];
    if (v.filmedFrom !== undefined && build.updatedAt !== undefined && build.updatedAt < v.filmedFrom) return [];
    return [{ tutorial: v.tutorial, sha256: v.sha256, youtube: v.youtube, title: v.title }];
  });
}
/** The links for the video: the file to download and play, and YouTube's, for a language. */
export const tutorialLinkUrls = (origin: string, language: string, link: TutorialLink) => ({
  download: `${origin}/v/${language}/${link.tutorial}.mp4`,
  watch: link.youtube ? `${origin}/v/${language}/${link.tutorial}` : null
});
