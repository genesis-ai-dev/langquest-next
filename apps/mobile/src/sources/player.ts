// Plays a passage of a source: only the passage, from its first verse's
// start to its last verse's end, across chapter files (model.ts `playPlan`).
// Tapping a verse jumps there and plays on; the verse playing is reported so
// the reader can highlight it. Follows audioSession.ts: starting stops every
// other player. With the listen loop's hooks (recording/useListenLoop.ts)
// playing first waits for the microphone to pause, and every way playback
// stops is reported so recording can resume.
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from '../audioSession';
import type { ListenHooks } from '../recording/useListenLoop';
import { noteExpected } from '../report';
import { rowAt, seekTargetFor, type PlayPlan, type VerseRow } from './model';

interface PassagePlayer {
  playing: boolean;
  /** Getting the file or the link. */
  loading: boolean;
  /** Which part of the plan, and where in its file. */
  part: number;
  ms: number;
  /** Played at least once since this source was chosen. */
  started: boolean;
  /** The verse playing, when the recording has timings. */
  current: VerseRow | undefined;
  error: string;
  toggle: () => void;
  pause: () => void;
  /** Jump to a verse and play on from there; false when its place isn't known (no timings). */
  playFrom: (row: VerseRow) => boolean;
  skip: (seconds: number) => void;
}

export function usePassagePlayer(c: {
  plan: PlayPlan | null;
  rows: VerseRow[] | null;
  resolve: (part: number) => Promise<string>;
  /** A new source or passage starts over. */
  signature: string;
  listen?: ListenHooks;
  disabled?: boolean;
  /** Called the first time it plays (the record of what was used). */
  onPlayed?: () => void;
}): PassagePlayer {
  const [playing, setPlayingState] = useState(false);
  const [loading, setLoading] = useState(false);
  const [part, setPart] = useState(0);
  const [ms, setMs] = useState(0);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  const player = useRef<AudioPlayer | null>(null);
  const playerPart = useRef(-1);
  const generation = useRef(0);
  const live = useRef({ c, part: 0, ms: 0 });
  live.current = { c, part, ms };
  const reported = useRef(false);
  const self = useRef(false);
  /** The current part reached its end; later status updates from its player are ignored. */
  const ended = useRef(false);

  const setPlaying = (on: boolean) => {
    setPlayingState(on);
    if (reported.current !== on) { reported.current = on; live.current.c.listen?.onPlaying(on); }
  };
  const drop = () => {
    player.current?.remove();
    player.current = null;
    playerPart.current = -1;
  };
  const halt = () => {
    if (self.current) return;
    generation.current++;
    player.current?.pause();
    setLoading(false);
    setPlaying(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => registerPlayback(halt), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (c.disabled) halt(); }, [c.disabled]);
  useEffect(() => {
    generation.current++;
    drop();
    setPart(0); setMs(c.plan?.parts[0]?.fromMs ?? 0); setStarted(false); setError(''); setLoading(false);
    if (reported.current) { reported.current = false; live.current.c.listen?.onPlaying(false); }
    setPlayingState(false);
    return () => { generation.current++; drop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.signature]);

  async function start(at: number, fromMs: number) {
    const plan = live.current.c.plan;
    const target = plan?.parts[at];
    if (!plan || !target || live.current.c.disabled) return;
    const run = ++generation.current;
    ended.current = false;
    setPlaying(true);
    setError('');
    setPart(at);
    setMs(fromMs);
    if (!started) { setStarted(true); live.current.c.onPlayed?.(); }
    try {
      // The microphone first: nothing of the source may land in a take.
      await live.current.c.listen?.beforePlay();
      if (generation.current !== run) return;
      self.current = true;
      try { stopAudioPlayback(); } finally { self.current = false; }
      await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
      if (generation.current !== run) return;
      if (player.current && playerPart.current === at) {
        await player.current.seekTo(fromMs / 1000);
        if (generation.current === run) player.current.play();
        return;
      }
      drop();
      setLoading(true);
      const uri = await live.current.c.resolve(at);
      if (generation.current !== run) return;
      const p = createAudioPlayer({ uri }, { updateInterval: 250 });
      player.current = p;
      playerPart.current = at;
      p.addListener('playbackStatusUpdate', (st) => {
        if (player.current !== p || ended.current) return;
        if (st.error) { fail('Audio could not load. Check your connection and try again.'); return; }
        if (st.isLoaded) setLoading(false);
        const now = Math.round(st.currentTime * 1000);
        setMs(now);
        const end = live.current.c.plan?.parts[at]?.toMs;
        if (st.didJustFinish || (end != null && now >= end && st.playing)) { ended.current = true; next(at); }
      });
      if (fromMs > 0) await p.seekTo(fromMs / 1000);
      if (generation.current === run) p.play();
    } catch (e) {
      noteExpected('source player', e);
      if (generation.current === run) fail(e instanceof Error && e.message ? e.message : 'Audio could not play.');
    }
  }

  function fail(message: string) {
    generation.current++;
    drop();
    setLoading(false);
    setPlaying(false);
    setError(message);
  }

  /** The passage plays on into the next chapter's file, and stops at its end. */
  function next(at: number) {
    const plan = live.current.c.plan;
    const following = plan?.parts[at + 1];
    if (!following) {
      player.current?.pause();
      generation.current++;
      setPlaying(false);
      // Back to the start, so Play plays the passage again.
      setPart(0); setMs(plan?.parts[0]?.fromMs ?? 0);
      return;
    }
    void start(at + 1, following.fromMs);
  }

  const toggle = () => {
    if (playing) { halt(); return; }
    const plan = live.current.c.plan;
    if (!plan || plan.parts.length === 0) return;
    const p = plan.parts[part];
    const atEnd = !p || (p.toMs != null && ms >= p.toMs);
    void start(atEnd ? 0 : part, atEnd ? plan.parts[0]!.fromMs : Math.max(p.fromMs, ms));
  };

  const playFrom = (row: VerseRow) => {
    const plan = live.current.c.plan;
    if (!plan) return false;
    const t = seekTargetFor(plan, row);
    if (!t) return false;
    void start(t.part, t.ms);
    return true;
  };

  const skip = (seconds: number) => {
    const plan = live.current.c.plan;
    const p = plan?.parts[part];
    if (!plan || !p) return;
    const to = ms + seconds * 1000;
    if (p.toMs != null && to >= p.toMs) { if (plan.parts[part + 1]) void start(part + 1, plan.parts[part + 1]!.fromMs); return; }
    if (to < p.fromMs && part > 0) { const prev = plan.parts[part - 1]!; void start(part - 1, Math.max(prev.fromMs, (prev.toMs ?? to) - 10_000)); return; }
    const clamped = Math.max(p.fromMs, to);
    if (playing && player.current && playerPart.current === part) {
      setMs(clamped);
      player.current.seekTo(clamped / 1000).catch((e: unknown) => noteExpected('source player: seek', e));
    } else setMs(clamped);
  };

  const current = started && c.plan && c.rows ? rowAt(c.plan, part, ms, c.rows) : undefined;
  return { playing, loading, part, ms, started, current, error, toggle, pause: halt, playFrom, skip };
}
