# 40. Dashboards read server projections of the shared reducer; organization totals are summed from visible language rows

Date: 2026-09-29 · By: Carl Sauder · Status: superseded by 44

Reason: coordinators want progress across an organization in a browser,
and the browser should neither sync nor fold a whole Bible per language.
The projection worker already folds every partition off the write path (one
per language since decision 37), so it also writes one report per language (core `laneReports`, built on
`derivePassage` and `languageProgress`, the same derivations as the phone's
Status screen) into `lane_reports`, plus a daily point in
`lane_report_days`. Both are read models: rebuildable, never written by a
user, tagged with `REPORT_VERSION`, and refolded when the partition, the
version or the day changes. Row-level security (`may_view_lane`, the
`view_status` privilege at org, partition or that language's scope) decides
which rows a person reads, and `apps/web` sums those rows itself instead of
reading a stored organization total, so a member scoped to one language
never learns another language's numbers. The web build reads the mobile
app's encrypted env files (only `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` reach the bundle), so there is one place to
change the server a build talks to. Figures lag by one projection pass,
and the page says how old they are. Supersedes the deferred
`project_summaries`. Reverse if: someone needs a figure that must be
current to the second; then fold that one partition in the browser from a
snapshot, the way the phone does.
