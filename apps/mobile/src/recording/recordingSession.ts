import { liveChunkDone, liveDrop, liveEdge, liveFrame, livePartEnd, livePartStart, liveSeam, liveStart, type LiveState } from './livePartsModel';

/**
 * One recording session's parts (LAN-82), from the moment recording starts
 * until the session is left: the levels the microphone heard, each part's
 * box, and the edges the person moved or the parts they dropped once
 * recording stopped (livePartsModel.ts). The microphone's frames arrive about
 * twenty times a second and land here, not in a screen's state, so only the
 * waveform redraws for each (`subscribe`); a screen that shows the count or
 * the next part's number listens for the parts alone (`onParts`).
 */
export class RecordingSession {
  private state: LiveState;
  private readonly frames = new Set<() => void>();
  private readonly partsChanged: () => void;

  constructor(firstPart: number, onParts: () => void) {
    this.state = liveStart(firstPart);
    this.partsChanged = onParts;
  }

  /** The state as it stands (for useSyncExternalStore). */
  readonly snapshot = (): LiveState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.frames.add(listener);
    return () => { this.frames.delete(listener); };
  };

  private set(next: LiveState, parts: boolean) {
    if (next === this.state) return;
    this.state = next;
    for (const l of this.frames) l();
    if (parts) this.partsChanged();
  }

  /** Where the count starts: the place the screen records into. Only before the first part, so parts already boxed keep their numbers. */
  setFirst(n: number) {
    const s = this.state;
    if (s.first !== n && !s.open && s.parts.length === 0) this.set({ ...s, first: n }, true);
  }

  frame(energy: number, quiet: number | undefined, at: number) { this.set(liveFrame(this.state, energy, quiet, at), false); }
  seam() { this.set(liveSeam(this.state), false); }
  partStart(headMs: number | undefined) { this.set(livePartStart(this.state, headMs), true); }
  partEnd(kept: Parameters<typeof livePartEnd>[1]) { this.set(livePartEnd(this.state, kept), true); }
  chunkDone(chunk: string, uri: string, ms: number) { this.set(liveChunkDone(this.state, chunk, uri, ms), true); }
  edge(index: number, edge: 'from' | 'to', frame: number) { this.set(liveEdge(this.state, index, edge, frame), true); }
  drop(index: number) { this.set(liveDrop(this.state, index), true); }
}
