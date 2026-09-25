import { Directory, File, Paths, UploadType } from 'expo-file-system';
import type { BlobDisk } from './diskTypes';

const dir = new Directory(Paths.document, 'blobs');
const file = (name: string) => new File(dir, name);

export const blobDisk: BlobDisk = {
  async list() {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return dir.list().flatMap((entry) => entry instanceof File ? [{ name: entry.name, size: entry.size }] : []);
  },
  async exists(name) { return file(name).exists; },
  async remove(name) { const f = file(name); if (f.exists) f.delete(); },
  async rename(from, to) { file(from).move(file(to)); },
  bytes: (name) => file(name).bytes(),
  uri: (name) => file(name).uri,
  sourceBytes: (uri) => new File(uri).bytes(),
  async adopt(uri, name) { new File(uri).move(file(name)); },
  async discardSource(uri) { new File(uri).delete(); },
  async download(url, name) { await File.downloadFileAsync(url, file(name)); },
  /** Native streaming upload: the file never enters the JS heap. */
  async upload(name, url, headers) {
    const res = await file(name).upload(url, { httpMethod: 'POST', uploadType: UploadType.BINARY_CONTENT, headers });
    return { status: res.status, body: res.body };
  },
  async freeBytes() { return Paths.availableDiskSpace; }
};

/** Is an outside file (a recording awaiting ingest) still on disk? */
export function sourceExists(uri: string): boolean {
  try { return new File(uri).exists; } catch { return false; }
}

/** Text of a file in the documents directory, if present (legacy imports). */
export async function readDocumentText(name: string): Promise<string | undefined> {
  const f = new File(Paths.document, name);
  return f.exists ? f.text() : undefined;
}
