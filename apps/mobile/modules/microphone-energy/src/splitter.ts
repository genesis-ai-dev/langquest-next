// Where one part ends and the next begins, decided from what the microphone
// itself hears (LAN-82). Nothing said is dropped: the detector only chooses
// where parts split. It learns two levels as it listens, the room (how loud
// it usually is here when this person is not speaking above it: the quieter
// fifth of the last few seconds) and the voice (how loud this person usually
// is here), and needs no setting from anyone. Where a speech model scores
// each frame (speech.ts, decision 135), a part is only sound that is both out
// of the room and speech, so a fan, a clink or a car is never a part, while
// other people talking further off stay under the room's level.
//
// - A part starts when a frame gets halfway from the room to the voice, or
//   when sound stays out of the room for a moment (a soft start); with the
//   model, two of the last three frames must also be speech. Its head
//   reaches back to where the sound first rose out of the room.
// - A part ends after a pause: the sound back at the room's level (judged on
//   the median of the last five frames, so one clink or laugh does not hold
//   it open), or no longer speech, for the pause length. Its tail keeps the
//   fall back into the room.
// - Only a tap or a bump is dropped: less sound out of the room than a syllable.
// - The pause is one second to start with and grows to fit this person's own
//   pauses inside what they say, so a speaker who thinks mid-sentence is not
//   split there.
// - The room starts from what this device heard last time, and in the first
//   moments of listening gives way at once to a louder room heard now, when
//   the model says what is heard is not speech.
//
// Pure, like vadCore.ts: the web module drives it frame by frame and the
// tests feed it levels. The phones' modules must follow the same rules.

/** One frame's level in dB of its peak, as peakEnergy reports it (-60..0). */
export function levelDb(energy: number): number {
  return Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(energy, 1e-6))));
}

export const SPLIT = {
  /** The room is the quietest 3-frame median of the last this many ms; with a speech model, the level only `roomPercentile` of them fall under. */
  roomWindowMs: 8000,
  roomPercentile: 0.2,
  /** With a speech model: inside a part the room stays at least this far under the part's own loud end (dB), so a reader who never pauses is not the room. */
  roomUnderPartDb: 10,
  /** With a speech model: in the first this many ms of listening, a room louder than the remembered one, and not speech, is taken at once. */
  trustNowMs: 600,
  /** With a speech model: inside a part, back in the room is judged on the median of this many frames. */
  endMedianFrames: 5,
  /** A speech model's score (speech.ts): at least `speechOn` is speech; under `speechOff` it is not speech any more. */
  speechOn: 0.5,
  speechOff: 0.35,
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
  learnAfterGaps: 8,
  /** Exact silence this long is the room (a quiet line, a noise gate); shorter, it is a microphone starting. */
  zeroRoomMs: 500,
  /** While a part is open the room rises at most this fast (dB a second), so speech never becomes the room. */
  roomRisePerSec: 1.5
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

/** A frame heard: when (ms), its level (dB), and how sure a speech model is that it is speech (null: no model). */
interface Frame { t: number; db: number; s: number | null }

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
  private calm: { t: number; db: number }[] = [];
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
  /** How long the 3-frame median has been exact silence (-60 dB). */
  private zeroMs = 0;
  /** How long this has listened since it last started (for trusting the room heard now). */
  private listenedMs = 0;
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
    this.zeroMs = 0;
    this.listenedMs = 0;
  }

  /**
   * One frame's energy (peakEnergy) at time `now` (ms, the frame's end), and
   * a speech model's score for it (0..1), or null where there is no model.
   */
  step(energy: number, now: number, speech: number | null = null): SplitAction | null {
    const db = levelDb(energy);
    this.history.push({ t: now, db, s: speech });
    const keepFrom = now - SPLIT.maxHeadMs - SPLIT.headMarginMs - this.frameMs;
    while (this.history.length > 0 && this.history[0]!.t < keepFrom) this.history.shift();
    this.trackRoom(now);
    this.listenedMs += this.frameMs;
    const { quiet, start } = this.levels();

    if (!this.open) {
      if ((db > start || this.softRun(quiet) >= SPLIT.softStartMs) && this.speaking()) return this.begin(now, quiet);
      return null;
    }

    // With a model: back in the room on the median of the last few frames, so one clink or laugh is not sound, or no longer speech.
    let out = db > quiet;
    if (speech !== null) {
      const recent = this.history.slice(-SPLIT.endMedianFrames).map((f) => f.db).sort((a, b) => a - b);
      out = recent[Math.floor((recent.length - 1) / 2)]! > quiet && speech >= SPLIT.speechOff;
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

  /** Where a model scores frames, two of the last three are speech; with none, any sound may start a part. */
  private speaking(): boolean {
    const last = this.history.slice(-3);
    if (last[last.length - 1]!.s === null) return true;
    return last.filter((f) => (f.s ?? 0) >= SPLIT.speechOn).length >= 2;
  }

  /** Out of the room, and speech where a model says. */
  private heard(f: Frame, quiet: number): boolean {
    return f.db > quiet && (f.s === null || f.s >= SPLIT.speechOff);
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
      if (this.heard(f, quiet)) { firstOut = i; dip = 0; }
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
      if (this.heard(h[i]!, quiet)) { this.soundMs += this.frameMs; this.partDbs.push(h[i]!.db); }
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
      if (this.heard(f, quiet)) { run += this.frameMs; dip = 0; }
      else if ((dip += this.frameMs) > SPLIT.headGapMs / 2) break;
    }
    return run;
  }

  /**
   * The room, from the 3-frame medians of the last few seconds: the quietest
   * of them, or with a speech model the level only a fifth fall under. Exact
   * silence (-60 dB) is the room only once it has lasted zeroRoomMs; a
   * microphone starting gives a few frames of it, and they are not the room.
   */
  private trackRoom(now: number): void {
    const h = this.history;
    if (h.length >= 3) {
      const median = h.slice(-3).map((f) => f.db).sort((a, b) => a - b)[1]!;
      this.zeroMs = median <= -59.5 ? this.zeroMs + this.frameMs : 0;
      if (median > -59.5 || this.zeroMs >= SPLIT.zeroRoomMs) this.calm.push({ t: now, db: median });
    }
    while (this.calm.length > 0 && now - this.calm[0]!.t > SPLIT.roomWindowMs) this.calm.shift();
    if (this.calm.length === 0) return;
    const last = h[h.length - 1];
    if (!last || last.s === null) {
      // No model: the quietest stretch heard. Between parts the room follows it; inside one it only creeps up.
      let min = Infinity;
      for (const c of this.calm) min = Math.min(min, c.db);
      const rise = this.open ? SPLIT.roomRisePerSec * this.frameMs / 1000 : 3;
      this.roomDb = Math.min(min, this.roomDb + rise);
      return;
    }
    // With a model: how loud it usually is here (the quietest instant sits under a cafe's chatter, which never falls back to it).
    const usual = quantile(this.calm.map((c) => c.db), SPLIT.roomPercentile)!;
    // A room remembered from a quieter place gives way at once to the one heard now, when that is not speech.
    if (last.s < SPLIT.speechOff && this.listenedMs < SPLIT.trustNowMs && usual > this.roomDb) { this.roomDb = usual; return; }
    const rise = this.open ? SPLIT.roomRisePerSec * this.frameMs / 1000 : 3;
    this.roomDb = Math.min(usual, this.roomDb + rise);
    // A reader who never pauses for long does not become the room.
    if (this.open && this.partDbs.length >= 10) this.roomDb = Math.min(this.roomDb, quantile(this.partDbs, 0.75)! - SPLIT.roomUnderPartDb);
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
