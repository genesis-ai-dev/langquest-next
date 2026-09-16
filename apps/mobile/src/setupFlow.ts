import type { ContentTemplate } from '@langquest-next/core';

/** Return a catalog root and every descendant below it, at any depth. */
export function templateSubtree(template: ContentTemplate, rootItemId: string): Set<string> {
  if (!template.items.some((item) => item.itemId === rootItemId)) return new Set();
  const ids = new Set<string>([rootItemId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of template.items) {
      if (item.parentItemId && ids.has(item.parentItemId) && !ids.has(item.itemId)) {
        ids.add(item.itemId);
        changed = true;
      }
    }
  }
  return ids;
}
