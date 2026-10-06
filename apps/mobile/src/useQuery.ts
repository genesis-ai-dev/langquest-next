import type { PartitionQueries } from '@langquest-next/client';
import { useEffect, useRef, useState } from 'react';
import type { PartitionHandle } from './usePartition';

/**
 * Run one query against the partition's persisted rows and keep it current.
 * The query re-runs after every publication (a fold change or a commit);
 * the result replaces the previous one only when it differs, so a screen
 * whose answer did not change does not re-render for it. Screens read
 * rows through this; they no longer derive from the fold.
 */
export function useQuery<T>(
  partition: Pick<PartitionHandle, 'queries' | 'revision' | 'saving'>,
  run: (q: PartitionQueries) => Promise<T>,
  deps: unknown[],
  initial: T
): { data: T; ready: boolean } {
  const [result, setResult] = useState<{ data: T; ready: boolean }>({ data: initial, ready: false });
  const last = useRef<string | null>(null);
  const { queries, revision, saving } = partition;
  useEffect(() => {
    if (!queries) return;
    let live = true;
    run(queries).then((data) => {
      if (!live) return;
      const key = JSON.stringify(data);
      if (key === last.current) {
        setResult((r) => (r.ready ? r : { ...r, ready: true }));
        return;
      }
      last.current = key;
      setResult({ data, ready: true });
    }).catch(() => { /* disk reads can fail on some devices; the next publication retries */ });
    return () => { live = false; };
    // A publication is (revision, saving): the fold moved, or a commit
    // landed and the rows now carry it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries, revision, saving, ...deps]);
  return result;
}
