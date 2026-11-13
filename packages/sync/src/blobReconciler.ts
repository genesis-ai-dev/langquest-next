import { emptyLanguageState, isStored, referencedBlobs, type LanguageState } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseTransport } from './supabaseTransport';
import { foldStream } from './foldStream';
import type { Transport } from './types';
import { blobKey, type BlobFiles } from './workerBlobs';
import { listStreams } from './listStreams';

export interface BlobObject {
  orgId: string;
  streamId: string;
  hash: string;
  format: string;
  size: number;
}

/** Everything the reconciler touches, so it can run against fakes. */
export interface ReconcilerDeps {
  streams(): Promise<{ orgId: string; streamId: string }[]>;
  transport: Transport;
  listObjects(orgId: string, streamId: string): Promise<BlobObject[]>;
  /**
   * Does the stream's log hold any BlobStored? When it does not, no object
   * can already be confirmed and the stream need not be folded to find out
   * (an organization's or a person's stream, a language nobody has uploaded
   * to). Absent: assume it does.
   */
  hasStoredBlobs?(orgId: string, streamId: string): Promise<boolean>;
  download(o: BlobObject): Promise<Uint8Array>;
  remove(o: BlobObject): Promise<void>;
  /**
   * Put an object's bytes under another key of the same hash: a file stored under a format the
   * log does not name, with nothing under the name it does (docs/nearby-sync-plan.md section 6,
   * Repair). Absent: nothing is repaired.
   */
  copy?(from: BlobObject, to: BlobObject): Promise<void>;
  recordBlob(orgId: string, streamId: string, hash: string, size: number): Promise<void>;
  invalidateBlob(orgId: string, streamId: string, hash: string, reason: string): Promise<void>;
  /** SHA-256 hex. */
  digest(bytes: Uint8Array): Promise<string>;
}

export interface ReconcileReport {
  streams: number;
  objects: number;
  /** Files the log holds as stored (its latest verdict) that the bucket does not list: work that may be lost. Counted only with `countMissing`. */
  missing: number;
  confirmed: number;
  verified: number;
  invalidated: number;
  /** Objects whose bytes could not be fetched this pass: left alone, listed here. */
  unreadable: string[];
  /** Files copied to the name the log gives them, from one under another format. */
  repaired?: number;
}

/**
 * The hashes the log holds as stored that none of the listed objects has under the name the log
 * gives it (`<hash>.<format>`, from `referencedBlobs`), or under any name when the log names no
 * format for it. A recording whose bytes sit only under another extension counts as missing,
 * since phones ask for the name and would find nothing, until the reconciler repairs it.
 */
export function missingHashes(state: LanguageState, listed: Iterable<{ hash: string; format: string }>): string[] {
  const names = new Set<string>();
  const hashes = new Set<string>();
  for (const o of listed) {
    names.add(`${o.hash}.${o.format}`);
    hashes.add(o.hash);
  }
  const refs = referencedBlobs(state);
  return Object.keys(state.blobs).filter((hash) => {
    if (!isStored(state, hash)) return false;
    const ref = refs.get(hash);
    return ref ? !names.has(`${hash}.${ref.format}`) : !hashes.has(hash);
  });
}

/**
 * The server's own check on the bucket, independent of the Worker's
 * confirmation after each upload (decisions.md 17, 69).
 *
 * - Every object under org/stream/ that the log does not consider stored
 *   gets a BlobStored confirmation (heals a confirmation that never landed).
 * - With `verify`, each object's bytes are hashed; a mismatch with its name
 *   removes the object and appends BlobInvalidated, so devices holding the
 *   real file upload it again and nobody downloads garbage.
 *
 * Idempotent: a second pass over an unchanged bucket does nothing.
 */
export async function reconcileBlobs(deps: ReconcilerDeps, opts: { verify: boolean; pageSize?: number; countMissing?: boolean; shouldStop?: () => boolean; report?: ReconcileReport }): Promise<ReconcileReport> {
  const report: ReconcileReport = opts.report ?? { streams: 0, objects: 0, missing: 0, confirmed: 0, verified: 0, invalidated: 0, unreadable: [] };
  for (const { orgId, streamId } of await deps.streams()) {
    if (opts.shouldStop?.()) break;
    report.streams += 1;
    // The files first: a stream with none has nothing to confirm or verify, so it is not folded,
    // unless the caller counts what is missing (a stream whose files all went is the worst case).
    const objects = [...await deps.listObjects(orgId, streamId)];
    if (objects.length === 0 && !opts.countMissing) continue;
    // A log with no BlobStored holds nothing as stored: nothing to fold, and nothing can be missing.
    const stored = (await deps.hasStoredBlobs?.(orgId, streamId)) !== false;
    if (objects.length === 0 && !stored) continue;
    // A stream with files is folded when it can be repaired, confirmations or not: a file under the wrong format would be confirmed otherwise.
    const state = stored || (objects.length > 0 && deps.copy) ? await foldStream(deps.transport, orgId, streamId, opts.pageSize ?? 1000) : emptyLanguageState();
    if (opts.countMissing) report.missing += missingHashes(state, objects).length;
    if (deps.copy) objects.push(...await repairFormats(deps, deps.copy, state, objects, report));
    const unconfirmed: BlobObject[] = [];
    for (const o of objects) {
      report.objects += 1;
      if (opts.verify) {
        // A failed fetch is not evidence of corruption. Skip, report, retry next pass.
        let bytes: Uint8Array;
        try {
          bytes = await deps.download(o);
        } catch (err) {
          report.unreadable.push(`${orgId}/${streamId}/${o.hash}: ${(err as Error).message}`);
          continue;
        }
        report.verified += 1;
        const actual = await deps.digest(bytes);
        if (actual !== o.hash) {
          await deps.remove(o);
          await deps.invalidateBlob(orgId, streamId, o.hash, `hash mismatch: bytes hash to ${actual}`);
          report.invalidated += 1;
          continue;
        }
      }
      const verdict = state.blobs[o.hash];
      if (!isStored(state, o.hash) || verdict?.size !== o.size) unconfirmed.push(o);
    }
    // Each confirmation is its own call; a few at a time, as the log takes them in any order.
    await inParallel(unconfirmed, RECORD_AT_ONCE, async (o) => {
      await deps.recordBlob(orgId, streamId, o.hash, o.size);
      report.confirmed += 1;
    });
  }
  return report;
}

/**
 * A file whose bytes sit under another format than the log's `referencedBlobs` names, with
 * nothing under the right name, is copied across (docs/nearby-sync-plan.md section 6, Repair):
 * a writer's PUT names no event, so `blob_named_by` cannot hold the extension for them, and
 * `v1.BlobStored` records only hash and size. The bytes never leave R2's side of the Worker,
 * and a second pass finds the right name there and does nothing. Answers the objects made.
 */
async function repairFormats(deps: ReconcilerDeps, copy: NonNullable<ReconcilerDeps['copy']>, state: LanguageState, objects: readonly BlobObject[], report: ReconcileReport): Promise<BlobObject[]> {
  const refs = referencedBlobs(state);
  const names = new Set(objects.map((o) => `${o.hash}.${o.format}`));
  const made: BlobObject[] = [];
  for (const o of objects) {
    const ref = refs.get(o.hash);
    if (!ref || ref.format === o.format || names.has(`${o.hash}.${ref.format}`)) continue;
    const to = { ...o, format: ref.format };
    try {
      await copy(o, to);
    } catch (err) {
      report.unreadable.push(`${o.orgId}/${o.streamId}/${o.hash}: ${(err as Error).message}`);
      continue;
    }
    names.add(`${o.hash}.${ref.format}`);
    made.push(to);
    report.repaired = (report.repaired ?? 0) + 1;
  }
  return made;
}

/** Confirmations in flight at once for one stream. */
const RECORD_AT_ONCE = 4;

/** Run `work` over `items`, `limit` at a time; the first failure is thrown once those in flight have finished. */
async function inParallel<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | undefined;
  const runner = async () => {
    while (!failure && next < items.length) {
      try {
        await work(items[next++]!);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  if (failure) throw failure.error;
}

/** Wire the reconciler to a service-role Supabase client and the files it checks. */
export function reconcilerDeps(service: SupabaseClient, files: BlobFiles): ReconcilerDeps {
  const key = (o: BlobObject) => blobKey(o.orgId, o.streamId, o.hash, o.format);
  return {
    streams: async () => {
      return (await listStreams(service)).map((r) => ({ orgId: r.org_id, streamId: r.stream_id }));
    },
    transport: new SupabaseTransport(service),
    listObjects: async (orgId, streamId) => {
      const out: BlobObject[] = [];
      for (const f of await files.list(`${orgId}/${streamId}/`)) {
        const [hash, format] = (f.key.split('/')[2] ?? '').split('.');
        if (hash && format) out.push({ orgId, streamId, hash, format, size: f.size });
      }
      return out;
    },
    hasStoredBlobs: async (orgId, streamId) => {
      const { data, error } = await service.from('events').select('id')
        .eq('org_id', orgId).eq('stream_id', streamId).eq('type', 'v1.BlobStored').limit(1);
      if (error) throw new Error(`events ${orgId}/${streamId}: ${error.message}`);
      return (data ?? []).length > 0;
    },
    download: (o) => files.get(key(o)),
    remove: (o) => files.remove(key(o)),
    copy: async (from, to) => files.put(key(to), await files.get(key(from))),
    recordBlob: async (orgId, streamId, hash, size) => {
      const { error } = await service.rpc('record_blob', { p_org: orgId, p_stream: streamId, p_hash: hash, p_size: size });
      if (error) throw new Error(`record_blob: ${error.message}`);
    },
    invalidateBlob: async (orgId, streamId, hash, reason) => {
      const { error } = await service.rpc('invalidate_blob', { p_org: orgId, p_stream: streamId, p_hash: hash, p_reason: reason });
      if (error) throw new Error(`invalidate_blob: ${error.message}`);
    },
    digest: async (bytes) => {
      const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  };
}

export async function runBlobReconciler(service: SupabaseClient, files: BlobFiles, opts: { verify: boolean }): Promise<ReconcileReport> {
  return reconcileBlobs(reconcilerDeps(service, files), opts);
}
