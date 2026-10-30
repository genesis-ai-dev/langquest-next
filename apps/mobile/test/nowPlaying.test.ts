/**
 * Which part plays, and how far into it (Caleb, 2026-10-30: with Play all no
 * one could tell which part was playing): the players say it, and each part's
 * row reads it for its own recording, whichever player plays it.
 */
import { clearNowPlaying, nowPlaying, pauseNowPlaying, showNowPlaying, subscribeNowPlaying, tellNowPlaying } from '../src/audio/nowPlaying';

const playAll = {};
const ownButton = {};
const status = (currentTime: number, duration: number, extra: { playing?: boolean; didJustFinish?: boolean } = {}) =>
  ({ currentTime, duration, playing: extra.playing ?? true, didJustFinish: extra.didJustFinish ?? false });

afterEach(() => { clearNowPlaying(playAll); clearNowPlaying(ownButton); });

describe('what plays now', () => {
  it('lights the part Play all is in, and only that part', () => {
    tellNowPlaying(playAll, 'part-2', status(0.5, 2));
    expect(nowPlaying('part-2')).toEqual({ hash: 'part-2', at: 0.5, length: 2, playing: true });
    expect(nowPlaying('part-1')).toBeNull();
    expect(nowPlaying('part-3')).toBeNull();
  });

  it('moves to the next part, and lets the one that ended go', () => {
    tellNowPlaying(playAll, 'part-1', status(1.9, 2));
    tellNowPlaying(playAll, 'part-1', status(2, 2, { playing: false, didJustFinish: true }));
    expect(nowPlaying('part-1')).toBeNull();
    tellNowPlaying(playAll, 'part-2', status(0, 2));
    expect(nowPlaying('part-2')?.playing).toBe(true);
  });

  it('keeps a paused part where it stopped, so the row shows how far it got', () => {
    tellNowPlaying(playAll, 'part-3', status(1.2, 2));
    pauseNowPlaying(playAll);
    expect(nowPlaying('part-3')).toEqual({ hash: 'part-3', at: 1.2, length: 2, playing: false });
  });

  it('gives the part to the newest player: an older one pausing or stopping leaves it alone', () => {
    tellNowPlaying(playAll, 'part-3', status(1, 2));
    tellNowPlaying(ownButton, 'part-3', status(0.1, 2));
    pauseNowPlaying(playAll);
    clearNowPlaying(playAll);
    expect(nowPlaying('part-3')).toEqual({ hash: 'part-3', at: 0.1, length: 2, playing: true });
  });

  it('says nothing for a file played by its address, and reads a length not yet known as 0', () => {
    tellNowPlaying(playAll, null, status(1, 2));
    expect(nowPlaying('part-1')).toBeNull();
    showNowPlaying(playAll, { hash: 'part-1', at: Number.NaN, length: Number.NaN, playing: true });
    expect(nowPlaying('part-1')).toEqual({ hash: 'part-1', at: 0, length: 0, playing: true });
  });

  it('tells the rows only when something changed, and keeps the same snapshot until then', () => {
    const heard = vi.fn();
    const stop = subscribeNowPlaying(heard);
    tellNowPlaying(playAll, 'part-1', status(0.5, 2));
    const first = nowPlaying('part-1');
    tellNowPlaying(playAll, 'part-1', status(0.5, 2));
    expect(heard).toHaveBeenCalledOnce();
    expect(nowPlaying('part-1')).toBe(first);
    stop();
    tellNowPlaying(playAll, 'part-1', status(0.75, 2));
    expect(heard).toHaveBeenCalledOnce();
  });
});
