import { createHmac } from 'node:crypto';

/** RFC 4648 base32, as authenticator keys are written. */
function base32(key: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of key.replace(/[\s=]/g, '').toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error(`not a base32 key: ${c}`);
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/**
 * The 6-digit code an authenticator app shows for `key` (RFC 6238: SHA-1,
 * 30-second steps), `steps` periods from now. The server accepts the
 * period either side of its own, so a test that enters two codes for one
 * key uses the next period's for the second, never the same code twice.
 */
export function totp(key: string, steps = 0, now = Date.now()): string {
  const counter = Math.floor(now / 30_000) + steps;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32(key)).update(msg).digest();
  const at = mac[mac.length - 1]! & 0x0f;
  const n = ((mac[at]! & 0x7f) << 24) | (mac[at + 1]! << 16) | (mac[at + 2]! << 8) | mac[at + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}
