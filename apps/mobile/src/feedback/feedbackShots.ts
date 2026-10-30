// A report's screenshot while it waits to be sent (decisions.md 145): a JPEG
// file beside the app's other documents, named by the report's id, so the
// account outbox holds only words and a phone can keep reports for months.
// A picture the person chose waits the same way, in a file of its own
// (LAN-198). The web keeps both in the browser's storage (feedbackShots.web.ts).
import { Directory, File, Paths } from 'expo-file-system';
import { noteExpected } from '../diagnostics/report';

/** The screen the report was sent from, or a picture the person chose. */
export type ShotKind = 'shot' | 'picture';

const DIR = new Directory(Paths.document, 'feedback');
const fileFor = (id: string, which: ShotKind) => new File(DIR, which === 'shot' ? `${id}.jpg` : `${id}-picture.jpg`);

export async function keepShot(id: string, base64: string, which: ShotKind = 'shot'): Promise<void> {
  if (!DIR.exists) DIR.create({ intermediates: true, idempotent: true });
  fileFor(id, which).write(base64, { encoding: 'base64' });
}

/** The screenshot (or picture) as base64, or null when there is none (or it was lost behind the app's back). */
export async function readShot(id: string, which: ShotKind = 'shot'): Promise<string | null> {
  try {
    const file = fileFor(id, which);
    return file.exists ? await file.base64() : null;
  } catch (e) {
    noteExpected(`feedback: read ${which === 'shot' ? 'screenshot' : 'picture'}`, e);
    return null;
  }
}

export async function dropShot(id: string, which: ShotKind = 'shot'): Promise<void> {
  try {
    const file = fileFor(id, which);
    if (file.exists) file.delete();
  } catch (e) { noteExpected(`feedback: drop ${which === 'shot' ? 'screenshot' : 'picture'}`, e); }
}
