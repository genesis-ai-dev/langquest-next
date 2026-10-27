// The job runner's bundles (docs/server-jobs.md, decisions.md 141): each
// server job the container image runs, bundled for Node 24 into
// apps/web/jobs/dist, which the Dockerfile copies and git ignores. Built
// before every deploy of the app's Worker (apps/web/package.json, build)
// and before `wrangler dev`, so the image never installs the dependency tree
// beside the service key. apps/web/worker/jobs.ts names the bundle each job
// runs.
//   npm run build:jobs
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Entry point to bundle name. */
const BUNDLES = { 'server/projections.ts': 'projections.mjs', 'server/v2.ts': 'v2.mjs', 'server/foldCanary.ts': 'canary.mjs', 'server/reconcileJob.ts': 'reconcile.mjs' };

for (const [entry, out] of Object.entries(BUNDLES)) {
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: `apps/web/jobs/dist/${out}`,
    bundle: true, platform: 'node', format: 'esm', target: 'node24',
    // CommonJS dependencies (supabase-js's) call require, which an ES module has only when given one.
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: 'warning'
  });
}
