// Where one part ends and the next begins, decided from what the microphone
// itself hears (LAN-82). Nothing said is dropped: the detector only chooses
// where parts split. It learns two levels as it listens, the room (the
// quietest the microphone has been in the last few seconds) and the voice
// (how loud this person usually is here), and needs no setting from anyone.
//
// - A part starts when a frame gets halfway from the room to the voice, or
//   when sound stays out of the room for a moment (a soft start). Its head
//   reaches back to where the sound first rose out of the room.
// - A part ends after a pause: the sound back at the room's level for the
//   pause length. Its tail keeps the fall back into the room.
// - Only a tap or a bump is dropped: less sound out of the room than a syllable.
// - The pause is one second to start with and grows to fit this person's own
//   pauses inside what they say, so a speaker who thinks mid-sentence is not
//   split there.
//
// Pure, like vadCore.ts: the web module drives it frame by frame and the
// tests feed it levels. The phones' modules must follow the same rules.

/** One frame's level in dB of its peak, as peakEnergy reports it (-60..0). */
export function levelDb(energy: number): number {
  return Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(energy, 1e-6))));
}

export const SPLIT = {
  /** The room is the quietest stretch of the last this many ms. */
  roomWindowMs: 8000,
  /** The room before anything is heard, when no earlier session left one (dB). */
  roomGuess: -50,
  /** Before a part has been said, the voice is taken to be this far over the room (dB). */
  voiceGuessOverRoom: 24,
  /** A loud frame starts a part: this share of the way from the room to the voice, and at least `startMin` dB over the room. */
  startShare: 0.5,
  startMin: 10,
  /** Back in the room: under this share of the way to the voice, and at most `quietMin` dB over the room. */
  quietShare: 0.25,
  quietMin: 6,
  /** Sound out of the room this long starts a part even without a loud frame. */
  softStartMs: 300,
  /** Finding a part's head: dips back into the room this short still belong to the sound after them. */
  headGapMs: 300,
  headMarginMs: 140,
  maxHeadMs: 3000,
  /** Kept after the last sound out of the room. */
  tailMs: 300,
  /** Less sound than this out of the room is a tap or a bump, not speech. */
  minSoundMs: 120,
  /** The pause that ends a part, before it has learned this person's own (ms). */
  pauseMs: 1000,
  maxPauseMs: 2500,
  /** Quiet gaps inside parts shorter than this are between syllables, not pauses. */
  minGapMs: 150,
  learnAfterGaps: 8
};

/** What a device remembers between sessions, so the first words of the next one are heard right. */
export interface HeardLevels {
  /** dB */
  room: number;
  /** dB */
  voice: number;
  /** ms */
  pause: number;
}

export type SplitAction =
  /** A part starts `headFrames` frames back, counting the frame just given. */
  | { type: 'start'; headFrames: number }
  /** A part ends; `trimMs` of what was recorded after its last sound goes. `discard`: it was only a tap or a bump. */
  | { type: 'stop'; discard: boolean; trimMs: number };

interface Frame { t: number; db: number }

/** The p-th quantile of numbers (0..1), or undefined for none. */
function quantile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export class Splitter {
  /** The frames of the last few seconds, for the room and a part's head. */
  private history: Frame[] = [];
  /** 3-frame medians in the room window, oldest first. */
  private calm: Frame[] = [];
  private roomDb: number;
  private voiceDb: number | null;
  private pause: number;
  private gaps: number[] = [];
  private open = false;
  private startedAt = 0;
  private lastSound = 0;
  private soundMs = 0;
  private partDbs: number[] = [];
  private quietSince: number | null = null;
  /** The end of the last part: a head never reaches into it. */
  private lastEnd = -Infinity;
  private frameMs: number;

  constructor(frameMs: number, remembered?: HeardLevels | null) {
    this.frameMs = frameMs;
    this.roomDb = remembered?.room ?? SPLIT.roomGuess;
    this.voiceDb = remembered?.voice ?? null;
    this.pause = remembered?.pause ?? SPLIT.pauseMs;
  }

  get recording(): boolean { return this.open; }

  /** The levels as they stand: the room, back-in-the-room, start, voice (dB), and the pause (ms). */
  levels(): { room: number; quiet: number; start: number; voice: number; pause: number } {
    const room = this.roomDb;
    const voice = Math.max(this.voiceDb ?? room + SPLIT.voiceGuessOverRoom, room + SPLIT.startMin);
    const span = voice - room;
    return {
      room,
      quiet: room + Math.max(SPLIT.quietMin, SPLIT.quietShare * span),
      start: room + Math.max(SPLIT.startMin, SPLIT.startShare * span),
      voice,
      pause: this.pause
    };
  }

  /** What to keep for next time. */
  remember(): HeardLevels {
    const l = this.levels();
    return { room: Math.round(l.room * 10) / 10, voice: Math.round(l.voice * 10) / 10, pause: Math.round(this.pause) };
  }

  /** The detector stopped (the source plays, or the session ended): nothing heard meanwhile heads a part. */
  pauseListening(): void {
    this.open = false;
    this.history = [];
    this.quietSince = null;
  }

  /** One frame's energy (peakEnergy) at time `now` (ms, the frame's end). */
  step(energy: number, now: number): SplitAction | null {
    const db = levelDb(energy);
    this.history.push({ t: now, db });
    const keepFrom = now - SPLIT.maxHeadMs - SPLIT.headMarginMs - this.frameMs;
    while (this.history.length > 0 && this.history[0]!.t < keepFrom) this.history.shift();
    this.trackRoom(now);
    const { quiet, start } = this.levels();
    const out = db > quiet;

    if (!this.open) {
      if (db > start || this.softRun(quiet) >= SPLIT.softStartMs) return this.begin(now, quiet);
      return null;
    }

    if (out) {
      if (this.quietSince !== null) {
        const gap = now - this.frameMs - this.quietSince;
        if (gap >= SPLIT.minGapMs) this.learnGap(gap);
        this.quietSince = null;
      }
      this.lastSound = now;
      this.soundMs += this.frameMs;
      this.partDbs.push(db);
      return null;
    }
    if (this.quietSince === null) this.quietSince = now - this.frameMs;
    if (now - this.lastSound < this.pause) return null;
    return this.end(now);
  }

  /** The session ends with a part open: what to keep of it. */
  finish(now: number): SplitAction | null {
    return this.open ? this.end(now) : null;
  }

  private begin(now: number, quiet: number): SplitAction {
    // Walk back over the sound that led up to this frame: through short dips, never into the last part.
    const h = this.history;
    let head = h.length - 1;
    let firstOut = head;
    let dip = 0;
    for (let i = h.length - 2; i >= 0; i--) {
      const f = h[i]!;
      if (f.t <= this.lastEnd || now - f.t > SPLIT.maxHeadMs) break;
      if (f.db > quiet) { firstOut = i; dip = 0; }
      else if ((dip += this.frameMs) > SPLIT.headGapMs) break;
    }
    head = firstOut;
    const margin = Math.round(SPLIT.headMarginMs / this.frameMs);
    for (let m = 0; m < margin && head > 0 && h[head - 1]!.t > this.lastEnd; m++) head--;
    this.open = true;
    this.startedAt = h[head]!.t - this.frameMs;
    this.lastSound = now;
    this.quietSince = null;
    this.partDbs = [];
    this.soundMs = 0;
    for (let i = head; i < h.length; i++) {
      if (h[i]!.db > quiet) { this.soundMs += this.frameMs; this.partDbs.push(h[i]!.db); }
    }
    return { type: 'start', headFrames: h.length - head };
  }

  private end(now: number): SplitAction {
    this.open = false;
    const keepUntil = Math.min(now, this.lastSound + SPLIT.tailMs);
    this.lastEnd = keepUntil;
    this.quietSince = null;
    const discard = this.soundMs < SPLIT.minSoundMs;
    if (!discard) this.learnVoice();
    return { type: 'stop', discard, trimMs: Math.max(0, Math.round(now - keepUntil)) };
  }

  /** How long sound has been out of the room, leading up to now, through short dips. */
  private softRun(quiet: number): number {
    let run = 0;
    let dip = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const f = this.history[i]!;
      if (f.t <= this.lastEnd) break;
      if (f.db > quiet) { run += this.frameMs; dip = 0; }
      else if ((dip += this.frameMs) > SPLIT.headGapMs / 2) break;
    }
    return run;
  }

  /** The room: the quietest 3-frame median of the last few seconds. No signal at all (-60 dB, a microphone starting) is not the room. */
  private trackRoom(now: number): void {
    const h = this.history;
    if (h.length >= 3) {
      const last = h.slice(-3).map((f) => f.db).sort((a, b) => a - b);
      if (last[0]! > -59.5) this.calm.push({ t: now, db: last[1]! });
    }
    while (this.calm.length > 0 && now - this.calm[0]!.t > SPLIT.roomWindowMs) this.calm.shift();
    if (this.calm.length === 0) return;
    let min = Infinity;
    for (const c of this.calm) min = Math.min(min, c.db);
    // Until the window has filled once, a remembered or guessed room is the floor's upper bound.
    this.roomDb = now - this.calm[0]!.t < SPLIT.roomWindowMs / 2 ? Math.min(min, this.roomDb + 3) : min;
  }

  private learnVoice(): void {
    if (this.partDbs.length * this.frameMs < 400) return;
    const loud = quantile(this.partDbs, 0.75)!;
    this.voiceDb = this.voiceDb === null ? loud : 0.7 * this.voiceDb + 0.3 * loud;
  }

  private learnGap(gap: number): void {
    this.gaps.push(gap);
    if (this.gaps.length > 30) this.gaps.shift();
    if (this.gaps.length < SPLIT.learnAfterGaps) return;
    const usual = quantile(this.gaps, 0.9)!;
    this.pause = Math.max(SPLIT.pauseMs, Math.min(SPLIT.maxPauseMs, Math.round(usual * 1.5)));
  }
}
