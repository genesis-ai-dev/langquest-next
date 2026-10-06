// What a diagnostics report points at (docs/diagnostics.md, "Reading a
// report"). Pure, so the thresholds are tested and a human, the CLI and
// Claude all read the same hypotheses off the same numbers.

export interface TransferTotals {
  count?: number; bytes?: number; ms?: number; maxMs?: number;
  signMs?: number; fetchMs?: number; verifyMs?: number;
  failOffline?: number; failHttp4xx?: number; failHttp5xx?: number; failHash?: number; failDisk?: number; failOther?: number;
}

export interface InstallSummary {
  profileId: string;
  context: Record<string, string>;
  lastSeen: string;
  clockAheadS: number | null;
  sync: null | {
    count: number; p50Ms: number; p95Ms: number; pushNetMs: number | null; pullNetMs: number | null; applyMs: number | null;
    pages: number | null; pulled: number | null; maxPending: number | null; maxOfflineMs: number | null; outcomes: Record<string, number> | null;
  };
  transfer: null | Partial<Record<'up' | 'down', TransferTotals>>;
  load: null | { count: number; p50Ms: number; p95Ms: number; maxEvents: number };
  snapshots: null | { at: string; outcome: string; ms?: number; chunks?: number; resumedChunks?: number; bytes?: number }[];
  device: null | { freeDiskMb?: number; totalDiskMb?: number; blobCacheMb?: number; blobsWanted?: number; at: string };
  errors: null | { name: string; where: string; count: number; lastErrorId: string; lastAt: string }[];
  releases: null | { updateId: string | null; from: string; to: string; records: number }[];
}

export interface LanguageHealth {
  events: { events: number; maxSeq: number; events7d: number; lastEventAt: string | null };
  reducerVersion: number;
  snapshots: { reducerVersion: number; seq: number; createdAt: string; tail: number; bytes: number | null }[];
  blobs: { count: number; bytes: number; maxBytes: number };
  roles: Record<string, number>;
}

export interface Member {
  profile_id: string;
  roles: string;
  devices: string[] | null;
  last_event_at: string | null;
  installs: string[] | null;
  last_diag_at: string | null;
}

export interface RpcStat { rpc: string; calls: number; mean_ms: number; max_ms: number; total_s: number; rows_per_call: number }

export interface Signal {
  level: 'problem' | 'watch' | 'info';
  /** Install the signal is about, or null for the language or the server. */
  install: string | null;
  text: string;
}

const KB = 1024;
const MB = 1024 * KB;

/** Bytes per second over the time spent on the network (falls back to whole-transfer time). */
export function throughput(t: TransferTotals | undefined): number | null {
  if (!t?.bytes) return null;
  const ms = t.fetchMs || t.ms;
  return ms ? (t.bytes * 1000) / ms : null;
}

function kbps(bytesPerSecond: number): string {
  return `${(bytesPerSecond / KB).toFixed(1)} KB/s`;
}

function secs(ms: number): string {
  return ms >= 120_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 1000).toFixed(1)} s`;
}

export function signals(health: LanguageHealth, members: Member[], summary: Record<string, InstallSummary>, rpc: RpcStat[]): Signal[] {
  const out: Signal[] = [];
  const add = (level: Signal['level'], install: string | null, text: string) => out.push({ level, install, text });

  // The language's stream as a cold phone meets it.
  const current = health.snapshots.find((s) => s.reducerVersion === health.reducerVersion);
  if (!current && health.events.events > 2000) {
    add('problem', null, `No snapshot for reducer ${health.reducerVersion}: a new phone folds all ${health.events.events} events from the log. Check the snapshot worker (npm run snapshot).`);
  } else if (current && current.tail > 5000) {
    add('watch', null, `The snapshot is ${current.tail} events behind the log; a new phone pulls and folds those one page at a time.`);
  }
  if (current?.bytes && current.bytes > 20 * MB) add('watch', null, `The snapshot is ${(current.bytes / MB).toFixed(1)} MB of JSON; parsing it can take seconds on a slow phone.`);

  for (const [install, s] of Object.entries(summary)) {
    const down = s.transfer?.down;
    const rate = throughput(down);
    if (down && rate !== null && rate < 20 * KB) add('problem', install, `Downloads ran at ${kbps(rate)} on the network (${down.count} files, ${((down.bytes ?? 0) / MB).toFixed(1)} MB): a slow link.`);
    if (down?.verifyMs && down.fetchMs && down.verifyMs > down.fetchMs) {
      add('problem', install, `Checking downloads on the phone (read + hash) took ${secs(down.verifyMs)} against ${secs(down.fetchMs)} on the network: the phone, not the link, is the bottleneck.`);
    }
    for (const [dir, t] of Object.entries(s.transfer ?? {}) as ['up' | 'down', TransferTotals][]) {
      const failed = (t.failOffline ?? 0) + (t.failHttp4xx ?? 0) + (t.failHttp5xx ?? 0) + (t.failHash ?? 0) + (t.failDisk ?? 0) + (t.failOther ?? 0);
      if (!failed) continue;
      const parts = Object.entries({ 'link dropped': t.failOffline, 'refused (4xx)': t.failHttp4xx, 'server error (5xx)': t.failHttp5xx, 'hash mismatch': t.failHash, 'disk': t.failDisk, 'other': t.failOther })
        .filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ');
      add(failed / (t.count ?? failed) > 0.2 ? 'problem' : 'watch', install, `${failed} of ${t.count} ${dir === 'down' ? 'downloads' : 'uploads'} failed: ${parts}.`);
    }
    if (s.sync) {
      const net = (s.sync.pullNetMs ?? 0) + (s.sync.pushNetMs ?? 0);
      if ((s.sync.applyMs ?? 0) > 10_000 && (s.sync.applyMs ?? 0) > 1.5 * net) {
        add('problem', install, `Sync spent ${secs(s.sync.applyMs ?? 0)} folding and writing on the phone against ${secs(net)} waiting on the network: phone-bound.`);
      } else if (net > 60_000 && net > 1.5 * (s.sync.applyMs ?? 0)) {
        add('watch', install, `Sync spent ${secs(net)} waiting on the network over ${s.sync.pages ?? '?'} pages: link-bound.`);
      }
      if (s.sync.p95Ms > 30_000) add('watch', install, `Slowest syncs (p95) take ${secs(s.sync.p95Ms)}.`);
      for (const bad of ['refused', 'too_old', 'error'] as const) {
        const n = s.sync.outcomes?.[bad];
        if (n) add('problem', install, `${n} sync${n === 1 ? '' : 's'} ended ${bad === 'too_old' ? 'with "app too old" (LQ001)' : bad === 'refused' ? 'refused: not a member or not allowed' : 'with an unexpected error'}.`);
      }
      if ((s.sync.maxOfflineMs ?? 0) > 24 * 3_600_000) add('info', install, `Longest time offline: ${secs(s.sync.maxOfflineMs ?? 0)}.`);
      if ((s.sync.maxPending ?? 0) > 1000) add('watch', install, `Up to ${s.sync.maxPending} events waited to be pushed.`);
    }
    if (s.load && s.load.p95Ms > 5000) add('watch', install, `Opening the language takes ${secs(s.load.p95Ms)} (p95) to fold up to ${s.load.maxEvents} local events.`);
    for (const snap of s.snapshots ?? []) {
      if (snap.outcome === 'none') { add('problem', install, `At ${snap.at} this phone found no snapshot and folded the log from the start.`); break; }
    }
    const resumed = (s.snapshots ?? []).filter((x) => (x.resumedChunks ?? 0) > 0).length;
    if (resumed) add('info', install, `A snapshot download resumed after a dropped link ${resumed} time${resumed === 1 ? '' : 's'}.`);
    if (s.device?.freeDiskMb !== undefined && s.device.freeDiskMb < 500) add('problem', install, `Only ${s.device.freeDiskMb} MB free on the phone.`);
    if ((s.clockAheadS ?? 0) > 300) add('watch', install, `The phone's clock runs about ${Math.round((s.clockAheadS ?? 0) / 60)} min ahead of the server.`);
    for (const e of s.errors ?? []) add('problem', install, `${e.count}× ${e.name} at "${e.where}" (latest ${e.lastErrorId}, ${e.lastAt}).`);
    const updates = new Set((s.releases ?? []).map((r) => r.updateId));
    if (updates.size > 1) add('info', install, `Ran ${updates.size} app updates in the window; compare before and after.`);
  }

  const heard = new Set(Object.values(summary).map((s) => s.profileId));
  for (const m of members) {
    if (heard.has(m.profile_id)) continue;
    if (!m.installs?.length) {
      add('watch', null, `Member ${m.profile_id} (${m.roles}) has never delivered diagnostics: the phone has not synced since installing this build, is on an older build, or has diagnostics off. Last event pushed here: ${m.last_event_at ?? 'never'}.`);
    } else {
      add('info', null, `Member ${m.profile_id} (${m.roles}) delivered diagnostics (${m.last_diag_at}) but none about this language in the window.`);
    }
  }

  for (const r of rpc) {
    if (r.mean_ms > 500) add('problem', null, `Server: ${r.rpc} averages ${r.mean_ms} ms over ${r.calls} calls (max ${r.max_ms} ms), across all orgs.`);
  }

  const rank = { problem: 0, watch: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
