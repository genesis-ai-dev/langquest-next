# 157. New builds go to production review on their own, and each is public as soon as Google or Apple approves it

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: a person promoted each Android build from internal testing to
production, and submitted and released each iPhone build by hand, so a new
build reached people only when someone remembered, and builds were sent
from the wrong place (decision 45 sent Android builds to internal testing
only). Now every new build that a merge into main makes
(`.eas/workflows/deploy-to-testers.yml`) goes to production review, and is
public on the day that the store approves it, with no staged rollout:
- Android: `eas.json` submits to the `production` track with
  `releaseStatus: completed`. A newer build replaces the release that waits
  for review, which is how Play treats a new release on a track. Managed
  publishing stays off in Play Console, so an approved build goes public at
  once. Play takes a version code only once, so a build no longer goes to
  internal testing too; internal testers get it with everyone else.
- iPhone: the build goes to TestFlight as before, and then
  `scripts/app-store-review.mjs` sends it to App Review with release on
  approval. Apple reviews one version at a time, and a version taken out of
  review loses its place in line, so the script never cancels a review or
  changes the build of a version in review: while a review is waiting or
  under way, or a version is approved and not yet out (pending developer or
  Apple release, or processing for the App Store), the build waits in
  TestFlight and is tried again on the next run. A version not yet released
  that can still change (a rejected 1.0) takes the newest build and its
  version number, since Apple keeps one unreleased version at a time.
  `.eas/workflows/app-store-review.yml` runs the same script every hour and
  sends only the newest waiting build once the review ends; a rejected
  version is sent again with the newest build. It fills in "What's New"
  where it is empty ("Bug fixes and improvements.").
- Apple takes one App Store version per version number, so every build
  that goes to review needs a higher one. `apps/mobile/app.config.js` sets
  the version of each store build from the time of the merge commit, which
  the workflow passes as `LQ_STORE_VERSION_TIME`: 2026-10-22T18:30:00Z is
  2026.1022.1830. Other builds keep `app.json`'s 1.0.0. The native
  fingerprint leaves the version out (`apps/mobile/fingerprint.config.js`),
  so a new version number alone never asks for a rebuild. EAS clones only
  the latest commit for a build, so a count of commits was not possible.
The App Store step needs an App Store Connect API key with the App Manager
role, kept as the EAS production secrets `ASC_KEY_ID`, `ASC_ISSUER_ID` and
`ASC_PRIVATE_KEY`; EAS's own submit key only uploads to TestFlight. Until
that key is there, the step says "no App Store Connect key yet" and
succeeds, so iPhone builds stop at TestFlight for a person to send to
review, as before, and the pipeline stays green; Android goes to production
review either way. The
Android step needs the Play service account that EAS submits with to hold
"Release to production, exclude devices, and use Play App Signing".
Amends 45: Android builds go to production review, not internal testing.
Reverse if: a build that passed review hurts people often enough that a
staged rollout or a wait in internal testing is worth the delay (then send
to internal testing first and promote after a set time), or Apple starts
taking a newer build into a version under review without losing its place.

Amended (2026-11-02, Caleb Koster; LAN-209): the App Store step had never
run, as its key was never made, and it would have stopped at the first
rejection: Apple refuses a new review submission while a rejected one is
open, and a rejection usually needs a person (an answer to Apple, a demo
account, a fix to the listing). So a rejection now waits for a person
instead of the newest build being sent again: while a submission has
unresolved issues, or the newest build's version was rejected by Apple,
taken out of review or refused as an invalid build, every run says so and
sends nothing, until someone answers Apple in App Store Connect and
resubmits or removes the version. The step sends only the newest build that
Apple has processed and that is newer than the public one (never an
internal-only one; a newer build still processing goes on a later run). It
reads both of Apple's names for a version's state (`appVersionState` and the
older `appStoreState`), so an approved version waiting for its release is
never taken for one it may change. It reuses an empty draft submission or
resumes its own, and holds when a draft holds anything else; it waits for
Apple to mark the version ready for review and tries again while Apple is
still settling a change. A version it makes is released on approval; one
that already exists keeps the release setting someone gave it. The key is
one secret, `APP_STORE_REVIEW_KEY` (`{"issuerId", "keyId", "privateKey"}`,
App Manager; or an Admin's individual key, `{"keyId", "privateKey"}`, while
App Store Connect's Integrations page fails for us, to be swapped for a
team key once it opens), kept in `.env.production` like every other secret: `npm run
secrets -- production`, or `--only eas`, which needs no Supabase or
Cloudflare sign-in, puts it in EAS's production environment with secret
visibility (`docs/environments.md`, The App Store key). It replaces
`ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_PRIVATE_KEY`, which were never set,
and stays out of GitHub Actions, which holds no production key (decision
141). Reverse the wait if: rejected versions are mostly passed by the next
build unchanged, so that waiting for a person costs more than a second
rejection.

Amended (2026-11-03, Caleb Koster; LAN-209): a newer build takes a rejected
build's place by itself. Apple rejected build 48 twice (Guideline 2.5.19),
and the fix was a newer build (PR 322), which the wait above held in
TestFlight until someone removed build 48 from its rejected submission by
hand. Caleb chose that a newer build replaces a rejected one and goes to
review on its own. While a submission has unresolved issues and its version
holds a build older than the newest processed one, the step takes that
version out of the submission (`DELETE /v1/reviewSubmissionItems/{id}`, the
API's form of Remove in App Store Connect), waits for Apple to close the
submission, and sends the newest build on that version with the build's own
version number, as for any rejected version; if Apple has not closed it
yet, the next run sends it. The rejected build itself is still never sent
again by itself: a person answers Apple and resubmits it, or a newer build
comes. A rejected submission that holds anything besides that one version
is left to a person, and Apple's message stays in App Store Connect for
anyone who wants to answer it. Reverse if: Apple counts a replaced
rejection against the account (a warning, or slower or stricter reviews),
then wait for a person again.

Amended (2026-11-04, Caleb Koster; LAN-209): Apple deletes no item that
went to review. The first two runs asked to delete build 48's item from its
rejected submission, and Apple answered 409, "Item was already submitted",
so nothing changed and build 50 waited. The Remove button on App Store
Connect's App Review page marks the item removed instead: Caleb pressed it
by hand that evening, Apple closed the submission, and the version became
Developer Rejected with its build free to change. The step now does the
same (`PATCH /v1/reviewSubmissionItems/{id}` with `removed: true`) and
deletes nothing.

Amended (2026-11-04, Caleb Koster; LAN-223): a new build waits while
another is in review, on both stores, unless its pull request asks to
replace it. Caleb asked that a merge never restart a review by itself, and
that developers choose per pull request. On Google Play a newer production
release sent during a review takes its place and starts the review over,
so Android builds now go to the `internal` track (`eas.json`,
`submit.internal`), and `scripts/play-review.mjs` sends the newest one to
production review, with `releaseStatus: completed` as before, only when
nothing is in review. It runs right after the upload and every hour
(`.eas/workflows/app-store-review.yml`). Google's API cannot say whether a
release is in review (it calls a release completed once sent), so the step
compares the newest production release's version name with the version
Play's public page shows, which changes only once Google approves; a
release that the page does not show yet is in review, and while the page
cannot be read the build waits. A release Google rejected looks the same,
so the build waits until a person acts in Play Console. The step needs a
Play service account key with "Release to production", `PLAY_REVIEW_KEY`
in `.env.production`, which `npm run secrets -- production --only eas`
puts in EAS's production environment (`docs/environments.md`, The Play
key); until it is there, Android builds wait in internal testing for a
person to promote them, and the step succeeds. A pull request labelled
`store: replace review` asks for the opposite
(`scripts/store-choice.mjs`, read from GitHub's public API by the merge
commit, or by the minute a store version names): its Android build goes
straight to production, and its iPhone build cancels a review that is
waiting or under way (`PATCH /v1/reviewSubmissions/{id}` with `canceled:
true`, which leaves the version Developer Rejected) and takes that
version's place. A label that cannot be read means wait. Internal testers
get each Android build before the public again. The ops dashboard's
Releases section draws where each build and update is now
(`apps/admin/src/sources/pipeline.ts`, docs/admin.md). Reverse if: reviews are
fast enough that a restarted one costs less than a build that waits, then
send every build straight to production again.

Amended (2026-11-08, Carl Sauder): carried builds never go to production
review (246). A merge that makes one uploads it to Play's `alpha` track
with release status `draft` (`eas.json`, `submit.carried`), which
`scripts/play-review.mjs` never reads, since it sends the newest build on
the internal track to production review. EAS documents only production,
beta, alpha and internal, so a track of its own name was not on offer. It is
an exception to this entry's "every new build goes to production review",
and it uses up a version code, so later store builds simply number higher
(docs/nearby-sync-plan.md 14.4). Caleb should see this, since 157 is his
entry.

Amended (2026-11-13, Carl Sauder): the app reads the time back from a store
build's version and shows it on Sync, with the build number, beside the OTA
update's id and time (`storeVersionTime` in
`apps/mobile/src/shell/updateStatus.ts`). The phone's settings show only the
store version and nothing else shows the update, so a tester needs both to
say which code they run. A new form for the version needs that reader
changed too; a version it cannot read shows no date, never a wrong one.

Amended (2026-11-17, Carl Sauder): the hourly step (`app-store-review.yml`)
and the deploy on main (`deploy-to-testers.yml`) share the EAS concurrency
group `google-play`, so the hourly step waits for a deploy that is
uploading instead of deleting its upload's edit, and deploys take turns
(`docs/decisions/2026-11-17-play-uploads-take-turns.md`).
