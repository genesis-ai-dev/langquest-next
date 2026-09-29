# Journeys to port

These avatar journeys came from the `project-is-one-language` branch. Their
oracles look for events that branch added (`v1.CheckLogged`,
`v1.CheckRecorded`, `v1.ContentProduced`, `v1.ContextItemAdded`,
`v1.FeedbackKept`, `v1.StepSetAside`). Main records the same intents with the
passage-record events from docs/decisions.md 29-31 (`v1.ReviewRecorded`,
`v1.DepartureRecorded`, `v1.NoteAdded`, ...).

They do not run (Playwright only reads `journeys/`, and tsconfig excludes this
folder). Port one by pointing its oracle at main's event, then move it back
into `journeys/`. The user intent in each `goal` still holds.

| Journey | Oracle on the old branch | Main's event to check |
|---|---|---|
| reviewer-back-translates | `v1.ContentProduced` | `v1.ReviewRecorded` (outcome `recorded`, artifacts) |
| reviewer-checks-kind | `v1.CheckRecorded` | `v1.ReviewRecorded` |
| translator-logs-community-check | `v1.CheckLogged` | `v1.ReviewRecorded` (logged afterwards) |
| translator-sets-aside-step | `v1.StepSetAside` | `v1.DepartureRecorded` |
| translator-adds-study-note | `v1.ContextItemAdded` | `v1.NoteAdded` |
| translator-keeps-version | `v1.FeedbackKept` | check main's record for the equivalent |
