import { useEffect, useState } from 'react';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { pickTutorialLinks, tutorialLinkUrls, type AppBuildInfo, type LinkVideo } from '@langquest-next/core';
import { currentLanguage } from '../i18n';
import { tutorialVideos } from '../server/tutorialLinks';
import { APP_URL } from '../web/appUrl';

/** What the phone knows of its build: a store build and the update it runs. A browser names none. */
function thisBuild(): AppBuildInfo {
  if (Platform.OS === 'web') return {};
  return { ...(Updates.runtimeVersion ? { runtime: Updates.runtimeVersion } : {}), ...(Updates.createdAt ? { updatedAt: Updates.createdAt.getTime() } : {}) };
}

/** The videos asked for once for each language, while the app runs. */
const asked = new Map<string, Promise<LinkVideo[] | null>>();

/** One video for the screen: its title and its download and watch links. */
export interface ScreenVideo { tutorial: string; title: string; download: string; watch: string | null }

/**
 * The videos for `screen` in the app's language and this build, best first,
 * with their download and watch links; none while they load, when none fits,
 * or offline: then nothing shows (docs/decisions/2026-11-17-help-page-tutorial-video-links.md).
 */
export function useTutorialLinks(screen: string): ScreenVideo[] {
  const language = currentLanguage();
  const [videos, setVideos] = useState<LinkVideo[] | null>(null);
  useEffect(() => {
    let live = true;
    let p = asked.get(language);
    if (!p) { p = tutorialVideos(APP_URL, language); asked.set(language, p); }
    void p.then((v) => { if (!v) asked.delete(language); if (live) setVideos(v); });
    return () => { live = false; };
  }, [language]);
  if (!videos || !APP_URL) return [];
  const origin = APP_URL;
  return pickTutorialLinks(screen, videos, thisBuild()).map((l) => ({ tutorial: l.tutorial, title: l.title, ...tutorialLinkUrls(origin, language, l) }));
}
