# 52. The app icon is black and white; the app keeps the demo's purple

Date: 2026-10-01 · By: Caleb Koster · Status: accepted

Reason: Caleb chose a new app icon, three rising bars with a check lying over
the tallest, in white on black, and asked that only the icon change while the
app keeps its theme (Caleb, 2026-10-01). So the icon departs from the demo's
purple brand but the screens do not: `theme.ts`, `theme.css` and the book
tile on the sign-in and welcome screens are unchanged, and 28 still holds for
colour. The icon's source is `apps/mobile/assets/logo.svg`;
`apps/mobile/scripts/render-icons.mjs` renders the app icon, Android adaptive
and monochrome layers, splash image and favicon from it, and the dashboard
uses it as its favicon. Reverse if: the brand is redone across the app; then
redraw the icon to match it.
