import { REDUCER_VERSION, emptyState, fold, isStored, resume, type AnyEvent, type PartitionState } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseTransport } from './supabaseTransport';
import { fetchSnapshot } from './snapshotFetch';
import type { Transport } from './types';

export interface BlobObject {
  orgId: string;
  partitionId: string;
  hash: string;
  format: string;
  size: number;
}

/** Everything the reconciler touches, so it can run against fakes. */
export interface ReconcilerDeps {
  partitions(): Promise<{ orgId: string; partitionId: string }[]>;
  transport: Transport;
  listObjects(orgId: string, partitionId: string): Promise<BlobObject[]>;
  download(o: BlobObject): Promise<Uint8Array>;
  remove(o: BlobObject): Promise<void>;
  recordBlob(orgId: string, partitionId: string, hash: string, size: number): Promise<void>;
  invalidateBlob(orgId: string, partitionId: string, hash: string, reason: string): Promise<void>;
  /** SHA-256 hex. */
  digest(bytes: Uint8Array): Promise<string>;
}

export interface ReconcileReport {
  partitions: number;
  objects: number;
  confirmed: number;
  verified: number;
  invalidated: number;
  /** Objects whose bytes could not be fetched this pass: left alone, listed here. */
  unreadable: string[];
}

/**
 * The server's own check on the bucket, independent of the storage trigger.
 *
 * - Every object under org/partition/ that the log does not consider stored
 *   gets a BlobStored confirmation (heals a trigger that never fired).
 * - With `verify`, each object's bytes are hashed; a mismatch with its name
 *   removes the object and appends BlobInvalidated, so devices holding the
 *   real file upload it again and nobody downloads garbage.
 *
 * Idempotent: a second pass over an unchanged bucket does nothing.
 */
export async function reconcileBlobs(deps: ReconcilerDeps, opts: { verify: boolean; pageSize?: number }): Promise<ReconcileReport> {
  const report: ReconcileReport = { partitions: 0, objects: 0, confirmed: 0, verified: 0, invalidated: 0, unreadable: [] };
  for (const { orgId, partitionId } of await deps.partitions()) {
    report.partitions += 1;
    const state = await foldPartition(deps.transport, orgId, partitionId, opts.pageSize ?? 1000);
    for (const o of await deps.listObjects(orgId, partitionId)) {
      report.objects += 1;
      if (opts.verify) {
        // A failed fetch is not evidence of corruption. Skip, report, retry next pass.
        let bytes: Uint8Array;
        try {
          bytes = await deps.download(o);
        } catch (err) {
          report.unreadable.push(`${orgId}/${partitionId}/${o.hash}: ${(err as Error).message}`);
          continue;
        }
        report.verified += 1;
        const actual = await deps.digest(bytes);
        if (actual !== o.hash) {
          await deps.remove(o);
          await deps.invalidateBlob(orgId, partitionId, o.hash, `hash mismatch: bytes hash to ${actual}`);
          report.invalidated += 1;
          continue;
        }
      }
      const verdict = state.blobs[o.hash];
      if (!isStored(state, o.hash) || verdict?.size !== o.size) {
        await deps.recordBlob(orgId, partitionId, o.hash, o.size);
        report.confirmed += 1;
      }
    }
  }
  return report;
}

async function foldPartition(transport: Transport, orgId: string, partitionId: string, pageSize: number): Promise<PartitionState> {
  const snapshot = await fetchSnapshot(transport, orgId, partitionId, REDUCER_VERSION);
  let after = snapshot?.serverSeq ?? 0;
  const tail: AnyEvent[] = [];
  for (;;) {
    const page = await transport.pull(orgId, partitionId, after, pageSize);
    tail.push(...page);
    if (page.length < pageSize) break;
    after = page[page.length - 1]!.serverSeq!;
  }
  return snapshot ? resume(snapshot, tail) : fold(tail, emptyState());
}

/** Wire the reconciler to a service-role Supabase client. */
export function supabaseReconcilerDeps(service: SupabaseClient, bucket = 'blobs'): ReconcilerDeps {
  const storage = service.storage.from(bucket);
  const path = (o: BlobObject) => `${o.orgId}/${o.partitionId}/${o.hash}.${o.format}`;
  return {
    partitions: async () => {
      const { data, error } = await service.rpc('list_partitions');
      if (error) throw new Error(`list_partitions: ${error.message}`);
      return ((data ?? []) as { org_id: string; partition_id: string }[]).map((r) => ({ orgId: r.org_id, partitionId: r.partition_id }));
    },
    transport: new SupabaseTransport(service),
    listObjects: async (orgId, partitionId) => {
      const out: BlobObject[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await storage.list(`${orgId}/${partitionId}`, { limit: 1000, offset });
        if (error) throw new Error(`list ${orgId}/${partitionId}: ${error.message}`);
        for (const f of data ?? []) {
          const [hash, format] = f.name.split('.');
          if (!hash || !format || !f.id) continue; // folders have no id
          out.push({ orgId, partitionId, hash, format, size: Number((f.metadata as { size?: number } | null)?.size ?? 0) });
        }
        if (!data || data.length < 1000) return out;
      }
    },
    download: async (o) => {
      const { data, error } = await storage.download(path(o));
      if (error || !data) throw new Error(`download ${path(o)}: ${error?.message ?? 'no data'}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    remove: async (o) => {
      const { error } = await storage.remove([path(o)]);
      if (error) throw new Error(`remove ${path(o)}: ${error.message}`);
    },
    recordBlob: async (orgId, partitionId, hash, size) => {
      const { error } = await service.rpc('record_blob', { p_org: orgId, p_partition: partitionId, p_hash: hash, p_size: size });
      if (error) throw new Error(`record_blob: ${error.message}`);
    },
    invalidateBlob: async (orgId, partitionId, hash, reason) => {
      const { error } = await service.rpc('invalidate_blob', { p_org: orgId, p_partition: partitionId, p_hash: hash, p_reason: reason });
      if (error) throw new Error(`invalidate_blob: ${error.message}`);
    },
    digest: async (bytes) => {
      const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  };
}

export async function runBlobReconciler(service: SupabaseClient, opts: { verify: boolean }): Promise<ReconcileReport> {
  return reconcileBlobs(supabaseReconcilerDeps(service), opts);
}
