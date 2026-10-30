// A picture the person chooses to send with a report, on the web (LAN-198):
// the browser's own file chooser for one image, drawn on a canvas no larger
// than PICTURE_SIDE and saved as a JPEG that fits (pictureFile.ts on phones).
// The chooser opens in the same tap, before anything waits, or a browser
// refuses to open it.
import type { View } from 'react-native';
import { PICTURE_QUALITIES, pictureFits, pictureSize } from './feedbackModel';
import type { ChosenPicture } from './pictureFile';

export function choosePicture(): Promise<ChosenPicture | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) shrink(file).then(resolve, reject); else resolve(null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Never needed on the web: choosePicture already made it fit. */
export async function shrinkPicture(_view: View, _shown: { width: number; height: number }): Promise<string | null> {
  return null;
}

async function shrink(file: Blob): Promise<ChosenPicture> {
  const url = URL.createObjectURL(file);
  try {
    const img = new window.Image();
    img.src = url;
    await img.decode();
    const size = pictureSize({ width: img.naturalWidth, height: img.naturalHeight });
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('no canvas');
    // A see-through PNG goes on white, as a JPEG cannot be see-through.
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size.width, size.height);
    g.drawImage(img, 0, 0, size.width, size.height);
    for (const quality of PICTURE_QUALITIES) {
      const base64 = canvas.toDataURL('image/jpeg', quality).replace(/^data:image\/\w+;base64,/, '');
      if (pictureFits(base64)) return { uri: `data:image/jpeg;base64,${base64}`, ...size, base64 };
    }
    throw new Error('picture too large');
  } finally {
    URL.revokeObjectURL(url);
  }
}
