import { LanguageSession, ensureDeviceId, type LanguageSessionOptions } from '@langquest-next/sync';
import type { BlobRef } from '@langquest-next/core';
import type { BlobStore } from './blobs';
import type { RateMeter } from './rate';
import type { TransferTimings } from '../diagnostics/diagnostics';

/** What the phone brings to a language session: its store, files, transport and the app's own measuring. */
export interface LanguagePlatform {
  store: LanguageSessionOptions['store'];
  files: BlobStore;
  transport: LanguageSessionOptions['transport'];
  budget: LanguageSessionOptions['budget'];
  limits: LanguageSessionOptions['limits'];
  isDeferred: LanguageSessionOptions['isDeferred'];
  client: LanguageSessionOptions['client'];
  aroundSync: LanguageSessionOptions['aroundSync'];
  build: LanguageSessionOptions['build'];
  /** A random id; every install keeps one (decisions.md 104). */
  newId: () => string;
  /** The wire: send or fetch one file, reporting what it took. */
  send: (orgId: string, languageId: string, ref: BlobRef, files: BlobStore, timings: TransferTimings) => Promise<void>;
  fetch: (orgId: string, languageId: string, ref: BlobRef, files: BlobStore, timings: TransferTimings) => Promise<void>;
  /** Time one transfer and tally it for diagnostics. */
  timedTransfer: (dir: 'up' | 'down', where: { orgId: string; streamId: string }, run: (timings: TransferTimings) => Promise<number>) => Promise<unknown>;
  /** Report the device's upload backlog while the session lives; returns the stop. */
  registerProbe: (name: string, probe: () => ReturnType<LanguageSession['probe']>) => () => void;
  /** A sync has settled: a moment to send diagnostics. */
  settled: (files: BlobStore, blobsWanted: number) => void;
}

export interface OpenLanguageInput {
  orgId: string;
  languageId: string;
  actorId: string;
  upMeter: RateMeter;
  downMeter: RateMeter;
  /** The server answered a sync (decisions.md 166). */
  onAnswered: (at: number) => void;
  /** The file store is open. */
  onFiles: (files: BlobStore) => void;
  /** The session changed (and once it started): read `session.state` and `session.status`. */
  onChange: (session: LanguageSession) => void;
  /** A web recording's playable URL is ready. */
  onUrlReady: () => void;
}

export interface OpenedLanguage {
  session: LanguageSession;
  files: BlobStore;
  /** Stop the subscriptions and the session. */
  close: () => void;
}

/**
 * Open one language's stream on this device (decisions.md 37, 104): the
 * session with its transfers metered, then follow it. Plain code, so it is
 * tested without rendering; the `useLanguage` effect calls it and closes it.
 * Resolves to null when `isCancelled` turned true while it opened, with
 * nothing left running.
 */
export async function openLanguage(
  input: OpenLanguageInput,
  platform: LanguagePlatform,
  isCancelled: () => boolean = () => false
): Promise<OpenedLanguage | null> {
  const { orgId, languageId, actorId } = input;
  const { store, files } = platform;
  // One random id per install, persisted. Every device must differ or
  // clocks can tie and the fold becomes order-dependent.
  const deviceId = await ensureDeviceId(store, platform.newId);
  const where = { orgId, streamId: languageId };
  const session = await LanguageSession.open({
    orgId, languageId, actorId, deviceId, store, files,
    transport: platform.transport,
    upload: (ref) => metered(platform, input.upMeter, files, ref, 'up', where, (timings) => platform.send(orgId, languageId, ref, files, timings)),
    download: (ref) => metered(platform, input.downMeter, files, ref, 'down', where, (timings) => platform.fetch(orgId, languageId, ref, files, timings)),
    budget: platform.budget,
    limits: platform.limits,
    // Recording comes first: transfers, and the whole-state clone a checkpoint takes, wait.
    isDeferred: platform.isDeferred,
    client: platform.client,
    aroundSync: platform.aroundSync,
    onAnswered: input.onAnswered,
    // Recordings and file verdicts stay on the phone; memory holds the passages on screen (decisions.md 143).
    keepOnDisk: true,
    build: platform.build,
    onSettled: ({ blobsWanted }) => platform.settled(files, blobsWanted)
  });
  if (isCancelled()) { session.close(); return null; }
  input.onFiles(files);
  const stops: (() => void)[] = [];
  const publish = () => input.onChange(session);
  stops.push(session.subscribe(publish));
  // Uploads waiting and how long, for the device record (diagnostics.ts); gone with the session.
  stops.push(platform.registerProbe(`language:${orgId}/${languageId}`, () => session.probe()));
  // Web: a recording's playable URL is read from the browser's files on first ask; draw again once it is.
  stops.push(files.onUrlReady(input.onUrlReady));
  session.start();
  publish();
  return {
    session, files,
    close: () => { for (const stop of stops) stop(); session.close(); }
  };
}

/** Time one transfer, credit its bytes to the meter once it succeeds, and tally it for diagnostics either way. */
async function metered(
  platform: Pick<LanguagePlatform, 'timedTransfer'>,
  meter: RateMeter,
  store: BlobStore,
  ref: BlobRef,
  dir: 'up' | 'down',
  where: { orgId: string; streamId: string },
  run: (timings: TransferTimings) => Promise<void>
): Promise<void> {
  await platform.timedTransfer(dir, where, async (timings) => {
    await run(timings);
    const bytes = store.sizes().get(ref.hash) ?? 0;
    meter.add(bytes);
    return bytes;
  });
}
