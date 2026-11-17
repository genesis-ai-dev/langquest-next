# 27. The slideshow mock is the reference for user screens

Date: 2026-09-16 · By: Ryder Wishart · Status: superseded by 28

Reason: "one screen, one task, one main action" is easy to agree with in prose
and easy to drift from in code — the rules that actually bite are the ones
about what happens to a blocked control, where the yellow goes after a step
finishes, and what a recording screen looks like while it is ignoring you.
`docs/ux/one-next-action.html` pins those down in the real tokens and icons,
so a disagreement about an avatar U screen is settled by opening it rather
than by re-reading section 12. It is reference only: not imported, not built,
not tested. Reverse if: partner testing changes the rules; then update the
mock in the same change, or delete it rather than leave it contradicting the
app.
