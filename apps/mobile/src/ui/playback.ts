const stops = new Set<() => void>();

/**
 * One thing plays at a time: whatever starts playing (a take, a source, a
 * help line, the browser's voice) registers how to stop it, and anything
 * that starts or leaves a screen stops them all. Here, with no imports, so
 * help mode can register without depending on audio; the audio folder
 * re-exports it (audio/audioSession.ts).
 */
export function registerPlayback(stop: () => void): () => void {
  stops.add(stop);
  return () => { stops.delete(stop); };
}

export function stopAudioPlayback() {
  for (const stop of stops) stop();
}
