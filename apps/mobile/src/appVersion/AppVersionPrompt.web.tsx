import type { Offer } from './appVersionModel';

/**
 * A browser always loads the newest version of the app, so it is never told
 * to update (decisions.md 154), and the web export leaves the prompt and its
 * buttons out of the first visit.
 */
export function AppVersionPrompt(_props: { offer: Offer; onUpdate: () => void; onDismiss: () => void }) {
  return null;
}
