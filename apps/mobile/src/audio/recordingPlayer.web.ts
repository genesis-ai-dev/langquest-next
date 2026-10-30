// The recordings people make play through one audio element on the web.
// A phone's browser starts an element only in a tap, or within a second of
// one a tap started ending (WebKit), and expo-audio makes a new element for
// each player: Play all's next part was refused (NotAllowedError) after one
// to three parts, and a first part whose even-loudness copy took long to
// make could be too. One element, unlocked by the tap that starts playing,
// may play every part after it. The newest player holds it; an older one
// lets go, keeping where it was, and takes it back when it plays again.
import type { RecordingPlayer, RecordingStatus } from './recordingPlayer';

let shared: HTMLAudioElement | null = null;
let holder: WebRecordingPlayer | null = null;
let unlocked = false;

function element(): HTMLAudioElement {
  if (!shared) { shared = new Audio(); shared.preload = 'auto'; }
  return shared;
}

const finite = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

class WebRecordingPlayer implements RecordingPlayer {
  private readonly listeners = new Set<(status: RecordingStatus) => void>();
  /** Where it was when another player took the element, or a seek asked for before the recording loaded. */
  private at = 0;
  private length = 0;
  private seekWhenLoaded: number | null = null;

  constructor(private readonly uri: string) {}

  private get holding(): boolean { return holder === this; }

  private emit(extra: Partial<RecordingStatus> = {}) {
    const status: RecordingStatus = { currentTime: this.currentTime, duration: this.duration, playing: this.holding && !element().paused,
      didJustFinish: false, error: null, ...extra };
    for (const l of this.listeners) l(status);
  }

  /** The element, with this recording in it. */
  private take(): HTMLAudioElement {
    const el = element();
    if (this.holding) return el;
    holder?.letGo();
    holder = this;
    const mine = () => holder === this;
    el.ontimeupdate = () => { if (mine()) this.emit(); };
    el.onplay = () => { if (mine()) this.emit(); };
    el.onpause = () => { if (mine()) this.emit(); };
    el.onloadedmetadata = () => {
      if (!mine()) return;
      this.length = finite(el.duration) || this.length;
      if (this.seekWhenLoaded !== null) { el.currentTime = this.seekWhenLoaded; this.seekWhenLoaded = null; }
      this.emit();
    };
    el.onended = () => { if (mine()) this.emit({ didJustFinish: true, playing: false }); };
    // i18n-ignore: for the error report; the players show their own words (common.audioCouldNotLoad)
    el.onerror = () => { if (mine()) this.emit({ error: `Playback error (code ${el.error?.code ?? 0})`, playing: false }); };
    if (this.at > 0) this.seekWhenLoaded = this.at;
    el.src = this.uri;
    return el;
  }

  private letGo() {
    const el = element();
    this.at = el.currentTime;
    this.length = finite(el.duration) || this.length;
    el.pause();
  }

  get duration(): number { return this.holding ? finite(element().duration) || this.length : this.length; }
  get currentTime(): number { return this.holding ? (this.seekWhenLoaded ?? element().currentTime) : this.at; }

  play(): void {
    const el = this.take();
    el.play().catch((e: unknown) => {
      if (!this.holding) return;
      // Another src or a pause before it started is not a failure.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (e instanceof DOMException && e.name === 'NotAllowedError') { this.emit({ refused: true, playing: false }); return; }
      this.emit({ error: e instanceof Error ? e.message : String(e), playing: false });
    });
  }

  pause(): void {
    if (this.holding) element().pause();
  }

  remove(): void {
    this.listeners.clear();
    if (!this.holding) return;
    element().pause();
    holder = null;
  }

  seekTo(seconds: number): Promise<void> {
    const el = element();
    if (this.holding && el.readyState >= 1) el.currentTime = seconds;
    else if (this.holding) this.seekWhenLoaded = seconds;
    else this.at = seconds;
    return Promise.resolve();
  }

  addListener(_event: 'playbackStatusUpdate', listener: (status: RecordingStatus) => void): { remove(): void } {
    this.listeners.add(listener);
    return { remove: () => { this.listeners.delete(listener); } };
  }
}

export function createRecordingPlayer(uri: string): RecordingPlayer {
  return new WebRecordingPlayer(uri);
}

/**
 * Called by the tap that starts playing, before anything is awaited: a load
 * in a tap lifts the element's need for one, so whatever it plays later
 * starts without a tap of its own. Once is enough for the page.
 */
export function unlockRecordingPlayer(): void {
  if (unlocked) return;
  unlocked = true;
  element().load();
}
