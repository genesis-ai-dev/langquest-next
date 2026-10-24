import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { durationMs, formatOf } from '@langquest-next/v2-import';
import { BITRATE, bitrateFor, ffmpegConverter, fittingBitrate, MAX_BYTES, MIN_BITRATE } from '../server/audioConvert';

/**
 * The v2 import's converter (server/audioConvert.ts, decisions.md 94): v2's
 * MP3 chapters become M4A as a phone keeps a take. The ffmpeg cases run
 * where ffmpeg is installed (the job image, a developer's computer) and are
 * skipped elsewhere; the bitrate rule always runs.
 */

describe('the bitrate a converted file gets', () => {
  it("is a phone's 128 kb/s while the file fits the Worker's 50 MB", () => {
    // 51 minutes, the longest chapter Every Language uploaded (48.9 MB of MP3).
    expect(fittingBitrate(51 * 60_000)).toBe(BITRATE);
  });

  it('is lower for a longer file, so it still fits, and none below a rate speech survives', () => {
    const rate = fittingBitrate(100 * 60_000)!;
    expect(rate).toBeLessThan(BITRATE);
    expect((rate / 8) * 100 * 60).toBeLessThan(MAX_BYTES);
    expect(fittingBitrate(10 * 3600_000)).toBeNull();
    expect(MIN_BITRATE).toBe(32_000);
  });

  it("is the source's when that is lower: a 64 kb/s chapter stays 64 kb/s rather than doubling", () => {
    // Central Thai SPV's chapters: 64 kb/s mono MP3, about 8 minutes.
    expect(bitrateFor(64_010, 457_000)).toBe(65_000);
    // Pwo Eastern Karen's longest: 20 minutes at 320 kb/s stereo.
    expect(bitrateFor(320_017, 1_221_000)).toBe(BITRATE);
    expect(bitrateFor(null, 60_000)).toBe(BITRATE);
    expect(bitrateFor(16_000, 60_000)).toBe(MIN_BITRATE);
    expect(bitrateFor(320_000, 10 * 3600_000)).toBeNull();
  });
});

const hasFfmpeg = !spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error;

describe.skipIf(!hasFfmpeg)('converting with ffmpeg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v2-convert-test-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Three seconds of a stereo tone as MP3, with a title tag, as a recorder might upload it. */
  function mp3(): Uint8Array {
    const out = join(dir, 'tone.mp3');
    const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '2', '-metadata', 'title=Mark 1', '-b:a', '128k', out]);
    if (r.status !== 0) throw new Error(`ffmpeg could not make the test MP3: ${r.stderr}`);
    return new Uint8Array(readFileSync(out));
  }

  it('turns an MP3 into a mono M4A of the same length', async () => {
    const convert = ffmpegConverter()!;
    const out = await convert(mp3());
    expect(out).not.toBeNull();
    expect(formatOf(out!)).toBe('m4a');
    expect(Math.abs(durationMs(out!, 'm4a') - 3000)).toBeLessThan(100);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,channels', '-of', 'csv=p=0', '-'], { input: out! });
    if (!probe.error) expect(probe.stdout.toString().trim()).toBe('aac,1');
  });

  it('gives the same bytes for the same file every time, so a second language stores the same hash', async () => {
    const convert = ffmpegConverter()!;
    const input = mp3();
    const [a, b] = await Promise.all([convert(input), convert(input)]);
    expect(Buffer.compare(Buffer.from(a!), Buffer.from(b!))).toBe(0);
  });

  it('answers null for a file that is not audio', async () => {
    const convert = ffmpegConverter()!;
    expect(await convert(new TextEncoder().encode('<html>Not found</html>'))).toBeNull();
  });
});

describe('without ffmpeg', () => {
  it('there is no converter, so the import leaves such files for a run that has one', () => {
    expect(ffmpegConverter('/nonexistent/ffmpeg')).toBeNull();
    expect(ffmpegConverter('ffmpeg', '/nonexistent/ffprobe')).toBeNull();
  });
});
