// The screenshot a report may carry (decisions.md 144): the whole window as
// the person saw it, taken after help mode's dimming is gone and before the
// feedback sheet opens. On a phone react-native-view-shot draws the window;
// the web draws the page with html-to-image instead (capture.web.ts).
import { Dimensions, PixelRatio } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { CAPTURE_MS, SHOT_QUALITY, shotSize, type Shot } from './feedbackModel';

/** The window as a JPEG; null when it could not be drawn. */
export async function captureWindow(): Promise<Shot | null> {
  try {
    const { captureScreen } = await import('react-native-view-shot');
    const window = Dimensions.get('window');
    const size = shotSize(window, PixelRatio.get());
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
