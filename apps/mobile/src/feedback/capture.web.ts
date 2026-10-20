// The screenshot a report may carry, on the web (decisions.md 143): the page
// as the person saw it, drawn by html-to-image, a few kilobytes loaded only
// when feedback is sent. react-native-view-shot's web drawing (html2canvas)
// would add a quarter of a megabyte to the web app (capture.ts on phones).
import { Dimensions } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { C } from '../ui/theme';
import { CAPTURE_MS, SHOT_QUALITY, shotSize, type Shot } from './feedbackModel';

/** The page as a JPEG; null when it could not be drawn. */
export async function captureWindow(): Promise<Shot | null> {
  try {
    const { toJpeg } = await import('html-to-image');
    const window = Dimensions.get('window');
    const size = shotSize(window, 1);
    const url = await Promise.race([
      // The app's own fonts are the system's: nothing to fetch and embed.
      toJpeg(document.body, {
        quality: SHOT_QUALITY, width: window.width, height: window.height, canvasWidth: size.width, canvasHeight: size.height,
        pixelRatio: 1, skipFonts: true, backgroundColor: C.bg,
        // A clone would draw <noscript>'s "enable JavaScript" line over the top of the page.
        filter: (node) => !(node instanceof HTMLElement && (node.tagName === 'NOSCRIPT' || node.tagName === 'SCRIPT'))
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CAPTURE_MS))
    ]);
    return url ? { base64: url.replace(/^data:image\/\w+;base64,/, ''), ...size } : null;
  } catch (e) {
    // A report goes without its screenshot rather than not at all.
    noteExpected('feedback: capture', e);
    return null;
  }
}
