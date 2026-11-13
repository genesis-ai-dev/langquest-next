/**
 * The one more line a carrier whose own phone wears a cover sees on Let someone in (the new phone
 * will not wear one) and on Get the install file (the browser keeps where the file came from;
 * docs/nearby-sync-plan.md 14.4, "Checking before leaving town"). On an iPhone and the web no
 * phone wears one, so this draws nothing and these builds carry none of it (decisions.md 171,
 * disguiseIphone.test.ts). Android's file (LetInCoverNote.android.tsx) has the words, in
 * src/disguise/i18n. Nothing crosses the link about a cover.
 */
export function LetInCoverNote(_props: { worn: boolean; part: 'look' | 'file' }) {
  return null;
}
