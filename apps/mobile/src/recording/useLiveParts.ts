import { useEffect, useState } from 'react';
import MicrophoneEnergy from '../../modules/microphone-energy';
import { liveFrame, livePartEnd, livePartStart, liveStart, type LiveState } from './livePartsModel';

/**
 * The live waveform's state for one recording session (LAN-82): every
 * microphone frame and every part's start and end, from the module's events.
 * Only one recorder holds the microphone at a time, so what is heard while
 * this is mounted is that session's.
 */
export function useLiveParts(firstPart: number): LiveState {
  const [state, setState] = useState(() => liveStart(firstPart));
  useEffect(() => {
    const subs = [
      MicrophoneEnergy.addListener('onEnergyResult', (e) => setState((s) => liveFrame(s, e.energy, e.quiet, e.timestamp))),
      MicrophoneEnergy.addListener('onSegmentStart', (e) => setState((s) => livePartStart(s, e.headMs))),
      MicrophoneEnergy.addListener('onSegmentComplete', (e) => setState((s) => livePartEnd(s, e.uri ? e.duration : null)))
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, []);
  // A part recorded into a gap changes where the count starts; parts already boxed keep their numbers.
  useEffect(() => { setState((s) => (s.open || s.parts.length ? s : { ...s, next: firstPart })); }, [firstPart]);
  return state;
}
