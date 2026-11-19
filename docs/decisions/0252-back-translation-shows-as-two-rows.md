# 252. Back translation shows as two rows on the record, make it and check it, and never as a peer review

Date: 2026-11-12 · By: Caleb Koster · Status: accepted

Reason: at the 5 November 2026 meeting with Bezily's group the Standard Bible Flow looked as if a back translation needed a peer review, because step 1 lists both side by side and a made back translation read "looks good" though nobody had checked it (LAN-234). Caleb chose two rows with the flows unchanged. A kind that makes new content (`produces`) now shows "Back translation · make it" (done reads "made") followed by "Back translation · check it", which follows the check that compares it (`checkedBy`) and reads "checked" only once that check is done (`teamSteps` in `pathModel.ts`, `TeamStep.part`). It stays out when the back translation is set aside or moved past. The rows keep the look of the other team rows. Decision 91's one-row-per-check still holds for every other kind; flows and kinds are unchanged.
Reverse if: people still read the check row as a second review, or a language's flow needs back translation checked by something other than a named check.
