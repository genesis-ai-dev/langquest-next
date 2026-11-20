# 234. A required `android-native` job compiles, tests and lints the nearby module when it, the app's package.json or the lockfile changes

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: `guardrails.yml` had no Android step, so `build_android` after a
merge would have been the first compile of the module's Kotlin, and a
failure there stalls every Android merge (plan section 7). Carl's answer 3
(2026-11-06): a new required job scoped to the module; answer 22
(2026-11-07): also on `apps/mobile/package.json` and the root lockfile, which
can move `expo-modules-core`, the module's compile dependency. The job runs
`expo prebuild -p android --no-install`, then `./gradlew
:nearby-link:compileReleaseKotlin :nearby-link:testDebugUnitTest
:nearby-link:lintDebug`, and is in `gate.needs`. In `scripts/ci-scope.mjs`
two rules go before the dependency rule, which matches any `package.json`:
the module's files run `[...APP, 'android-native']`, and the app's
`package.json` and the lockfile `[...SHARED, 'android-native']`. `SHARED`
holds the three jobs that shared code, other dependencies and unmatched files
ran before, so a change to core or a script compiles no Kotlin. A nightly
run, a manual run and a scope error run every job, so anything else that
breaks the Kotlin (`app.json`, the workflow) shows by the next night. This
machine has no JDK or Android SDK, so the job runs only in CI; whether
GitHub's runner has a suitable SDK was unconfirmed until its first run. The
module's JUnit tests read their vectors with a parser of their own, so
`android.jar`'s `org.json` stub cannot shadow it. 150 is amended.
Reverse if: the module leaves the repository, or the job's run time holds up
pull requests that never touch it.
