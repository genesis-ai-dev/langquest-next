// Guide drafts kept on this device until they are published, so nothing is
// lost to a closed tab or a dead battery (decision 111). A draft is its
// writer's: the key names them, so on a shared phone or browser nobody else
// opens it, and deleting the account removes it. Two drafts of one guide
// never merge: the later publish is the next version, and the editor warns
// when a newer version was published after a draft began.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GuideDraft } from './draft';

const PREFIX = 'guide-draft:v1:';

/** Which guide: an item being edited, a guide being adapted, or a new one. */
interface Which { itemId?: string; from?: string }

const which = (c: Which) => (c.itemId ? `item:${c.itemId}` : c.from ? `copy:${c.from}` : 'new');

/** Which draft: whose, in which organization, of which guide. */
export function draftKey(orgId: string, actorId: string, c: Which): string {
  return `${PREFIX}${orgId}:${actorId}:${which(c)}`;
}

/** Where a draft was kept before drafts named their writer. */
export function unownedDraftKey(orgId: string, c: Which): string {
  return `${PREFIX}${orgId}:${which(c)}`;
}

interface SavedDraft {
  draft: GuideDraft;
  savedAt: number;
}

/** A stored draft, or null when there is none or it is not one this version reads. */
function parseSaved(raw: string | null): SavedDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SavedDraft;
    return v && typeof v.savedAt === 'number' && v.draft?.v === 1 && Array.isArray(v.draft.steps) ? v : null;
  } catch {
    return null;
  }
}

/** The draft kept under `key`; else one kept under `unowned` (from before drafts named their writer), which becomes this writer's. */
export async function loadDraft(key: string, unowned?: string): Promise<SavedDraft | null> {
  const own = parseSaved(await AsyncStorage.getItem(key));
  if (own || !unowned) return own;
  const raw = await AsyncStorage.getItem(unowned);
  const old = parseSaved(raw);
  if (old && raw) {
    await AsyncStorage.setItem(key, raw);
    await AsyncStorage.removeItem(unowned);
  }
  return old;
}

export async function saveDraft(key: string, draft: GuideDraft, now = Date.now()): Promise<number> {
  await AsyncStorage.setItem(key, JSON.stringify({ draft, savedAt: now } satisfies SavedDraft));
  return now;
}

export async function dropDraft(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
