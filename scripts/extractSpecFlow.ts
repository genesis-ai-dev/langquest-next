/**
 * Vendors the UX spec's flow machine (ng-langquest-ux/src/flow.ts) into
 * apps/mobile/test/spec-flow.json so `specParity.test.ts` can prove the app
 * follows the spec without a checkout of the spec repo in CI.
 *
 *   npx tsx scripts/extractSpecFlow.ts ../ng-langquest-ux
 *
 * Re-run after every spec change and commit the JSON with the app change
 * that follows it. The diff of the JSON is the spec change log.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const specRoot = process.argv[2];
if (!specRoot) {
  console.error('usage: tsx scripts/extractSpecFlow.ts <path to ng-langquest-ux checkout>');
  process.exit(2);
}

const flow = (await import(resolve(specRoot, 'src/flow.ts'))) as {
  FLOW_EDGES: { from: string; to: string; label: string; mode?: string; when?: string }[];
  FLOW_GROUPS: { id: string; screens: { id: string }[] }[];
};

const screens = flow.FLOW_GROUPS.flatMap((g) => g.screens.map((s) => s.id)).filter((s) => s !== 'home_hub');
const edges = flow.FLOW_EDGES.map((e) => ({
  from: e.from,
  to: e.to,
  mode: e.mode ?? 'push',
  when: e.when ?? null,
  label: e.label
}));

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/mobile/test/spec-flow.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ screens, edges }, null, 1) + '\n');
console.log(`wrote ${edges.length} edges and ${screens.length} screens to ${out}`);
