/**
 * Play all on a phone's browser (Jasmine, 2026-10-30): Safari starts an
 * audio element only in a tap, or one that a tap already unlocked, and each
 * part had an element of its own, so the next part was refused after one to
 * three. Here the browser is a fake element that keeps that rule: every part
 * plays through the one element the tap unlocked.
 */
import type { RecordingStatus } from '../src/audio/recordingPlayer';

let tapping = false;
const made: FakeAudio[] = [];

/** An audio element under WebKit's rule: play() starts only in a tap, or once a tap unlocked it with load() or play(). */
class FakeAudio {
  private source = '';
  preload = '';
  paused = true;
  currentTime = 0;
  duration = Number.NaN;
  readyState = 0;
  unlocked = false;
  loads = 0;
  ontimeupdate: (() => void) | null = null;
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: { code: number } | null = null;
  constructor() { made.push(this); }
  get src() { return this.source; }
  /** A new recording starts at its beginning, its length not yet read. */
  set src(uri: string) { this.source = uri; this.currentTime = 0; this.duration = Number.NaN; this.readyState = 0; }
  load() { this.loads++; if (tapping) this.unlocked = true; }
  play(): Promise<void> {
    if (!this.unlocked && !tapping) return Promise.reject(new DOMException('not allowed', 'NotAllowedError'));
    this.unlocked = true;
    this.paused = false;
    this.onplay?.();
    return Promise.resolve();
  }
  pause() { if (this.paused) return; this.paused = true; this.onpause?.(); }
  /** The browser has read the recording's length. */
  loaded(seconds: number) { this.duration = seconds; this.readyState = 1; this.onloadedmetadata?.(); }
  /** It played to its end. */
  end() { this.currentTime = this.duration; this.paused = true; this.onended?.(); }
}

async function fresh() {
  vi.resetModules();
  made.length = 0;
  vi.stubGlobal('Audio', FakeAudio);
  return import('../src/audio/recordingPlayer.web');
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { vi.unstubAllGlobals(); tapping = false; });

describe('the web player for recordings', () => {
  it('plays every part of Play all through the one element the tap unlocked', async () => {
    const { createRecordingPlayer, unlockRecordingPlayer } = await fresh();
    tapping = true;
    unlockRecordingPlayer();
    tapping = false; // the parts start after the tap: loading, even loudness, the part before ending
    const finished: string[] = [];
    const refused: string[] = [];
    for (const uri of ['blob:1', 'blob:2', 'blob:3', 'blob:4', 'blob:5', 'blob:6']) {
      const p = createRecordingPlayer(uri);
      p.addListener('playbackStatusUpdate', (s: RecordingStatus) => {
        if (s.didJustFinish) finished.push(uri);
        if (s.refused) refused.push(uri);
      });
      p.play();
      await flush();
      made[0]!.loaded(2);
      made[0]!.end();
      p.remove();
    }
    expect(made).toHaveLength(1);
    expect(refused).toEqual([]);
    expect(finished).toEqual(['blob:1', 'blob:2', 'blob:3', 'blob:4', 'blob:5', 'blob:6']);
  });

  it('unlocks once for the page: a later tap does not reload what plays', async () => {
    const { unlockRecordingPlayer } = await fresh();
    tapping = true;
    unlockRecordingPlayer();
    unlockRecordingPlayer();
    expect(made[0]!.loads).toBe(1);
  });

  it('says it was refused, not that it failed, when no tap unlocked it, and plays on the next tap', async () => {
    const { createRecordingPlayer } = await fresh();
    const p = createRecordingPlayer('blob:1');
    const seen: RecordingStatus[] = [];
    p.addListener('playbackStatusUpdate', (s: RecordingStatus) => seen.push(s));
    p.play();
    await flush();
    expect(seen.at(-1)).toMatchObject({ refused: true, playing: false, error: null });
    tapping = true;
    p.play();
    await flush();
    expect(made[0]!.paused).toBe(false);
  });

  it('keeps where an older player was when a newer one takes the element, and goes on from there', async () => {
    const { createRecordingPlayer } = await fresh();
    tapping = true;
    const first = createRecordingPlayer('blob:first');
    first.play();
    const el = made[0]!;
    el.loaded(10);
    el.currentTime = 4;
    const second = createRecordingPlayer('blob:second');
    second.play();
    expect(el.src).toBe('blob:second');
    expect(first.currentTime).toBe(4);
    expect(first.duration).toBe(10);
    first.play();
    expect(el.src).toBe('blob:first');
    el.loaded(10);
    expect(el.currentTime).toBe(4);
  });

  it('hears nothing from the element once removed, and an older player removed leaves the newer one playing', async () => {
    const { createRecordingPlayer } = await fresh();
    tapping = true;
    const first = createRecordingPlayer('blob:first');
    const heard = vi.fn();
    first.addListener('playbackStatusUpdate', heard);
    first.play();
    const second = createRecordingPlayer('blob:second');
    second.play();
    heard.mockClear();
    first.remove();
    expect(made[0]!.paused).toBe(false);
    made[0]!.end();
    expect(heard).not.toHaveBeenCalled();
  });
});
