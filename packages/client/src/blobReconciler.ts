import { REDUCER_VERSION, emptyLanguageState, foldLanguage, isStored, resume, type AnyEvent, type LanguageState } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseTransport } from './supabaseTransport';
import { fetchSnapshot } from './snapshotFetch';
import type { Transport } from './types';
import { blobKey, type BlobFiles } from './workerBlobs';

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
  download(o: BlobObject): Promise<Uint8Array>;
  remove(o: BlobObject): Promise<void>;
  recordBlob(orgId: string, streamId: string, hash: string, size: number): Promise<void>;
  invalidateBlob(orgId: string, streamId: string, hash: string, reason: string): Promise<void>;
  /** SHA-256 hex. */
  digest(bytes: Uint8Array): Promise<string>;
}

interface ReconcileReport {
  streams: number;
  objects: number;
  confirmed: number;
  verified: number;
  invalidated: number;
  /** Objects whose bytes could not be fetched this pass: left alone, listed here. */
  unreadable: string[];
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
export async function reconcileBlobs(deps: ReconcilerDeps, opts: { verify: boolean; pageSize?: number }): Promise<ReconcileReport> {
  const report: ReconcileReport = { streams: 0, objects: 0, confirmed: 0, verified: 0, invalidated: 0, unreadable: [] };
  for (const { orgId, streamId } of await deps.streams()) {
    report.streams += 1;
    const state = await foldStream(deps.transport, orgId, streamId, opts.pageSize ?? 1000);
    for (const o of await deps.listObjects(orgId, streamId)) {
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
      if (!isStored(state, o.hash) || verdict?.size !== o.size) {
        await deps.recordBlob(orgId, streamId, o.hash, o.size);
        report.confirmed += 1;
      }
    }
  }
  return report;
}

async function foldStream(transport: Transport, orgId: string, streamId: string, pageSize: number): Promise<LanguageState> {
  const snapshot = await fetchSnapshot(transport, orgId, streamId, REDUCER_VERSION);
  let after = snapshot?.serverSeq ?? 0;
  const tail: AnyEvent[] = [];
  for (;;) {
    const page = await transport.pull(orgId, streamId, after, pageSize);
    tail.push(...page);
    if (page.length < pageSize) break;
    after = page[page.length - 1]!.serverSeq!;
  }
  return snapshot ? resume(snapshot, tail) : foldLanguage(tail, emptyLanguageState());
}

/** Wire the reconciler to a service-role Supabase client and the files it checks. */
function reconcilerDeps(service: SupabaseClient, files: BlobFiles): ReconcilerDeps {
  const key = (o: BlobObject) => blobKey(o.orgId, o.streamId, o.hash, o.format);
  return {
    streams: async () => {
      const { data, error } = await service.rpc('list_streams');
      if (error) throw new Error(`list_streams: ${error.message}`);
      return ((data ?? []) as { org_id: string; stream_id: string }[]).map((r) => ({ orgId: r.org_id, streamId: r.stream_id }));
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
    download: (o) => files.get(key(o)),
    remove: (o) => files.remove(key(o)),
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
