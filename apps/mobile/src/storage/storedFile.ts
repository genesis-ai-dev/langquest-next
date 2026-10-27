import * as Crypto from 'expo-crypto';

// What a stored file is called and how it is told: its formats, its media type and its hash.
// Here, below the server calls that move files, so they need not import the store that keeps them
// (sync/blobs.ts).

/**
 * Every kind of file the store keeps: recordings (wav, m4a), and the audio,
 * pictures and films of guides an organization writes (study@2, the guide
 * editor). The extension is part of the name, as for recordings.
 */
const STORED_FORMATS = ['wav', 'm4a', 'mp3', 'ogg', 'aac', 'jpg', 'png', 'webp', 'gif', 'mp4', 'webm'] as const;
export type StoredFormat = (typeof STORED_FORMATS)[number];
export type StoredFile = { hash: string; format: StoredFormat };

export function isStoredFormat(v: unknown): v is StoredFormat {
  return typeof v === 'string' && (STORED_FORMATS as readonly string[]).includes(v);
}

const MIME: Record<StoredFormat, string> = {
  wav: 'audio/wav', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', aac: 'audio/aac',
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm'
};

/** The media type a stored file is uploaded and played as. */
export function mimeOf(format: StoredFormat): string {
  return MIME[format];
}

/** SHA-256 hex of bytes: the name a file must have to be trusted. */
export async function hashOf(bytes: Uint8Array): Promise<string> {
  // expo-crypto wants a plain ArrayBuffer-backed view.
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, view).then(toHex);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
