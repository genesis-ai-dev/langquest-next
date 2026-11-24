// Which study files a phone may clear (study/studyFiles.ts). Pure.

/** A study file on this phone: its name (a hash of its address), how big it is, and when it was written. */
export interface StudyFileHere {
  name: string;
  bytes: number;
  at: number;
}

/**
 * The study files to delete: only files no kept passage needs (`needed`, by
 * name, in any language on this phone) and written since `since`, oldest
 * first, while those come to more than `spareBytes` or the device is
 * `shortBytes` short of the room it keeps for recording. A file a kept
 * passage needs is never deleted, however short the device is, as recordings
 * and reference audio are kept. Nor is one written before `since` (the first
 * run of the build that keeps each language's list): a language not opened
 * since may need it, and nothing on the phone says (decision
 * 2026-11-23-study-files-are-cleared-when-no-kept-passage-needs-them.md).
 */
export function studyEvictions(
  files: readonly StudyFileHere[], needed: ReadonlySet<string>, o: { spareBytes: number; shortBytes: number; since: number }
): string[] {
  const spare = files.filter((f) => !needed.has(f.name) && f.at >= o.since).sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
  let left = spare.reduce((n, f) => n + f.bytes, 0);
  let freed = 0;
  const out: string[] = [];
  for (const f of spare) {
    if (left <= o.spareBytes && freed >= o.shortBytes) break;
    out.push(f.name);
    left -= f.bytes;
    freed += f.bytes;
  }
  return out;
}
