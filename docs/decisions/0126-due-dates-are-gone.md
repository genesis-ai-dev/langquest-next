# 126. Due dates are gone

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb asked on 2026-10-16 to get rid of the due date feature across
the app. Nobody sets one any more: "Ask someone" has no "By when" section,
no date chips and no typed date. Nothing shows one: My Work's rows and Next
for you read "asked by {name}", Waiting on others lists newest first, the
Inbox body is the passage and its language, the passage's path and its step
rows say only who asked, History shows a request as open, done or
withdrawn, and the review banner reads "{name} asked". Reports replace the
"Overdue requests" tile with "Open requests" (the count of open requests,
still opening the Map filtered to waiting passages), the CSV exports drop
the "Overdue requests" column, and the agent API's requests no longer carry
`dueDate` (`docs/agent-api.md`). Stored data is unchanged: `v1.RequestMade`
keeps its optional `dueDate` in the schema, the validator and the server's
checks, so old events still sync, and an old request's date is simply not
shown. The reports API still sends `attention.overdueRequests: 0` (and the
report version is 5), so an app built before this shows 0 on its old tile,
not NaN. Removing the field from stored events is left for Caleb to decide.
Reverse if: teams need deadlines on requests again; then bring back setting
and showing `dueDate`, which old events still hold.
