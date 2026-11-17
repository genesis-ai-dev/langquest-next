# 154. The app tells people when a newer version is in the store, and below the minimum version it stops syncing until they update

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: Expo does not tell people that a new build is in the stores, and in
LangQuest v2 a database flag went up before the store had approved the
build, so people were sent to an update that did not exist yet. Now the
server records a version only once it is live (`public.app_releases`,
migration `20261022200000_app_releases.sql`): the Worker's ten-minute cron,
once an hour, reads the live App Store version from Apple's public lookup
and the live Google Play version from Play's public app page, which list a
version only once people can download it, and writes each with
`record_app_release` (`apps/web/worker/storeReleases.ts`). The app reads
`app_versions()` (`src/server/appVersions.ts`) when someone is signed in, at
most once an hour, and keeps the last answer on the phone
(`src/appVersion/useAppVersion.ts`, rules in `appVersionModel.ts`):
- On an older version than the newest live one, a bar says "New version
  available" with Update, which opens the store page, and a close button
  that hides the bar until a newer version comes out.
- Below the lowest version that may still sync (`server_config`
  `min_version_ios` and `min_version_android`, '0' today, raised only on
  purpose), the phone sends its waiting work first, then stops: every
  stream's transport still sends (`append`, and recordings through their own
  transport), and refuses everything that downloads other people's changes
  as the server does for a client too old (LQ001,
  `src/appVersion/syncGate.ts`). The sync client sends before it downloads,
  so someone back after months offline gets their work to the team even if
  they never update. Caleb chose this (2026-10-22) over stopping all sync
  at once. A send that fails, for example because a server call that the old
  build uses is gone, throws instead of refusing the events, so the work
  stays on the phone marked to send (PLAN.md invariant 1) and goes after the
  update. The whole screen says "Please update the app" with the same
  button; Keep working closes it for that launch, and Account's "Update the
  app to sync." stays.
Versions are compared as numbers, part by part: every store build has a
higher version than the one before (the release pipeline's production
review change gives each the time of its merge), and 1.0.0 is older than all
of them. The app reads its own version with `expo-application`, which every
build already had through `expo-notifications`, so this code ships as an OTA
update. A browser always runs the newest version and is never told.

Android works the same way. Google Play's public app page shows the version
that people can download now, and only once Google has approved it; the
check reads it as update-check libraries such as react-native-version-check
do. Google's Play Developer API cannot say this: it reports a production
release as completed from the moment it is sent, before review
(issuetracker.google.com/208842993). Google's In-App Updates library would
tell the phone itself, but it sends Google device details and the app
version whether diagnostics is on or off, which may change Data safety
answers (`docs/play-store-declarations.md`), so it is not used. If Google
changes the page and the version cannot be found, nothing is recorded and
the cron's job run says so; the app never says an update is there when it
is not. This is beyond the partner demo, which has no update prompt.
Reverse if: people dismiss the bar and stay on old versions long enough to
matter (then show it again after some days), or the In-App Updates question
is settled, or Google's page stops showing the version (then Android asks
the phone, with In-App Updates).

Amended (2026-10-28, Caleb Koster): after Keep working, the app no longer
looks as if the server were at fault. The sync standing has its own
`tooOld` (`sync/syncStanding.ts`, after a refused account and before
refused events): the header's cloud turns amber with a down arrow ("Update
to receive"), and the Sync screen offers Update, which opens the store
page, where Sync now was. Its words say the person's own work still goes
out only below the minimum version; a server that refuses the app's
protocol (LQ001) takes nothing, and it says to update. From the UI audit
Caleb asked to have fixed (findings 24 and 119).

Amended (2026-11-08, Carl Sauder): LQ001 takes nothing per caller, not per
author, so a below-gate build's signed work goes up when a current phone
delivers it, as it already does when its author updates, because offline
teams and lost phones are why delivery exists (docs/nearby-sync-plan.md
section 6). The relay's `p_client_version` is the delivering phone's: LQ001
from the relay is a whole-request answer (426) that the phone reads as
`ClientTooOldError`, leaving every row nearby. Delivery joins `SENDS` in
`syncGate.ts`, so a carrier below the store minimum still delivers, as it
still sends its own work. If a per-build stop is ever needed it gets its own
setting, not `min_client_version`. Caleb should see this, since 154 is his
entry.
