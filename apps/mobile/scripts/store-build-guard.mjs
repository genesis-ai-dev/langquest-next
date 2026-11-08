#!/usr/bin/env node
// EAS runs this before it installs anything for a build (the
// `eas-build-pre-install` script in package.json). A build on the
// `production` profile is a store build, and store builds come only from the
// EAS workflow that runs on merges into main (decisions.md 156): that
// workflow passes its git ref to the build as LQ_STORE_BUILD_REF. A
// production build started any other way, by hand or from another branch,
// stops here, before it uses any build time. A `carried` build (a production
// build for a teammate to carry to a phone with no Play Store,
// docs/nearby-sync-plan.md 14.4) is held the same way. Other profiles pass.
import { fileURLToPath } from 'node:url';

/** Profiles that make a build for the field, which only the workflow on main may start (scripts/server-calls.mjs holds the same two). */
export const FIELD_PROFILES = ['production', 'carried'];

/** Why this build may not run, or null when it may. */
export function refusal(env) {
  if (!FIELD_PROFILES.includes(env.EAS_BUILD_PROFILE)) return null;
  if (env.LQ_STORE_BUILD_REF === 'refs/heads/main') return null;
  const from = env.LQ_STORE_BUILD_REF ? `from ${env.LQ_STORE_BUILD_REF}` : env.EAS_BUILD_USERNAME ? `by ${env.EAS_BUILD_USERNAME}` : 'outside the workflow';
  return (
    `A store build (profile ${env.EAS_BUILD_PROFILE}) was started ${from}. Store builds come only from the EAS workflow ` +
    'on merges into main (.eas/workflows/deploy-to-testers.yml, decisions.md 156). Merge the change into main, ' +
    'or build on the preview profile to try it.'
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const why = refusal(process.env);
  if (why) {
    console.error(why);
    process.exit(1);
  }
}
