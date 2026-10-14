/**
 * A fleet of phones on simulated time, against the in-memory server
 * (docs/fleet-simulation.md).
 *
 *   npm run fleet -- --list
 *   npm run fleet -- normalDay
 *   npm run fleet -- reducerBump --passages=1200 --snapshotMinNew=50 --json=/tmp/bump.json
 *
 * Every knob a scenario lists can be set with `--name=value`. The run is
 * deterministic for a seed. CPU times are real milliseconds on this
 * machine, in Node: compare runs with each other, not with a phone.
 */
import { writeFileSync } from 'node:fs';
import type { FleetReport, Stats } from '@langquest-next/sync/src/testing';
import { SCENARIOS } from './scenarios';
import type { Knobs } from './scenarios/types';

const args = process.argv.slice(2);
const flags = new Map(args.filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.slice(2).split('=');
  return [k!, v ?? 'true'] as const;
}));
const name = args.find((a) => !a.startsWith('--'));

if (flags.has('list') || !name) {
  console.log('Scenarios (npm run fleet -- <name> [--knob=value ...] [--json=path]):\n');
  for (const s of Object.values(SCENARIOS)) {
    console.log(`  ${s.name.padEnd(18)} ${s.summary}`);
    console.log(`  ${''.padEnd(18)} ${Object.entries(s.defaults).map(([k, v]) => `--${k}=${v}`).join(' ')}\n`);
  }
  process.exit(name ? 0 : 1);
}

const scenario = SCENARIOS[name];
if (!scenario) {
  console.error(`No scenario "${name}". Try --list.`);
  process.exit(1);
}

const knobs: Knobs = { ...scenario.defaults };
for (const [k, v] of flags) {
  if (k === 'json') continue;
  if (!(k in scenario.defaults)) {
    console.error(`${name} has no knob --${k}. It takes: ${Object.keys(scenario.defaults).join(', ')}`);
    process.exit(1);
  }
  knobs[k] = Number(v);
}

const { report, findings } = await scenario.run(knobs);
print(name, knobs, report, findings);
const out = flags.get('json');
if (out) {
  writeFileSync(out, JSON.stringify({ scenario: name, knobs, findings, report }, null, 2));
  console.log(`\nFull report: ${out}`);
}
process.exit(report.errors.length > 0 || report.agreement?.agree === false || (report.audio?.lost ?? 0) > 0 ? 1 : 0);

function print(scenarioName: string, k: Knobs, r: FleetReport, f: Record<string, unknown>): void {
  const s = (x: Stats, unit: string) => `p50 ${x.p50}${unit}, p95 ${x.p95}${unit}, max ${x.max}${unit} (n ${x.n})`;
  const p = r.phones;
  console.log(`${scenarioName}  ${Object.entries(k).map(([a, b]) => `${a}=${b}`).join(' ')}`);
  console.log(`  ${r.simulated.devices} phones, ${r.simulated.days} simulated days, in ${r.realSeconds} s real (heap ${r.heapMb} MB)`);
  console.log(`  events        ${r.events.appended} appended, ${r.events.onServer} on the server`);
  console.log(`  server        ${r.server.appendCalls} append calls, ${r.server.pullCalls} pulls, ${r.server.snapshotChunkCalls} snapshot pieces, ${r.server.snapshotsTaken} snapshots taken`);
  console.log(`  syncs         ${p.syncs} runs, ${p.offlineSyncs} with no signal, ${p.syncErrors} errors`);
  console.log(`  sync CPU      ${s(p.syncCpuMs, ' ms')}`);
  console.log(`  append CPU    ${s(p.appendCpuMs, ' ms')}`);
  console.log(`  refolds       ${p.refolds}; snapshots ${JSON.stringify(p.snapshotOutcomes)}`);
  console.log(`  downloaded    ${p.mbDown} MB; ${p.pulled} events pulled; ${p.pushedDuplicates} duplicate pushes; most pending ${p.maxPending}`);
  console.log(`  reach others  ${s(p.propagationMinutes, ' min')}`);
  console.log(`  reach server  ${s(p.pushDelayMinutes, ' min')}`);
  if (r.audio) {
    const a = r.audio;
    console.log(`  audio         ${a.recorded} recorded, ${a.onServer} on the server, ${a.lost} lost; ${a.uploads} up (${a.mbUp} MB, ${a.uploadFailures} failed), ${a.downloads} down (${a.mbDown} MB, ${a.downloadFailures} failed)`);
    console.log(`  audio reaches server    ${s(a.toServerMinutes, ' min')}`);
    console.log(`  playable elsewhere      ${s(a.playableElsewhereMinutes, ' min')}`);
    console.log(`  transfer work lists     ${a.workLists} built, ${a.workListCpuSeconds} s CPU`);
  }
  if (r.agreement) {
    const a = r.agreement;
    console.log(`  agreement     ${a.agree ? 'every phone matches the server' : `MISMATCH on ${a.disagree.join(', ') || '(not caught up)'}`} after settling ${Math.round(a.settleMs / 60_000)} min`);
  }
  if (r.errors.length) console.log(`  ERRORS        ${r.errors.slice(0, 5).join(' | ')}`);
  console.log('  findings');
  for (const [key, value] of Object.entries(f)) console.log(`    ${key}: ${JSON.stringify(value)}`);
}
