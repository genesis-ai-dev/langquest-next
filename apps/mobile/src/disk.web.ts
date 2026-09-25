// Web is a test target (metro.config.js). Blobs live in the origin-private
// file system: every write resolves only after the file is closed on disk,
// so a tab killed after a save keeps what the phone would keep.
import type { BlobDisk } from './diskTypes';

let root: Promise<FileSystemDirectoryHandle> | undefined;
const dir = () => root ??= navigator.storage.getDirectory()
  .then((opfs) => opfs.getDirectoryHandle('blobs', { create: true }));

/** Object URLs of stored files, so `uri` can answer synchronously. */
const urls = new Map<string, string>();

async function handle(name: string, create = false) {
  return (await dir()).getFileHandle(name, { create });
}

async function write(name: string, bytes: Uint8Array | Blob) {
  const writable = await (await handle(name, true)).createWritable();
  await writable.write(bytes as Uint8Array<ArrayBuffer> | Blob);
  await writable.close();
  await publish(name);
}

async function publish(name: string) {
  const old = urls.get(name);
  if (old) URL.revokeObjectURL(old);
  urls.set(name, URL.createObjectURL(await (await handle(name)).getFile()));
}

function forget(name: string) {
  const old = urls.get(name);
  if (old) URL.revokeObjectURL(old);
  urls.delete(name);
}

async function fetchBytes(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url.slice(0, 80)}`);
  return new Uint8Array(await res.arrayBuffer());
}

export const blobDisk: BlobDisk = {
  async list() {
    const out: { name: string; size: number | null }[] = [];
    for await (const entry of (await dir()).values()) {
      if (entry.kind !== 'file') continue;
      const f = await (entry as FileSystemFileHandle).getFile();
      urls.set(entry.name, URL.createObjectURL(f));
      out.push({ name: entry.name, size: f.size });
    }
    return out;
  },
  async exists(name) {
    try { await handle(name); return true; } catch { return false; }
  },
  async remove(name) {
    forget(name);
    try { await (await dir()).removeEntry(name); }
    catch (e) { if ((e as DOMException).name !== 'NotFoundError') throw e; }
  },
  async rename(from, to) {
    // Chrome's OPFS handles support move(); journeys run in Chrome.
    const h = await handle(from) as FileSystemFileHandle & { move(name: string): Promise<void> };
    await h.move(to);
    forget(from);
    await publish(to);
  },
  async bytes(name) {
    return new Uint8Array(await (await (await handle(name)).getFile()).arrayBuffer());
  },
  uri(name) {
    const url = urls.get(name);
    if (!url) throw new Error(`No stored file named ${name}.`);
    return url;
  },
  sourceBytes: fetchBytes,
  async adopt(uri, name, bytes) {
    await write(name, bytes);
    await blobDisk.discardSource(uri);
  },
  async discardSource(uri) {
    if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
  },
  async download(url, name) {
    await write(name, await fetchBytes(url));
  },
  async upload(name, url, headers) {
    const body = await (await handle(name)).getFile();
    const res = await fetch(url, { method: 'POST', headers, body });
    return { status: res.status, body: await res.text() };
  },
  async freeBytes() {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    return quota - usage;
  }
};

/**
 * Browser recordings are blob: URLs, which never outlive the page that made
 * them. Resume runs at project open, after any reload, so such a file is
 * missing. resumeEntries keeps the journal entry and reports it failed.
 */
export function sourceExists(_uri: string): boolean {
  return false;
}

/** No legacy documents exist on web. */
export async function readDocumentText(_name: string): Promise<string | undefined> {
  return undefined;
}
