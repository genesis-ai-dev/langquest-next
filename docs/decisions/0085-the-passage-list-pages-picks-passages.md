# 85. The passage list pages, picks passages by id, and includes any part of one passage

Date: 2026-10-12 · By: Carl Sauder · Status: accepted

Reason: changes the list 70 shipped. Asking an agent for the review status
of a language's 23 passages in review took 24 calls (the list, then each
passage), about 100 KB, mostly audio links the question did not need. The
list had no pages: Tyap's 1,584 passages were 560 KB. Carl chose one list
that can carry any part of a passage, with pages. Chosen:
- `GET …/languages/{languageId}/passages` (and MCP `list_passages`) returns
  `{ passages, nextAfter }`, as external values already page (79). It was a
  bare array; the API was five days old, so the partners using it are told
  rather than given a second shape. A page holds 100 passages, or `limit`
  up to 500. `after` is the last passage's `unitId`, in display order.
- `include` (`audio`, `reviews`, `steps`, `requests`, `versions`) adds those
  fields of one passage to each passage on the page, built by the same code
  as one passage (`passageOut` in `apps/web/worker/agent/view.ts`), and
  links are signed only for the page. `steps`, `requests` and `versions`
  need `read`, and are refused with `read:published` alone.
- `unitIds` picks passages; in REST it repeats, one id each, because a unit
  id may hold a comma. Ids that do not exist or are hidden from the token
  are left out, not refused.
- `GET …/passages/{unitId}` and `get_passage` stay as they shipped: one
  passage with everything the token may see.
- One parser (`parsePassageQuery`) holds the rules for REST and MCP.
Rejected: steps on every list entry (four to five times larger for callers
that never read them); separate `steps` and `audio` flags (two ways to say
what `include` says); a cap of 50 passages when audio is included instead
of pages; the cursor in a header (MCP has none) or an object only when
paging (a shape that depends on the request, and an unbounded default).
Reverse if: callers lose passages between pages because the order changes
under them (then a cursor on a snapshot), or a page with every include is
too large at 100 (then a smaller default).
