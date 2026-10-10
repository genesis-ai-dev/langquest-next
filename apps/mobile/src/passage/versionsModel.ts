// What the Versions page and the workspace call a person's drafts
// (decisions.md 82). Pure, tested in test/versionsModel.test.ts.
import type { DraftView, Version } from '@langquest-next/core';

/**
 * "Draft" when the person keeps one; "Draft 1", "Draft 2" in the order they
 * started them when they keep more. A draft not saved yet is "New draft".
 */
export function draftName(mine: readonly Pick<DraftView, 'rootTakeId'>[], rootTakeId: string | null): string {
  const i = rootTakeId ? mine.findIndex((d) => d.rootTakeId === rootTakeId) : -1;
  if (i < 0) return 'New draft';
  return mine.length > 1 ? `Draft ${i + 1}` : 'Draft';
}

/** The draft of a person a workspace has open: the newest take of the draft that started at `rootTakeId`. */
export function draftOf<T extends Pick<DraftView, 'rootTakeId' | 'hlc' | 'takeId'>>(mine: readonly T[], rootTakeId: string | null): T | undefined {
  let out: T | undefined;
  if (!rootTakeId) return out;
  for (const d of mine) if (d.rootTakeId === rootTakeId && (!out || d.hlc > out.hlc || (d.hlc === out.hlc && d.takeId > out.takeId))) out = d;
  return out;
}

/** The version a draft started from, when it is not simply the latest ("from Version 1"); null otherwise. */
export function startedFrom(versions: readonly Pick<Version, 'takeId' | 'n'>[], basedOnTakeId: string | undefined): number | null {
  if (!basedOnTakeId) return null;
  const v = versions.find((x) => x.takeId === basedOnTakeId);
  return v ? v.n : null;
}
