/**
 * Which tutorial video the help page offers for a screen (LAN-244). Pure: the
 * app and the Worker hand it what they know, it says which video, if any.
 * When nothing fits, nothing shows (Caleb's choice, decision 252): no English
 * stand-in, no list, no warning.
 */

/** The video each screen shows a link to: the video that spends most of its time on that screen. */
export const SCREEN_TUTORIAL: Readonly<Record<string, string>> = {
  sign_in: 'create-an-account', create_account: 'create-an-account', scan_qr: 'join-your-team', welcome: 'join-your-team',
  intent_chooser: 'start-an-organization', create_org: 'start-an-organization', explore_home: 'look-around-without-an-account',
  my_work: 'find-your-way-around', map_home: 'follow-a-language', status_home: 'follow-a-language', book_map: 'divide-books-into-passages',
  passage_record: 'move-a-passage-along', version_detail: 'versions-and-history', ask_someone: 'ask-someone',
  study_guide: 'study-a-passage', study_step: 'study-a-passage', workspace: 'record-a-passage', review_capture: 'do-a-check',
  back_translation: 'back-translate-a-passage', key_term_detail: 'key-words', inbox_home: 'remove-from-the-record',
  settings_home: 'your-account', profile_edit: 'your-account', org_switcher: 'your-account', get_ready: 'get-a-language-ready',
  org_home: 'get-the-blue-check', language_home: 'group-languages-into-a-cluster', new_language: 'add-a-language',
  invite_member: 'invite-your-team', members_list: 'change-a-role', edit_member: 'change-a-role', roles_home: 'make-a-role', role_editor: 'make-a-role',
  flows_home: 'share-templates-and-flows', flow_editor: 'set-up-the-review-checks', templates_home: 'choose-a-content-template',
  reference_home: 'choose-reference-material', guide_editor: 'write-a-study-guide', reports_home: 'reports-on-the-web', reports_language: 'reports-on-the-web',
  global_viewer: 'read-any-organization'
};

/** One video the server has chosen for a language, as the Worker lists it. */
export interface LinkVideo {
  tutorial: string;
  sha256: string;
  /** The oldest app build it can be watched beside: the time (ms) of the update it was filmed from. Missing: any build. */
  filmedFrom?: number;
  /** The store builds (runtime versions) it was filmed for. Missing: any. */
  runtimes?: readonly string[];
  youtube: boolean;
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
}

/**
 * The video to link from `screen`, or null. The videos are those of the
 * app's own language: one in another language never stands in. A video made
 * for a newer update or another store build than the phone's is left out,
 * since its buttons might not be on the phone's screen.
 */
export function pickTutorialLink(screen: string, videos: readonly LinkVideo[], build: AppBuildInfo = {}): TutorialLink | null {
  const tutorial = SCREEN_TUTORIAL[screen];
  if (!tutorial) return null;
  const v = videos.find((x) => x.tutorial === tutorial);
  if (!v) return null;
  if (v.runtimes && v.runtimes.length > 0 && build.runtime !== undefined && !v.runtimes.includes(build.runtime)) return null;
  if (v.filmedFrom !== undefined && build.updatedAt !== undefined && build.updatedAt < v.filmedFrom) return null;
  return { tutorial: v.tutorial, sha256: v.sha256, youtube: v.youtube };
}

/** The links for the video: the file to download and play, and YouTube's, for a language. */
export const tutorialLinkUrls = (origin: string, language: string, link: TutorialLink) => ({
  download: `${origin}/v/${language}/${link.tutorial}.mp4`,
  watch: link.youtube ? `${origin}/v/${language}/${link.tutorial}` : null
});
