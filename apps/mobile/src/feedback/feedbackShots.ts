// A report's screenshot while it waits to be sent (decisions.md 145): a JPEG
// file beside the app's other documents, named by the report's id, so the
// account outbox holds only words and a phone can keep reports for months.
// The web keeps it in the browser's storage (feedbackShots.web.ts).
import { Directory, File, Paths } from 'expo-file-system';
import { noteExpected } from '../diagnostics/report';

const DIR = new Directory(Paths.document, 'feedback');
const fileFor = (id: string) => new File(DIR, `${id}.jpg`);

export async function keepShot(id: string, base64: string): Promise<void> {
  if (!DIR.exists) DIR.create({ intermediates: true, idempotent: true });
  fileFor(id).write(base64, { encoding: 'base64' });
}

/** The screenshot as base64, or null when there is none (or it was lost behind the app's back). */
export async function readShot(id: string): Promise<string | null> {
  try {
    const file = fileFor(id);
    return file.exists ? await file.base64() : null;
  } catch (e) {
    noteExpected('feedback: read screenshot', e);
    return null;
  }
}

export async function dropShot(id: string): Promise<void> {
  try {
    const file = fileFor(id);
    if (file.exists) file.delete();
  } catch (e) { noteExpected('feedback: drop screenshot', e); }
}
