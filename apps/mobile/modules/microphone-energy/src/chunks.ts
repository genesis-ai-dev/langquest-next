// What of a recording session is kept on storage, and where each part is in
// it (LAN-82). A part's edges can be moved after recording stops, out into
// the room around it, until the person leaves the session; so the module
// keeps the room near speech, not only the parts. A chunk file opens when a
// part starts, with up to `padMs` of what was heard before the part's head,
// and closes once `padMs` has passed after the last part in it ended. Parts
// close together share a chunk; a long silence is never written, so storage
// grows with speech, not with time. Only the ring (a few seconds) is held in
// memory.
//
// Pure, like splitter.ts: the modules do the writing, in this order for each
// frame: the ring, the open chunk's file, the splitter, then these actions.
// The phones' modules follow the same rules (Chunks.kt, Chunks.swift).
import { SPLIT, type SplitAction } from './splitter';

export const CHUNK = {
  /** The room kept on each side of what was said (ms). */
  padMs: 2000
};

/** Frames the module's ring holds: a part's longest head and the room before it. */
export function ringFrames(frameMs: number): number {
  return Math.ceil((SPLIT.maxHeadMs + SPLIT.headMarginMs + CHUNK.padMs) / frameMs) + 2;
}

export type ChunkAction =
  /** Open a chunk file with the ring's last `frames` frames, the frame just heard included. */
  | { type: 'open'; frames: number }
  /** A part is kept: samples [from, to) of the open chunk. */
  | { type: 'mark'; from: number; to: number }
  /** The chunk ends: finish its file, or delete it when no part in it was kept (only a tap or a bump). */
  | { type: 'close'; keep: boolean };

export class Chunks {
  /** How many samples each frame in the module's ring holds, oldest first. */
  private ring: number[] = [];
  private readonly ringMax: number;
  private readonly padFrames: number;
  private open = false;
  /** Samples in the open chunk so far, the frame just heard included. */
  private written = 0;
  /** Where the part being said starts in the open chunk; null between parts. */
  private partFrom: number | null = null;
  private kept = 0;
  /** When the last part ended (ms, the splitter's clock): the chunk keeps `padMs` after it. */
  private endedAt = -Infinity;
  private readonly frameMs: number;
  private readonly sampleRate: number;

  constructor(frameMs: number, sampleRate: number) {
    this.frameMs = frameMs;
    this.sampleRate = sampleRate;
    this.ringMax = ringFrames(frameMs);
    this.padFrames = Math.round(CHUNK.padMs / frameMs);
  }

  /** The ring's length for the module, so its ring and this one agree. */
  get ringSize(): number { return this.ringMax; }

  /** One frame of `samples` samples, heard at `now` (ms), and what the splitter said of it. */
  step(samples: number, action: SplitAction | null, now: number): ChunkAction[] {
    const out: ChunkAction[] = [];
    this.ring.push(samples);
    if (this.ring.length > this.ringMax) this.ring.shift();
    if (this.open) this.written += samples;
    if (action?.type === 'start') {
      if (!this.open) {
        const frames = Math.min(this.ring.length, action.headFrames + this.padFrames);
        this.open = true;
        this.kept = 0;
        this.written = this.last(frames);
        out.push({ type: 'open', frames });
      }
      this.partFrom = Math.max(0, this.written - this.last(action.headFrames));
    } else if (action?.type === 'stop' && this.partFrom !== null) {
      if (!action.discard) {
        const trim = Math.round(action.trimMs * this.sampleRate / 1000);
        out.push({ type: 'mark', from: this.partFrom, to: Math.max(this.partFrom + 1, this.written - trim) });
        this.kept++;
      }
      this.partFrom = null;
      this.endedAt = now - action.trimMs;
    }
    if (this.open && this.partFrom === null && now - this.endedAt >= CHUNK.padMs) out.push(this.close());
    return out;
  }

  /**
   * The detector stops (recording stopped, or the source is about to play):
   * a part still being said is kept to the end of what was heard, and the
   * chunk closes. The module's ring starts empty when it listens again.
   */
  stop(): ChunkAction[] {
    const out: ChunkAction[] = [];
    if (this.open) {
      if (this.partFrom !== null) {
        out.push({ type: 'mark', from: this.partFrom, to: Math.max(this.partFrom + 1, this.written) });
        this.kept++;
        this.partFrom = null;
      }
      out.push(this.close());
    }
    this.ring = [];
    this.partFrom = null;
    this.endedAt = -Infinity;
    return out;
  }

  private close(): ChunkAction {
    const keep = this.kept > 0;
    this.open = false;
    this.written = 0;
    this.kept = 0;
    return { type: 'close', keep };
  }

  /** Samples in the ring's last `frames` frames. */
  private last(frames: number): number {
    let n = 0;
    for (let i = Math.max(0, this.ring.length - frames); i < this.ring.length; i++) n += this.ring[i]!;
    return n;
  }
}
