# The carried build is rebuilt once a day when main's app code has moved on, and a carrier is told when their kept copy falls two days behind their own app

Date: 2026-11-19 · By: Carl Sauder · Status: accepted

Reason: a merge makes a carried build only when the reducer, lines or protocol
version or the Android fingerprint changes (decision 246), since those decide
whether a newcomer can join. A JavaScript-only merge reaches store phones as an
OTA update, so the carried file kept the JavaScript of the merge that first
named it. On 2026-11-19, file 59 (PR 527's merge) already lacked PR 529, and
the versions can stay the same for weeks. A newcomer installed from it can
still join and share, but runs older code until their phone first reaches the
internet. The carrier's own kept copy is older still: whatever they last
downloaded. Carl asked whether a new file is made after OTA fixes, chose a
daily refresh, and then, against Claude's first recommendation, a marker,
because without one a carrier who downloaded once keeps handing out an ever
older app until the next version change.

- **Daily refresh.** `.eas/workflows/refresh-carried.yml` runs at 08:30 GMT on
  main (EAS runs scheduled workflows on the default branch only).
  - **The check:** `scripts/carried-build.mjs --check --refresh` asks the APK
    bucket for main's file. It is due when there is none, or when the file's
    recorded app code differs from main's.
  - **App code** is `appHash`: a SHA-256 over every file under `APP_PATHS`
    (the app's code, config and assets, the packages it bundles, the
    lockfile). It is read from the files, since EAS clones one commit, and
    recorded with each file as R2 custom metadata (`app-hash`).
  - **When due:** the run builds, uploads and publishes as a merge's carried
    jobs do. `--publish` replaces a file holding other app code under a lower
    version code, keeping the name, so phones and the Worker find it as
    before.
  - **Files from before** this change carry no app code and are refreshed
    once.
  - **The build guard** is given `refs/heads/main` for a scheduled run. A run
    started by hand keeps its own ref, which the guard refuses unless it is
    main's.
  - **The version** people see is the time the check ran.
  - **Turn-taking:** it is in the `google-play` concurrency group
    (docs/decisions/2026-11-17-play-uploads-take-turns.md). A merge's deploy
    that starts meanwhile waits, about 40 minutes when a build is due and a
    few when none is; 08:30 GMT is 03:30 in the eastern United States, when
    few merges come.
- **Telling the carrier.** Native reads when the kept copy's JavaScript was
  built: `commitTime` in expo-updates' `assets/app.manifest` inside the file
  (`InstallFiles.builtAtOf`), sent as `builtMs`. The app compares it with
  `Updates.createdAt`, when the app it runs was made, whether that is an OTA
  update or the build itself. Both times come from the build servers, not the
  phone's clock.
  - **The rule** is `keptBehind`: more than `KEPT_BEHIND_MS`, two days, is
    behind. That is longer than the refresh can lag, so by then the bucket
    holds a newer file and a download never brings back the same one.
  - **Download the install file:** while online, a copy that is behind says
    "A newer install file is ready. Download it while you have internet, then
    choose it." Download in the browser is the main button again, with
    Choose the downloaded file beside it.
  - **Sync's Ready for offline:** the item stays ready, not amber, since the
    old copy still lets a new phone join, and adds the same line with a link.
  - **Offline, or with either time unknown,** nothing is said.
- **What it costs.** At most one more Android build, Play draft upload and
  version code a day, on days main's app code changed. A phone installed from
  a refreshed file has a higher version code than the store build of the same
  native code, which it does not need, and the next store build numbers
  higher still.
- **What it does not cover.**
  - A phone that keeps no copy (Android 9 or older, or a build from before
    Give the app) knows only the file's name, so it is never told.
  - If the refresh fails for two days running, the line can show while the
    bucket's file is no newer than the carrier's.
  - A carrier who stays offline hands out what they have.

Making a file on every app-code merge was weighed and turned down: it costs a
build per merge for at most a day's freshness, and each would queue the next
merge's deploy behind it. A marker in the file's name was turned down too: it
would change the name every phone asks for, and a file for the same versions
already counts as right (docs/decisions/2026-11-18-carried-file-matches-by-versions.md),
which the line keeps: an older copy is still right, only not the newest.

Reverse if: any of these holds.

- the daily build or its Play upload often fails, or holds up merges' deploys enough to matter;
- carriers ignore the line, or find downloading again too costly on their connection;
- newcomers' first launch online shows the OTA update closes the gap well enough on its own.
