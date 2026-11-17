# 128. A review goes on the one passage it is about

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb asked on 2026-10-16 to get rid of applying one review to more
than one passage: "I think it's more confusing than convenient. The user can
go in, passage by passage, and apply reviews where needed." The partner demo's
"Also covered in this session" picker (REV-6, ADR-028) is gone from Already
happened's Add details, with its nearby-passage list, search, "Saves to N
passages" line and "added to N passages" message: a logged check is written
for the passage it was opened on, on the version chosen there
(`screens/review.tsx`), and another passage the session covered gets its own
review from its own record. `reviewing/capture.ts` loses `recordedPassages`,
`nearbyPassages`, `searchPassages`, `matchesQuery` and `loggedTargets`, and a
review draft no longer keeps `also` (one kept by an earlier version still
reads). Stored data and core are unchanged: `recordReview` still takes several
`takeIds`, and reviews an earlier version logged on several passages stay on
each of them.
Reverse if: teams who log community or consultant sessions covering many
passages find going passage by passage too slow; then bring the picker back
(the demo's AlsoCoveredPicker), perhaps as a copy-this-review action on the
record rather than a field of the review.
