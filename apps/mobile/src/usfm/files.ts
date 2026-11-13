// Files for the USFM upload (LAN-229), picked in the browser: loose `.usfm`,
// `.sfm` and `.txt` files, or a zip of them. Web only, as the guide editor's
// uploads are (guides/files.ts): a phone leaves big uploads to the web app.
import { Platform } from 'react-native';
import { decode, readZip, ZipError, type Inflate } from './zipModel';

export const canPickUsfm = Platform.OS === 'web';

export interface PickedText { name: string; text: string }
export type PickFailure = 'notZip' | 'tooMany' | 'tooBig' | 'unsupported' | 'unreadable';

const TEXT_FILE = /\.(usfm|sfm|ptx|txt)$/i;

/** Ask the browser for files. Empty when the person closes the picker. */
function pick(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.usfm,.sfm,.ptx,.txt,.zip';
    input.style.display = 'none';
    input.setAttribute('data-testid', 'usfm-file-input');
    input.addEventListener('change', () => { resolve([...(input.files ?? [])]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

const inflate: Inflate = async (raw) => {
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};


/** The text files the person picked, with a zip opened into its files. A `PickFailure` when the zip cannot be read. */
export async function pickUsfmFiles(): Promise<PickedText[] | PickFailure> {
  const files = await pick();
  return readPicked(files);
}

/** Read files already in hand (a drop, or a test). */
export async function readPicked(files: readonly File[]): Promise<PickedText[] | PickFailure> {
  const out: PickedText[] = [];
  try {
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        for (const z of await readZip(new Uint8Array(await f.arrayBuffer()), inflate)) {
          // A zip's own folders are not part of a book's name.
          if (TEXT_FILE.test(z.name)) out.push({ name: z.name.split('/').pop()!, text: decode(z.bytes) });
        }
      } else out.push({ name: f.name, text: decode(new Uint8Array(await f.arrayBuffer())) });
    }
  } catch (e) {
    return e instanceof ZipError ? e.reason : 'unreadable';
  }
  return out;
}
