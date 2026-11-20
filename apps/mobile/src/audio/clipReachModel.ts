// Whether a recording can be heard on this device, and why not when it
// cannot (LAN-317, docs/decisions/2026-11-20-unheard-recordings-are-not-judged-or-changed.md).
// A recording that cannot be heard here is not judged, said back or changed
// from here: the review, back translation and recording screens ask this
// and say which of the two reasons it is.

/** One part of a recording: its file is on this device, and the server has confirmed it holds it. */
export interface PartReach { here: boolean; stored: boolean }

/**
 * `here`: every part is a file on this device. `server`: the parts that are
 * not play from the server. `offline`: this device is not connected, so they
 * cannot. `notSent`: connected, but the server does not have a part yet (it
 * is still on the device it was recorded on). `none`: no parts, or it cannot
 * be told yet.
 */
export type ClipReach = 'here' | 'server' | 'offline' | 'notSent' | 'none';

/**
 * Offline comes first: a device that is not connected cannot know what the
 * server has since it last heard, and connecting is the first thing to try.
 */
export function clipReach(parts: readonly PartReach[], online: boolean | null): ClipReach {
  if (parts.length === 0) return 'none';
  const away = parts.filter((p) => !p.here);
  if (away.length === 0) return 'here';
  if (online === false) return 'offline';
  return away.every((p) => p.stored) ? 'server' : 'notSent';
}

/** It plays here now. */
export function canHear(reach: ClipReach): boolean {
  return reach === 'here' || reach === 'server';
}

/** Why a recording does not play here. */
export type Unheard = 'offline' | 'notSent';

/** Why it does not play here; null when it does, or when there is nothing to play. */
export function unheardOf(reach: ClipReach): Unheard | null {
  return reach === 'offline' || reach === 'notSent' ? reach : null;
}
