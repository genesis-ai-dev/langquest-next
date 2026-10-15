// Whether this device can read text aloud (reviewing/reviewVoice.tsx).
import { Platform } from 'react-native';
import { t } from '../i18n';

export type Synth = { cancel: () => void; speak: (u: unknown) => void };

export const synth = (): Synth | undefined => (Platform.OS === 'web' ? (globalThis as { speechSynthesis?: Synth }).speechSynthesis : undefined);

export const Utterance = (): (new (t: string) => unknown) | undefined => (globalThis as { SpeechSynthesisUtterance?: new (t: string) => unknown }).SpeechSynthesisUtterance;

/** Whether this device can read a line aloud (the browser's own voice; devices wait for recorded lines). */
export function canSpeak(): boolean {
  return !!synth() && !!Utterance();
}
