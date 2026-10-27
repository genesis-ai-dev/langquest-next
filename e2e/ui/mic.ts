// The page's microphone for the UI tests (installed before the app loads).
// support.ts installs it on every page the suite opens; recording tests also
// switch it (06-recording-helpers.ts `mic`): the voice file, a tone, or refused.

/** Installed before the app loads (page.addInitScript). */
export function installMic(): void {
  const w = window as unknown as { __lqMic?: unknown };
  const md = navigator.mediaDevices;
  if (!md || w.__lqMic) return;
  const real = md.getUserMedia.bind(md);
  const level = 0.45;
  // One tone for the page, made the first time it is asked for and kept
  // running (also wired, silent, to the speakers, so the browser never stops
  // rendering it); each microphone the app opens is a copy of its track.
  let tone: { ctx: AudioContext; osc: OscillatorNode; gain: GainNode; syllables: GainNode; lfo: OscillatorNode; track: MediaStreamTrack } | null = null;
  const toneTrack = async () => {
    if (!tone) {
      const ctx = new AudioContext({ sampleRate: 44100 });
      const osc = ctx.createOscillator();
      osc.frequency.value = 180;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const dest = ctx.createMediaStreamDestination();
      const mute = ctx.createGain();
      mute.gain.value = 0;
      // `syllables`: while on, a 2 Hz square wave opens and closes this gain (a quarter second of quiet every half
      // second, on the audio thread so a busy page cannot stretch it); off, it passes the tone through unchanged.
      const syllables = ctx.createGain();
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 2;
      lfo.start();
      osc.connect(syllables);
      syllables.connect(gain);
      gain.connect(dest);
      gain.connect(mute).connect(ctx.destination);
      osc.start();
      tone = { ctx, osc, gain, syllables, lfo, track: dest.stream.getAudioTracks()[0]! };
    }
    if (tone.ctx.state !== 'running') await tone.ctx.resume();
    shape();
    tone.gain.gain.value = ctl.speaking ? level : 0;
    return tone.track.clone();
  };
  const shape = () => {
    if (!tone) return;
    tone.lfo.disconnect();
    tone.syllables.gain.value = ctl.voiced ? 0.5 : 1;
    if (ctl.voiced) tone.lfo.connect(tone.syllables.gain);
  };
  const ctl = {
    mode: 'file' as 'file' | 'tone' | 'refuse',
    speaking: false,
    opened: 0,
    open: 0,
    state: () => tone?.ctx.state ?? 'none',
    /**
     * Speech with gaps instead of one steady tone. The product's splitter learns the room as the quietest of the last
     * 8 s (decision 125), so a tone that never dips becomes the room after a few seconds and its part ends.
     */
    syllables(on: boolean) {
      ctl.voiced = on;
      shape();
    },
    voiced: false,
    speak(on: boolean) {
      ctl.speaking = on;
      if (!tone) return;
      // Each utterance its own pitch: the app keeps parts by their content's hash, so two identical parts would be one.
      if (on) tone.osc.frequency.value = 160 + Math.random() * 40;
      tone.gain.gain.value = on ? level : 0;
      if (tone.ctx.state !== 'running') void tone.ctx.resume();
    }
  };
  w.__lqMic = ctl;
  const counted = (s: MediaStream) => {
    ctl.opened++; ctl.open++;
    s.getAudioTracks().forEach((tr) => { const stop = tr.stop.bind(tr); tr.stop = () => { if (tr.readyState !== 'ended') ctl.open--; stop(); }; });
    return s;
  };
  // Chrome starts the voice file over each time a microphone is opened, so two
  // sessions that begin alike capture the very same bytes; the app keeps parts
  // by their content's hash, and the second part is then the first again (a
  // back translation's next part, or a workspace's, silently got nothing). A
  // whisper of noise, far below the voice detector's cutoff, makes every
  // capture its own.
  const dithered = async (s: MediaStream): Promise<MediaStream> => {
    const ctx = new AudioContext({ sampleRate: 44100 });
    const src = ctx.createMediaStreamSource(s);
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 7, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.002;
    noise.buffer = buf;
    noise.loop = true;
    const dest = ctx.createMediaStreamDestination();
    src.connect(dest);
    noise.connect(dest);
    noise.start(0, Math.random() * 7);
    if (ctx.state !== 'running') await ctx.resume();
    const track = dest.stream.getAudioTracks()[0]!;
    const stop = track.stop.bind(track);
    track.stop = () => { stop(); s.getTracks().forEach((t) => t.stop()); void ctx.close(); };
    return dest.stream;
  };
  md.getUserMedia = async (c?: MediaStreamConstraints) => {
    if (!c?.audio) return real(c);
    if (ctl.mode === 'refuse') throw new DOMException('Permission denied', 'NotAllowedError');
    if (ctl.mode === 'file') return counted(await dithered(await real(c)));
    return counted(new MediaStream([await toneTrack()]));
  };
}

