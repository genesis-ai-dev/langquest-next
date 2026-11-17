# 156. Store builds come only from the EAS workflow on merges into main

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: Android build 24 and iPhone build 41 were built by hand on
2026-10-20 from code of 2026-10-01, and build 24 reached Play internal
testing in place of build 23. Testers saw a blank screen, most likely
because its code called a database function that the server had not had
since 2026-10-06. A
store build has to be made from main, where the checks ran, by the pipeline
that the rest of the release plan builds on. So the ways to make or upload a
store build by hand are gone: `npm run android:play` (an `eas build` on the
`production` profile with `--auto-submit`), `npm run ship -- --prod` (which
published OTA updates and iOS builds on production), and
`apps/mobile/scripts/testflight.sh` (an iOS build on a Mac, uploaded to
TestFlight with altool). `npm run ship` now works on `preview` only, and
says so when it is given `--prod`. A person can still type `eas build
--profile production`, so an EAS build hook stops that build:
`apps/mobile/scripts/store-build-guard.mjs`, the app's
`eas-build-pre-install` script, refuses a `production` build unless
`LQ_STORE_BUILD_REF` is `refs/heads/main`, and only the build jobs of
`.eas/workflows/deploy-to-testers.yml`, which runs on merges into main, set
it. `scripts/storeBuildGuard.test.ts` holds the guard, the hook, and the
two build jobs that pass the ref. `apps/mobile/scripts/ship-eas-ipa.sh`
stays: it uploads a build that EAS already made, and EAS now makes store
builds from main only.
Reverse if: a store build has to be made from somewhere else, such as a
release branch for a build that cannot wait (then let the workflow pass that
branch's ref and add it to the guard), or EAS gives a setting that limits a
build profile to a workflow, which would do the guard's job without a hook.
