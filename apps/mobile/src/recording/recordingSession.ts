import { framePublishDue, liveAdd, liveChunkDone, liveDrop, liveDropSilence, liveEdge, liveFrame, livePartEnd, livePartStart, liveSeam, liveSilenceSwitch, liveStart, type LiveGap, type LiveState } from './livePartsModel';

/**
 * One recording session's parts (LAN-82), from the moment recording starts
 * until the session is left: the levels the microphone heard, each part's
 * box, and, once recording stopped, the edges the person moved, the parts
 * and silences they dropped and the boxes they added (livePartsModel.ts).
 * The microphone's frames arrive about twenty times a second and land
 * here, not in a screen's state, so only the waveform redraws for them
 * (`subscribe`); a screen that shows the count or the next part's number
 * listens for the parts alone (`onParts`).
 *
 * The waveform is told about frames at about ten a second (FRAME_PUBLISH_MS),
 * not twenty: the eye cannot tell, and the bars cost a render each. Every
 * frame is still kept at once (`state`), so a part that starts or ends lands
 * on the right frame; anything but a frame publishes straight away, with
 * the frames heard so far.
 */
export class RecordingSession {
  /** Everything heard so far. */
  private state: LiveState;
  /** What the waveform was last told; behind `state` by under FRAME_PUBLISH_MS of frames. */
  private shown: LiveState;
  private shownAt: number | null = null;
  private readonly frames = new Set<() => void>();
  private readonly partsChanged: () => void;

  constructor(firstPart: number, onParts: () => void, silence = false) {
    this.state = liveStart(firstPart, silence);
    this.shown = this.state;
    this.partsChanged = onParts;
  }

  /** The state as it stands (for useSyncExternalStore). */
  readonly snapshot = (): LiveState => this.shown;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.frames.add(listener);
    return () => { this.frames.delete(listener); };
  };

  private set(next: LiveState, parts: boolean) {
    if (next === this.state) return;
    this.state = next;
    this.publish();
    if (parts) this.partsChanged();
  }

  private publish() {
    if (this.shown === this.state) return;
    this.shown = this.state;
    for (const l of this.frames) l();
  }

  /** Where the count starts: the place the screen records into. Only before the first part, so parts already boxed keep their numbers. */
  setFirst(n: number) {
    const s = this.state;
    if (s.first !== n && !s.open && s.parts.length === 0) this.set({ ...s, first: n }, true);
  }

  frame(energy: number, quiet: number | undefined, at: number) {
    this.state = liveFrame(this.state, energy, quiet, at);
    if (!framePublishDue(this.shownAt, at)) return;
    this.shownAt = at;
    this.publish();
  }
  seam() { this.set(liveSeam(this.state), false); }
  partStart(headMs: number | undefined) { this.set(livePartStart(this.state, headMs), true); }
  partEnd(kept: Parameters<typeof livePartEnd>[1]) { this.set(livePartEnd(this.state, kept), true); }
  chunkDone(chunk: string, uri: string, ms: number) { this.set(liveChunkDone(this.state, chunk, uri, ms), true); }
  edge(index: number, edge: 'from' | 'to', frame: number) { this.set(liveEdge(this.state, index, edge, frame), true); }
  drop(index: number) { this.set(liveDrop(this.state, index), true); }
  /** A silence's × (LAN-199): that silence goes, and the numbers after it close up. */
  dropSilence(after: number) { this.set(liveDropSilence(this.state, after), true); }
  /** A + in a gap (LAN-199): a box over it, a part like any said. */
  add(gap: LiveGap, id?: string) { this.set(liveAdd(this.state, gap, id), true); }
  /** The silence switch (decision 194): the boxes and their numbers change at once. */
  setSilence(on: boolean) { this.set(liveSilenceSwitch(this.state, on), true); }
}
