# 45. Merging to main ships Android to Google Play's internal testing track

Date: 2026-09-30 · By: Caleb Koster · Status: accepted

Reason: Android testers should get the app from Google Play, as iOS testers
get it from TestFlight, without the listing being public. It is published
from the organization's Play developer account that distributes LangQuest
v2, so Play's closed-test period for new personal accounts does not apply.
`.eas/workflows/deploy-to-testers.yml` (renamed from
`deploy-to-testflight.yml`) now handles each platform on its own: a matching
native fingerprint ships an over-the-air update on `production`, otherwise it
builds and submits, to the `internal` track named in `eas.json`
(`submit.production.android`). Internal testing takes up to 100 testers by
email with no Play review, so a merge reaches them within minutes. The same
change turns off expo-audio's background playback (`app.json`): nothing played
in the background, recording stops when the app leaves the foreground, and
the foreground-service permission it added makes Play ask for a declaration
and a demo video. The Play service account key lives in EAS credentials, not
in the repo; the one-time Play Console steps are in `apps/mobile/README.md`
(Google Play, once).
Reverse if: testers outgrow 100 or need a group Play manages (move the track
to closed testing, `alpha`), or a feature needs audio to keep playing or
recording in the background (turn the plugin option back on and make the
declaration).

Amended (2026-10-22, Caleb Koster): Android builds now go to the production
track for production review, not to internal testing (decisions.md 157).
