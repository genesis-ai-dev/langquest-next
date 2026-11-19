# 142. The projection pass stores what each language's report is made from, and the dashboard renders reports from it without folding

Date: 2026-10-19 · By: Carl Sauder · Status: accepted

Reason: the organization's Durable Object folded every language to answer
Reports (44), in a 128 MB isolate that a Bible-size language does not fit
(132), and folded every language again when the UTC day turned, because a
report's windows (53 weeks, 90 days of progress, 35 of uploads, 13 months,
the 14-day stuck alert) end today. `docs/server-jobs.md` makes the pass, on
the job host that folds every language anyway (141), the one producer of
per-language aggregates. A stored report would go stale at midnight for a
language nobody touched, so the pass stores the report's inputs instead:
core `reportInputs` extracts from the fold everything `languageReport`
reads, keyed by day, week and month for all time and with nothing from the
organization stream, and `renderLanguageReport` makes the report for any
day from them; `languageReport` is the two composed, so every report test
holds them equal, and a test holds inputs stored as JSON and rendered up to
400 days later equal to a fold on that day. Two things are summarized where
a list would grow: the upload log keeps only the days it can still show,
and cards already stuck when extracted are a count, the oldest and their
passages (two imported languages held 89,000, 7 MB a row). Rows live in
`language_report_inputs` (service role only), written each time the pass
folds a language; an upload is no longer quiet for the pass (68). The
object renders from them, folding only a language with no row, or, on a
catch-up, one whose row is behind its stream and that has at most 25,000
events (44's amendment), so "Catch up with the server" still shows what
was just done. Checked on
the local database: 105 languages, every stored row renders the report a
fold of the same events gives, today and 20 days on; the largest row was
750 KB of text.
Not chosen: storing the rendered report and refolding every language once
a day (decision 40's way; a daily snapshot download per language, and stale
figures between midnight and the next pass); a per-language people list
(who may see a language comes from the organization stream, which the
object folds itself, small).
Reverse if: the object reads stored inputs often enough to cost more than
the folds did, or the inputs of a language outgrow a few megabytes (then
store them in pieces, as snapshots are, or summarize more of them).

Amended (2026-10-20, Carl Sauder): the object no longer folds a language of
more than 25,000 events (`FOLD_ON_CATCH_UP_EVENTS`) for a report at all
(147). With no stored inputs for this REPORT_VERSION (before the pass first
reaches it, or after a new version until the pass rewrites it), the answer
names it in `preparing` and Reports says its report is being prepared and
shows within a few minutes; it renders from its inputs once the pass stores
them. A Bible-size language folded whole does not fit the isolate, and the
report needs every passage's record, which the shared part of the cut does
not hold. Smaller languages fold as before when they have no inputs.
