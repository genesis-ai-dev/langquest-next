// A picture the person chooses to send with a report (LAN-198, decisions.md
// 145 amended): one image, through the phone's own file picker, so the app
// sees only that file and asks for no permission. Android's picker lists
// the phone's photos and other images. iPhones do not offer it: Apple's
// App Privacy answers would need Photos or Videos, and no change may force
// a new store declaration until Caleb decides to add it. A JPEG that
// already fits goes as it is. Anything else (a PNG screenshot, a large
// photo, HEIC) is shown on the sheet and taken from there as a smaller JPEG
// by shrinkPicture, with the same react-native-view-shot that takes the
// screenshot. The web picks and shrinks in the browser (pictureFile.web.ts).
import { File } from 'expo-file-system';
import { Image, PixelRatio, Platform, type View } from 'react-native';
import { CAPTURE_MS, PICTURE_BYTES, PICTURE_QUALITIES, pictureFits, pictureSize } from './feedbackModel';

/** Whether this phone offers Add a picture: Android, whose store answers already cover photos; not iPhones. */
export const canChoosePicture = Platform.OS === 'android';

/** A picture the person chose: where to show it from, its size, and the JPEG to send once it fits. */
export interface ChosenPicture { uri: string; width: number; height: number; base64: string | null }

/** The phone's picker, for one image; null when the person goes back without one. */
export async function choosePicture(): Promise<ChosenPicture | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['image/*'] });
  if (picked.canceled) return null;
  const file = picked.result;
  const { width, height } = await Image.getSize(file.uri);
  const jpeg = file.type === 'image/jpeg' && file.size <= PICTURE_BYTES ? await file.base64() : null;
  return { uri: file.uri, width, height, base64: jpeg && pictureFits(jpeg) ? jpeg : null };
}

/** The picture as shown in `view` (`shown` points), as a JPEG that fits; null when it could not be drawn small enough. */
export async function shrinkPicture(view: View, shown: { width: number; height: number }): Promise<string | null> {
  const { captureRef } = await import('react-native-view-shot');
  const ratio = PixelRatio.get();
  const size = pictureSize({ width: shown.width * ratio, height: shown.height * ratio });
  for (const quality of PICTURE_QUALITIES) {
    // A build without the native module never answers: go without.
    const taken = await Promise.race([
      captureRef(view, { format: 'jpg', quality, result: 'base64', ...size }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CAPTURE_MS))
    ]);
    if (!taken) return null;
    const base64 = taken.replace(/^data:image\/\w+;base64,/, '');
    if (pictureFits(base64)) return base64;
  }
  return null;
}
