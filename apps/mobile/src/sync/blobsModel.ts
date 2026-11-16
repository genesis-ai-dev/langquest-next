/**
 * What `BlobStore.reclaim` frees, worked out once for every list (docs/nearby-sync-plan.md 5.6):
 * the lists in order, each used up before the next, until `short` bytes are free on the volume
 * and the store is `over` its cap no more. The cap frees from the first list only (level 1, files
 * the server still has), so it never deletes a teammate's file from a later list; free space
 * frees from every list. A file not here, or listed twice, counts once and only if here.
 */
export function toFreeOf<T extends { hash: string }>(
  lists: readonly (readonly T[])[],
  room: { short: number; over: number; present: ReadonlySet<string>; sizes: ReadonlyMap<string, number> }
): T[] {
  let { short, over } = room;
  const chosen = new Map<string, T>();
  lists.forEach((list, i) => {
    for (const ref of list) {
      if (short <= 0 && (i > 0 || over <= 0)) break;
      if (!room.present.has(ref.hash) || chosen.has(ref.hash)) continue;
      chosen.set(ref.hash, ref);
      const size = room.sizes.get(ref.hash) ?? 0;
      short -= size;
      over -= size;
    }
  });
  return [...chosen.values()];
}
