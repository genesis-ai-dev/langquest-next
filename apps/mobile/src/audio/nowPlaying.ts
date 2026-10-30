// Which recording plays now and how far into it, so the part's row shows
// it whichever button started it: its own play button, Play all on the
// parts card, or the player above a version's parts (Caleb, 2026-10-30:
// with Play all no one could tell which part was playing, or how far into
// it). The players that play the parts (useClip, ClipPlayer) say it here as
// they play; a row reads it for its own part (useNowPlaying).

/** Where a recording is: `at` seconds of `length` (0 while not known), and whether it is playing or paused there. */
export interface Playing { hash: string; at: number; length: number; playing: boolean }

let now: { owner: object; is: Playing } | null = null;
const listeners = new Set<() => void>();

function tell() {
  for (const l of listeners) l();
}

/** `owner`'s player is at `is`; it takes the place of whatever another player said. */
export function showNowPlaying(owner: object, is: Playing): void {
  const was = now?.is;
  if (now?.owner === owner && was && was.hash === is.hash && was.at === is.at && was.length === is.length && was.playing === is.playing) return;
  now = { owner, is: { ...is, at: Math.max(0, Number.isFinite(is.at) ? is.at : 0), length: Number.isFinite(is.length) && is.length > 0 ? is.length : 0 } };
  tell();
}

/** A player's report on recording `hash` (none for a file played by its address): where it is, or gone once it played to its end. */
export function tellNowPlaying(owner: object, hash: string | null, status: { currentTime: number; duration: number; playing: boolean; didJustFinish: boolean }): void {
  if (!hash) return;
  if (status.didJustFinish) { clearNowPlaying(owner); return; }
  showNowPlaying(owner, { hash, at: status.currentTime, length: status.duration, playing: status.playing });
}

/** `owner` paused: its recording shows where it stopped. */
export function pauseNowPlaying(owner: object): void {
  if (now?.owner !== owner || !now.is.playing) return;
  now = { owner, is: { ...now.is, playing: false } };
  tell();
}

/** `owner` is done, or gone: nothing it played shows any more. */
export function clearNowPlaying(owner: object): void {
  if (now?.owner !== owner) return;
  now = null;
  tell();
}

export function subscribeNowPlaying(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Where recording `hash` is, or null when no player has it. The same object until something changes, as a store's snapshot must be. */
export function nowPlaying(hash: string): Playing | null {
  return now && now.is.hash === hash ? now.is : null;
}
