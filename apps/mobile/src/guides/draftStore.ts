// Guide drafts kept on this device until they are published, so nothing is
// lost to a closed tab or a dead battery. One draft per guide per device:
// the guide editor says one person edits a guide at a time, because two
// drafts of one guide never merge; the later publish is the next version.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GuideDraft } from './draft';

const PREFIX = 'guide-draft:v1:';

/** Which draft: an item being edited, a guide being adapted, or a new one. */
export function draftKey(orgId: string, c: { itemId?: string; from?: string }): string {
  return `${PREFIX}${orgId}:${c.itemId ? `item:${c.itemId}` : c.from ? `copy:${c.from}` : 'new'}`;
}

export interface SavedDraft {
  draft: GuideDraft;
  savedAt: number;
}

/** A stored draft, or null when there is none or it is not one this version reads. */
export function parseSaved(raw: string | null): SavedDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SavedDraft;
    return v && typeof v.savedAt === 'number' && v.draft?.v === 1 && Array.isArray(v.draft.steps) ? v : null;
  } catch {
    return null;
  }
}

export async function loadDraft(key: string): Promise<SavedDraft | null> {
  return parseSaved(await AsyncStorage.getItem(key));
}

export async function saveDraft(key: string, draft: GuideDraft, now = Date.now()): Promise<number> {
  await AsyncStorage.setItem(key, JSON.stringify({ draft, savedAt: now } satisfies SavedDraft));
  return now;
}

export async function dropDraft(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
