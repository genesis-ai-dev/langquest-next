/**
 * The v2 import's converter (docs/v2-import.md section 5): a v2 file phones
 * may not play, such as the MP3 chapters some Every Language teams uploaded
 * or a browser's WebM, becomes AAC in M4A, as a phone keeps a take (mono,
 * 128 kb/s, decisions.md 106, or the source's rate when lower), so a
 * recording here stays WAV or M4A (decisions.md 58). ffmpeg does it: the job image installs it beside psql
 * (apps/web/jobs/Dockerfile); elsewhere it is whatever ffmpeg is on PATH,
 * and with none the import leaves those files for a run that has it.
 *
 * The same bytes in give the same bytes out with the same ffmpeg (bit-exact,
 * no metadata), which the import relies on when it stores a converted file
 * for a second language.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_FILE_BYTES, RECORDING_BITRATE } from '@langquest-next/core';
import { formatOf } from '@langquest-next/v2-import';

/** What the Worker takes in one file (apps/web/worker/blobs.ts MAX_BYTES). */
export const MAX_BYTES = MAX_FILE_BYTES;
/** A phone's take (decisions.md 106). */
export const BITRATE = RECORDING_BITRATE;
/** Below this, speech gets hard to follow: a file this long is not converted. */
export const MIN_BITRATE = 32_000;
/** ffmpeg runs at once: the import copies up to 64 files at a time, and each run holds a whole file. */
const AT_ONCE = 2;
/** A chapter takes seconds; one taking this long is stuck. */
const TIMEOUT_MS = 10 * 60_000;

export function ffmpegArgs(input: string, output: string, bitrate: number): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input,
    // Sound only: an MP3's cover picture would otherwise become a video track.
    '-vn', '-sn', '-dn', '-map_metadata', '-1',
    '-ac', '1', '-c:a', 'aac', '-b:a', String(bitrate),
    '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-f', 'ipod', output
  ];
}

/** A bitrate that keeps `ms` of audio inside the Worker's limit with room for the container; below MIN_BITRATE, none. */
export function fittingBitrate(ms: number, limit = MAX_BYTES): number | null {
  if (ms <= 0) return null;
  const rate = Math.floor((limit * 0.95 * 8) / (ms / 1000) / 1000) * 1000;
  return rate >= MIN_BITRATE ? Math.min(rate, BITRATE) : null;
}

/**
 * The bitrate a file is converted at: a phone's, or the source's when that
 * is lower (Central Thai SPV's chapters are 64 kb/s MP3, and AAC at the same
 * rate sounds no worse), and lower still when that is what fits; null when
 * nothing speech survives fits.
 */
export function bitrateFor(sourceBps: number | null, ms: number): number | null {
  const fit = fittingBitrate(ms);
  if (!fit) return null;
  const source = sourceBps && sourceBps > 0 ? Math.ceil(sourceBps / 1000) * 1000 : BITRATE;
  return Math.max(MIN_BITRATE, Math.min(BITRATE, source, fit));
}

/** A converter backed by ffmpeg (and ffprobe, which ships with it), or null when there is no ffmpeg to run. */
export function ffmpegConverter(bin = 'ffmpeg', probeBin = 'ffprobe'): ((bytes: Uint8Array) => Promise<Uint8Array | null>) | null {
  for (const b of [bin, probeBin]) {
    const r = spawnSync(b, ['-version'], { stdio: 'ignore' });
    if (r.error || r.status !== 0) return null;
  }
  let running = 0;
  const waiting: (() => void)[] = [];
  const turn = async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= AT_ONCE) await new Promise<void>((go) => waiting.push(go));
    running += 1;
    try {
      return await work();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
  return async (bytes) => {
    const dir = await mkdtemp(join(tmpdir(), 'v2-audio-'));
    try {
      const input = join(dir, 'in');
      const output = join(dir, 'out.m4a');
      await writeFile(input, bytes);
      const out = await turn(async () => {
        // How long and at what rate, from the file itself: something that is not audio has neither.
        const probe = await run(probeBin, ['-v', 'error', '-show_entries', 'format=duration,bit_rate', '-of', 'json', input]);
        const format = probe.ok ? (JSON.parse(probe.stdout || '{}') as { format?: { duration?: string; bit_rate?: string } }).format : undefined;
        const ms = Number(format?.duration) * 1000;
        const rate = Number.isFinite(ms) ? bitrateFor(Number(format?.bit_rate) || null, ms) : null;
        return rate && (await run(bin, ffmpegArgs(input, output, rate))).ok ? new Uint8Array(await readFile(output)) : null;
      });
      return out && out.length <= MAX_BYTES && formatOf(out) === 'm4a' ? out : null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/** Whether a tool finished cleanly, and what it printed; what it says on failure goes nowhere, since a file that is not audio is expected. */
function run(bin: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((done) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('error', () => { clearTimeout(timer); done({ ok: false, stdout }); });
    child.on('close', (code) => { clearTimeout(timer); done({ ok: code === 0, stdout }); });
  });
}
