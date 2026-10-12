/**
 * The fleet baselines (docs/fleet-baselines.md): every scenario at a few
 * sizes, each in its own process so one run's heap cannot slow the next,
 * then the tables the doc holds. Run it before and after a performance
 * change and compare.
 *
 *   npm run fleet:baselines
 *   npm run fleet:baselines -- --only=slow --out=/tmp/fleet-after
 *
 * Counts (events, syncs, snapshots, minutes) are the same on every run for
 * a seed; real seconds and CPU depend on the machine and what else it does.
 * Runs ending in `-oldRule` use the snapshot rule from before decision 88,
 * to keep that comparison.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FleetReport } from '@langquest-next/client/src/testing';

export const BASELINES: [name: string, args: string][] = [
  ['normalDay-default', 'normalDay'],
  ['normalDay-45', 'normalDay --passages=1000 --translators=27 --reviewers=17'],
  ['normalDay-131', 'normalDay --passages=3000 --translators=80 --reviewers=50'],
  ['normalDay-audio', 'normalDay --audio=1'],
  ['village-small', 'villageReconnect --passages=300 --translators=5 --reviewers=3 --offlineDays=7'],
  ['village-default', 'villageReconnect'],
  ['village-large', 'villageReconnect --passages=3000 --translators=40 --reviewers=25 --offlineDays=28'],
  ['village-audio', 'villageReconnect --audio=1'],
  ['bump-default', 'reducerBump'],
  ['bump-oldRule', 'reducerBump --snapshotMinNew=1 --snapshotMaxAgeMin=0 --snapshotRetainHours=0'],
  ['bump-slow5KBps', 'reducerBump --slowKBps=5 --chunkKB=32'],
  ['bump-slow5KBps-oldRule', 'reducerBump --slowKBps=5 --chunkKB=32 --snapshotMinNew=1 --snapshotMaxAgeMin=0 --snapshotRetainHours=0'],
  ['bump-large', 'reducerBump --passages=3000 --translators=40 --reviewers=25'],
  ['bump-large-oldRule', 'reducerBump --passages=3000 --translators=40 --reviewers=25 --snapshotMinNew=1 --snapshotMaxAgeMin=0 --snapshotRetainHours=0'],
  ['slow-default', 'slowLink'],
  ['slow-oldRule', 'slowLink --snapshotMinNew=1 --snapshotMaxAgeMin=0 --snapshotRetainHours=0'],
  ['slow-8KBps-256KB', 'slowLink --joinerKBps=8 --chunkKB=256'],
  ['slow-large', 'slowLink --passages=3000 --translators=40 --reviewers=25 --joiners=5'],
  ['slow-large-oldRule', 'slowLink --passages=3000 --translators=40 --reviewers=25 --joiners=5 --snapshotMinNew=1 --snapshotMaxAgeMin=0 --snapshotRetainHours=0'],
  ['refold-default', 'refoldTriggers'],
  ['refold-large', 'refoldTriggers --passages=1200 --translators=20 --reviewers=12']
];

interface Result {
  scenario: string;
  knobs: Record<string, number>;
  findings: Record<string, any>;
  report: FleetReport;
}

const flags = new Map(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.slice(2).split('=');
  return [k!, v ?? 'true'] as const;
}));
const out = flags.get('out') ?? join(tmpdir(), `fleet-baselines-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
const only = flags.get('only');
mkdirSync(out, { recursive: true });

const results: [string, Result][] = [];
for (const [name, args] of BASELINES) {
  if (only && !name.startsWith(only)) continue;
  const file = join(out, `${name}.json`);
  process.stderr.write(`${name} ... `);
  const run = spawnSync(process.execPath, ['--max-old-space-size=16384', '--import', 'tsx', 'scripts/fleet/run.ts', ...args.split(' '), `--json=${file}`], { encoding: 'utf8' });
  if (!existsSync(file)) {
    process.stderr.write(`failed (exit ${run.status})\n${run.stderr}\n`);
    continue;
  }
  const r = JSON.parse(readFileSync(file, 'utf8')) as Result;
  process.stderr.write(`${r.report.realSeconds} s${run.status === 0 ? '' : ` (exit ${run.status}: disagreement or errors)`}\n`);
  results.push([name, r]);
}

const tables = render(results);
writeFileSync(join(out, 'tables.md'), tables);
console.log(tables);
process.stderr.write(`\nReports and tables: ${out}\n`);

function render(all: [string, Result][]): string {
  const fmt = (n: unknown) => (n === null || n === undefined ? '—' : typeof n === 'number' ? (Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-US') : String(+n.toFixed(2))) : String(n));
  const row = (cells: unknown[]) => `| ${cells.map(fmt).join(' | ')} |`;
  const head = (cols: string[]) => `${row(cols)}\n|${cols.map(() => ' --- ').join('|')}|`;
  const common = ['Run', 'Phones', 'Passages', 'Sim days', 'Real s', 'Heap MB', 'Events', 'Syncs', 'Sync CPU s', 'Sync CPU p95 ms', 'Refolds', 'MB down', 'Reach server p95 min', 'Reach others p95 min', 'Agree'];
  const commonRow = (name: string, { report: r }: Result) => row([
    name, r.simulated.devices, r.simulated.passages, r.simulated.days, r.realSeconds, Math.round(r.heapMb), r.events.onServer,
    r.phones.syncs, +(r.phones.syncCpuMs.total / 1000).toFixed(1), r.phones.syncCpuMs.p95, r.phones.refolds, r.phones.mbDown,
    r.phones.pushDelayMinutes.p95, r.phones.propagationMinutes.p95, r.agreement?.agree ? 'yes' : 'NO'
  ]);
  let md = '';
  const withAudio = all.filter(([, r]) => r.report.audio);
  if (withAudio.length) {
    md += `\n### Audio (runs with --audio=1)\n\n${head(['Run', 'Recorded', 'Lost', 'MB up', 'MB down', 'Failed transfers', 'To server p50 min', 'To server p95 min', 'Playable elsewhere p50 min', 'Playable elsewhere p95 min', 'Work lists', 'Work-list CPU s'])}\n`;
    md += withAudio.map(([n, { report: { audio: a } }]) => row([n, a!.recorded, a!.lost, a!.mbUp, a!.mbDown, a!.uploadFailures + a!.downloadFailures,
      a!.toServerMinutes.p50, a!.toServerMinutes.p95, a!.playableElsewhereMinutes.p50, a!.playableElsewhereMinutes.p95, a!.workLists, a!.workListCpuSeconds])).join('\n') + '\n';
  }
  for (const scenario of ['normalDay', 'villageReconnect', 'reducerBump', 'slowLink', 'refoldTriggers']) {
    const runs = all.filter(([, r]) => r.scenario === scenario);
    if (runs.length === 0) continue;
    md += `\n### ${scenario}\n\n${head(common)}\n${runs.map(([n, r]) => commonRow(n, r)).join('\n')}\n`;
    if (scenario === 'villageReconnect') {
      md += `\n${head(['Run', 'Backlog at reconnect', 'Minutes to drain', 'Append calls to drain', 'Sync CPU while draining, total ms', 'p95 ms', 'max ms'])}\n`;
      md += runs.map(([n, { findings: f }]) => row([n, f.backlogAtReconnect, f.drainMinutes, f.appendCallsToDrain, f.syncCpuMsWhileDraining.total, f.syncCpuMsWhileDraining.p95, f.syncCpuMsWhileDraining.max])).join('\n') + '\n';
    }
    if (scenario === 'reducerBump') {
      md += `\n${head(['Run', 'Cold starts', 'Never caught up', 'Worst minutes', 'Snapshots ok', 'Snapshots stale', 'Snapshot pieces fetched', 'Snapshots taken'])}\n`;
      md += runs.map(([n, { findings: f, report: r }]) => row([n, f.coldStarts, f.neverCaughtUp, f.worstMinutes, r.phones.snapshotOutcomes.ok ?? 0, r.phones.snapshotOutcomes.stale ?? 0, r.server.snapshotChunkCalls, r.server.snapshotsTaken])).join('\n') + '\n';
    }
    if (scenario === 'slowLink') {
      md += `\n${head(['Run', 'Snapshot KB at join', 'Joiner minutes', 'Joiner MB down', 'Joiner snapshot outcomes', 'Snapshots taken'])}\n`;
      md += runs.map(([n, { findings: f, report: r }]) => {
        const js = f.joiners as { minutes: number | null; mbDown: number; snapshot: string[] }[];
        return row([n, f.snapshotKBWhenJoining, js.map((x) => x.minutes ?? 'never').join(', '), js.map((x) => x.mbDown).join(', '), js.map((x) => x.snapshot.join('+') || 'none').join(', '), r.server.snapshotsTaken]);
      }).join('\n') + '\n';
    }
    if (scenario === 'refoldTriggers') {
      md += `\n${head(['Run', 'Hours unlisted', 'Refolds while unlisted', 'Worst phone', 'Redactions', 'Refolds after listing', 'Per phone', 'Sync CPU after listing, ms', 'Empty snapshot lookups'])}\n`;
      md += runs.map(([n, { findings: f, report: r }]) => row([n, f.whileUnlisted.hours, f.whileUnlisted.refolds, f.whileUnlisted.worstPhone, f.afterListing.redactions, f.afterListing.refolds, f.afterListing.perPhone, f.afterListing.syncCpuMsTotal, r.phones.snapshotOutcomes.none ?? 0])).join('\n') + '\n';
    }
  }
  return md;
}
