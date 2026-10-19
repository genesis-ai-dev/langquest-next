// The screenshot a report may carry (decisions.md 141): the whole window as
// the person saw it, taken after help mode's dimming is gone and before the
// feedback sheet opens. react-native-view-shot draws the window on a phone
// and the page (html2canvas) on the web; it loads only when someone sends
// feedback, so the web's first visit does not carry it.
import { Dimensions, PixelRatio, Platform } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { SHOT_QUALITY, shotSize } from './feedbackModel';

/** A JPEG as base64, with its size; null when the screen could not be drawn. */
export interface Shot { base64: string; width: number; height: number }

/** Longer than a slow phone takes to draw its window, short enough that the sheet still opens promptly. */
const CAPTURE_MS = 4000;

export async function captureWindow(): Promise<Shot | null> {
  try {
    const { captureScreen } = await import('react-native-view-shot');
    const window = Dimensions.get('window');
    const size = shotSize(window, Platform.OS === 'web' ? 1 : PixelRatio.get());
    // A build without the native module never answers (react-native-view-shot waits for ever): go without.
    const base64 = await Promise.race([
      captureScreen({ format: 'jpg', quality: SHOT_QUALITY, result: 'base64', ...size }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CAPTURE_MS))
    ]);
    return base64 ? { base64: base64.replace(/^data:image\/\w+;base64,/, ''), ...size } : null;
  } catch (e) {
    // A report goes without its screenshot rather than not at all.
    noteExpected('feedback: capture', e);
    return null;
  }
}
