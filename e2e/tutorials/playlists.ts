// What YouTube shows of a tutorial video in each app language: its title,
// its description, and its playlist, which says who it is for
// (docs/tutorial-videos.md, decisions.md 180). The nightly filming
// (nightly.ts) writes these into the release's manifest, and the publish job
// puts them on YouTube as they are. The playlist names are machine
// translations, like the app's catalogs (decisions.md 81).

import { UI_LANGUAGES } from '@langquest-next/core';
import { APP_LINK, downloadLink, videosPath, WORDS, type ChannelLanguage } from '../../server/youtube';

/** The playlists, kept where the publish job lays out each channel's home page too (server/youtubePlaylists.ts). */
export { PLAYLISTS, type Who } from '../../server/youtubePlaylists';

/** The app, which opens on the web too: named in every description, as on each channel (server/youtube.ts). */
export { APP_LINK };

/**
 * A video in a language, as a link that lasts: the app's Worker sends it on
 * to that video's newest version on YouTube, or to the language's channel
 * until one is up (apps/web/worker/tutorialVideos.ts `handleWatch`). A
 * description never has to change when a version is replaced.
 */
export const watchLink = (language: string, tutorial: string) => `${APP_LINK}/v/${language}/${tutorial}`;

/**
 * How a film is framed and described (decisions.md 191): wide, beside its
 * title (compose.ts), the camera moving in on what each step lights
 * (camera.ts), with a description of one line and its links. A film the
 * release keeps from before (tall, wide with the phone small all through, or
 * zoomed with the first night's ring that crossed nearby words) is made again
 * whatever its look.
 */
export const FRAME = 'zoomed-ring';
/** How the trailer is framed: wide (decisions.md 191). trailer/render.ts draws it, not compose.ts, so the camera changes no trailer. */
export const TRAILER_FRAME = 'wide';

/** The heading over a video's links to itself in the other app languages. */
export const OTHER_LANGUAGES: Record<string, string> = {
  en: 'This video in other languages:',
  es: 'Este video en otros idiomas:',
  pt: 'Este vídeo em outros idiomas:',
  fr: "Cette vidéo dans d'autres langues :",
  ar: 'هذا الفيديو بلغات أخرى:',
  sw: 'Video hii kwa lugha nyingine:',
  ha: 'Wannan bidiyon a wasu harsuna:',
  am: 'ይህ ቪዲዮ በሌሎች ቋንቋዎች፦',
  hi: 'यह वीडियो दूसरी भाषाओं में:',
  bn: 'এই ভিডিওটি অন্যান্য ভাষায়:',
  ne: 'यो भिडियो अन्य भाषाहरूमा:',
  id: 'Video ini dalam bahasa lain:',
  th: 'วิดีโอนี้ในภาษาอื่น:',
  my: 'ဤဗီဒီယိုကို အခြားဘာသာစကားများဖြင့်-',
  'zh-Hans': '本视频的其他语言版本：'
};

const YOUTUBE_TITLE = 100;
const YOUTUBE_DESCRIPTION_BYTES = 5000;
const bytes = (text: string) => new TextEncoder().encode(text).length;
// YouTube refuses < and > in a title or description.
const plain = (text: string) => text.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();

/** A video, to link to itself in the other app languages it is made in (each by its own name, in the order the app lists them). */
export interface Elsewhere {
  language: string;
  tutorial: string;
  /** The languages it is not made in (the script's `notIn`). */
  notIn?: string[];
}

/**
 * A line's first sentence, as a video's description gives it (its voice's
 * first words: "Here's how to record a passage."). A line with no mark that
 * ends a sentence (Thai writes none) is given whole.
 */
export function firstSentence(line: string): string {
  const text = plain(line);
  return (/^.+?(?:[.!?\u0964\u0965\u1362\u104B](?=\s|$)|[\u3002\uFF01\uFF1F])/u.exec(text)?.[0] ?? text).trim();
}

/**
 * A video's title and description on YouTube (decisions.md 191): one line on
 * what it shows, then, each group apart, the link to download it from
 * LangQuest (decisions.md 187), every video and the app, and the same video
 * in each other language. Never what the voice says, line by line: the
 * video says it, and a description is read at a glance. A summary too long
 * for YouTube is cut.
 */
export function youtubeText(title: string, summary: string, elsewhere?: Elsewhere): { title: string; description: string } {
  const others = elsewhere ? UI_LANGUAGES.filter((l) => l.code !== elsewhere.language && !elsewhere.notIn?.includes(l.code)) : [];
  const words = elsewhere ? WORDS[elsewhere.language as ChannelLanguage] ?? WORDS.en : undefined;
  const links = [
    ...(elsewhere && words ? [`${words.download} ${downloadLink(elsewhere.language, elsewhere.tutorial)}`, `${words.allVideos} ${APP_LINK}${videosPath(elsewhere.language)}`] : []),
    `LangQuest: ${APP_LINK}`
  ].join('\n');
  const languages = elsewhere && others.length
    ? [OTHER_LANGUAGES[elsewhere.language] ?? OTHER_LANGUAGES['en'], ...others.map((l) => `${l.name}: ${watchLink(l.code, elsewhere.tutorial)}`)].join('\n')
    : '';
  const end = ['', links, ...(languages ? [languages] : [])].join('\n\n');
  let first = plain(summary);
  while (first && bytes(first + end) > YOUTUBE_DESCRIPTION_BYTES) first = [...first].slice(0, -1).join('');
  return { title: [...plain(title)].slice(0, YOUTUBE_TITLE).join(''), description: (first + end).trim() };
}
