# Every run that writes to Google Play takes its turn, and the carried build uploads after the store build

Date: 2026-11-17 · By: Carl Sauder · Status: accepted

Reason: Google Play keeps one edit (a draft change to the app) open at a
time, and opening one deletes the one before it. On 2026-11-17 the run for
PR 496's merge built the store build (55) and the carried build (56) a minute
apart. `submit_carried` opened its edit while `submit_android_internal` was
still uploading 55, and that upload failed with "Google Api Error: Invalid
request - This Edit has been deleted". Build 55 never reached Play until a
person submitted it again. Nothing put the two uploads in order: the carried
jobs depended only on `build_carried`, so whichever build finished first
decided whether they overlapped (decision 246). The hourly
`app-store-review.yml` could do the same to any deploy, since
`scripts/play-review.mjs` opens an edit each time it looks at Play's tracks.
Two changes, chosen by Carl:

- Every workflow that writes to Play, `deploy-to-testers.yml` and
  `app-store-review.yml`, is in one EAS concurrency group, `google-play`,
  with `queue: max` and no `cancel_in_progress`. Runs take turns: a run
  waits for the one ahead of it, none is cancelled, and every waiting run
  keeps its place. EAS scopes a group to the project, across workflow files.
- Inside a run, `submit_carried` waits with `after` for
  `submit_android_internal`, `submit_android` and `review_android`, however
  they end, so the store's jobs still never wait for or depend on the
  carried ones.

`scripts/playReview.test.ts` holds the group on every workflow that writes
to Play, and `scripts/carriedBuild.test.ts` holds the order.

The cost: deploys on main no longer overlap. When two merges each make a
build, the second one's deploy waits for the first, up to about 40 minutes,
and the hourly review step waits behind a deploy that is running. A retry
on "This Edit has been deleted" was not enough: EAS's submit job (fastlane)
has no retry, and the job that retries would delete the other run's edit in
turn.

Reverse if: EAS's `after` skips a job when one it waits for was skipped
(then submit_carried never runs in the usual run, where `submit_android` is
skipped; the first deploy after this merge shows it, and a no-op job between
them would be the fix), waiting deploys hold up updates in a way people
notice, or Play or EAS gives a lock narrower than a whole run.
