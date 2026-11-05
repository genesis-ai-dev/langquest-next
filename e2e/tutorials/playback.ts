// What the app plays aloud in a filmed tutorial (a part, every part, the
// Bible), so the video has the app's own sound: each audio element's bytes
// once, and each stretch it played, with the page's clock when it started.
// The web app plays through audio elements (expo-audio's web player), so the
// tap is on HTMLMediaElement.play. `report` is a binding that film.ts exposes;
// `__playbackFlush()` reports what is still playing when filming ends.
// Installed before the app loads.
export function installPlaybackTap(report: string): void {
  const w = window as unknown as Record<string, ((entry: unknown) => Promise<void>) | undefined> & { __playbackFlush?: () => void };
  if (w.__playbackFlush) return;
  const ids = new WeakMap<HTMLMediaElement, number>();
  const stops = new Set<() => void>();
  w.__playbackFlush = () => { for (const s of stops) s(); };
  let next = 0;
  const send = (entry: unknown) => { void w[report]?.(entry); };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    if (!ids.has(this)) {
      const id = next++;
      ids.set(this, id);
      let from: number | null = null;
      let at = 0;
      let end = Infinity;
      const start = () => {
        if (this.paused || from !== null) return;
        from = this.currentTime;
        at = Date.now();
        end = Number.isFinite(this.duration) ? this.duration : Infinity;
      };
      // Where it stopped, by the clock: some players have already sought back to the start
      // when 'pause' arrives, so currentTime then says 0.
      const stop = () => {
        if (from === null) return;
        send({ kind: 'played', id, at, from, to: Math.min(end, from + ((Date.now() - at) / 1000) * this.playbackRate) });
        from = null;
      };
      this.addEventListener('playing', start);
      this.addEventListener('seeked', start);
      this.addEventListener('pause', stop);
      this.addEventListener('ended', stop);
      this.addEventListener('seeking', stop);
      // A player let go of mid-play (its source taken away) says neither pause nor ended.
      this.addEventListener('emptied', stop);
      this.addEventListener('abort', stop);
      stops.add(stop);
      const src = this.currentSrc || this.src;
      void fetch(src).then(async (r) => {
        const bytes = new Uint8Array(await r.arrayBuffer());
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        send({ kind: 'audio', id, type: r.headers.get('content-type') ?? '', base64: btoa(text) });
      }).catch(() => send({ kind: 'audio', id, type: '', base64: '' }));
    }
    return play.call(this);
  };
}
