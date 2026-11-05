// The microphone in a filmed tutorial: recordings that the film starts when
// the person in the video starts speaking (`window.__tutorialMic.play(n)`
// plays the nth), so the film knows to the frame when each word was said.
// Between them the microphone hears a quiet room. Installed before the app loads.
export function installTutorialMic(urls: string[]): void {
  const w = window as unknown as { __tutorialMic?: unknown };
  const md = navigator.mediaDevices;
  if (!md || w.__tutorialMic) return;
  const real = md.getUserMedia.bind(md);
  let ctx: AudioContext | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  let buffers: Promise<AudioBuffer>[] = [];
  const setUp = () => {
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: 48000 });
      dest = ctx.createMediaStreamDestination();
      buffers = urls.map((url) => fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx!.decodeAudioData(b)));
    }
    return { ctx, dest: dest!, buffers };
  };
  w.__tutorialMic = {
    /** Starts the nth recording; resolves with the page's clock when its first sample plays. */
    play: async (n = 0): Promise<number> => {
      const { ctx: c, dest: d, buffers: b } = setUp();
      if (c.state !== 'running') await c.resume();
      const source = c.createBufferSource();
      source.buffer = await b[n]!;
      source.connect(d);
      source.start();
      return Date.now();
    }
  };
  md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    if (!constraints?.audio) return real(constraints);
    const { ctx: c, dest: d } = setUp();
    if (c.state !== 'running') await c.resume();
    return new MediaStream(d.stream.getAudioTracks().map((t) => t.clone()));
  };
}
