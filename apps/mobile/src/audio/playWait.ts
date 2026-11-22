// Where a play's wait for its first sound goes (LAN-323), for the hourly
// `audio` tally (docs/diagnostics.md). One tap on Play makes one; the player
// marks the steps, and the first sound hands the parts to the tally. The
// total alone (decision 182, amended 2026-11-04) said a web play waited 4 s,
// not whether the network or the app's own work took the time.
import type { AudioWaitParts } from '@langquest-next/sync';
import { countWait, type AudioLanguage } from './audioTally';

/** How often the busy check looks; a tick later than this is time the app's own work held the page. */
const TICK_MS = 100;

export class PlayWait {
  private readonly at = Date.now();
  private linkMs = 0;
  private copyMs = 0;
  private streamed = false;
  private playAt = 0;
  private busyMs = 0;
  private last = Date.now();
  private timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    const now = Date.now();
    this.busyMs = Math.max(this.busyMs, now - this.last - TICK_MS);
    this.last = now;
  }, TICK_MS);

  /** Getting the server's link to a file this device does not have. */
  async link<T>(job: Promise<T>): Promise<T> {
    const started = Date.now();
    this.streamed = true;
    try { return await job; } finally { this.linkMs += Date.now() - started; }
  }

  /** Waiting for the even-loudness copy (levelStore.ts). */
  async copy<T>(job: Promise<T>): Promise<T> {
    const started = Date.now();
    try { return await job; } finally { this.copyMs += Date.now() - started; }
  }

  /** The player was asked to play: from now the wait is the player loading the file. */
  played(): void {
    this.playAt = Date.now();
  }

  /** The play stopped before any sound: nothing is tallied. */
  end(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The first sound: the wait and its parts go on the language's tally. */
  heard(language: AudioLanguage | null | undefined): void {
    const now = Date.now();
    // The tick that has not come yet counts too: a page held until now never ran it.
    this.busyMs = Math.max(this.busyMs, now - this.last - TICK_MS);
    this.end();
    const parts: AudioWaitParts = {
      linkMs: this.linkMs,
      copyMs: this.copyMs,
      loadMs: this.playAt ? now - this.playAt : 0,
      busyMs: this.busyMs,
      streamed: this.streamed
    };
    countWait(language, now - this.at, parts);
  }
}
