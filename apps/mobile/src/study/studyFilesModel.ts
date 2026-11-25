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

/** Where an open guide's audio plays from: the address a step names, and the phone's copy or the web. */
export interface StudySource {
  address: string | undefined;
  url: string | undefined;
}

/**
 * The source an open guide's player uses now (2026-11-24 review, item 25). Another address starts
 * over at once. The phone's copy of the same one arriving while the guide is open is taken up, but
 * not while it plays: a clip playing from the web is not cut off by its own download.
 */
export function studySourceNow(src: StudySource, address: string | undefined, latest: string | undefined, playing: boolean): StudySource {
  if (src.address !== address) return { address, url: latest };
  if (src.url !== latest && !playing) return { address, url: latest };
  return src;
}

/** A picture that could not load is shown as failed only for the source it failed on: a copy that arrived since is tried. */
export function failedNow(failedFor: string | undefined, shown: string | undefined): boolean {
  return failedFor !== undefined && failedFor === shown;
}

/**
 * The files a team's own guide names by hash (`study@2`, the guide editor's): each step's audio,
 * each picture and map (never a film, which phones show from its address), and each glossary
 * entry's audio, once each. What a kept passage's guide needs on the phone, besides its addresses
 * (2026-11-24 review, item 20).
 */
export function guideFilesOf(guide: {
  steps: readonly { audio: { file?: { hash: string; format: string } } }[];
  resources: readonly { media?: readonly { kind: string; file?: { hash: string; format: string } }[] }[];
  glossary?: Record<string, { audioFile?: { hash: string; format: string } }>;
}): { hash: string; format: string }[] {
  const out = new Map<string, { hash: string; format: string }>();
  const add = (f: { hash: string; format: string } | undefined) => { if (f && !out.has(f.hash)) out.set(f.hash, { hash: f.hash, format: f.format }); };
  for (const s of guide.steps) add(s.audio.file);
  for (const r of guide.resources) for (const m of r.media ?? []) if (m.kind !== 'video') add(m.file);
  for (const g of Object.values(guide.glossary ?? {})) add(g.audioFile);
  return [...out.values()];
}
