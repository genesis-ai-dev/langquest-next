# 123. Screens most people never open load when opened, and the web budget measures a first visit

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: `App.tsx` imported every screen module, and Expo's Metro config
turns inline requires off, so a phone ran all of them before the first
frame: Reports' d3-geo, world map and 13 country-name tables among them,
though phones never show Reports. On the web the export was one file, its
budget raised four times (4.8, 6, 6.1, 6.25 MB) and nearly spent
(performance-audit-app.md S1, S2). Now Reports, Config, Org, Content,
Checks, Sources and Reference are `import()`ed the first time one of their
screens opens (`lazyScreen`, `apps/mobile/src/shell/lazyScreens.tsx`); the
screens on the way to recording stay in the main bundle. The web export
gives each its own file; a phone keeps them in its one bundle. Inline
requires are on for native only (`metro.config.js`): on the web they added
110 KB to the entry file, which a browser parses whole either way. Once the
organization's first sync has settled, the web fetches the lazy files in
the background (`usePrefetchLazyScreens`), so work still continues offline
once the app is open (58); a file that fails to load reaches the error
boundary, and the next open tries again. `apps/mobile/scripts/export-web.mjs`
holds two budgets: 5.7 MiB for the files `index.html` loads (5.41
measured, 6.21 before), and 6.5 MiB for every file together (6.26 once
main's security fixes and field diagnostics merged in; the cap only catches
growth that runs away, and the first-visit budget holds what a visit pays). Help
audio now waits for that first sync, an idle screen, and Wi-Fi or a cable
(`useKeepHelpAudio`), and `/i18n/*` is cached for a year, since the app
asks for it with `?v=<build>`. Turned down: splitting the country names by
language (`countryName()` is synchronous; they now ride in the Reports
file). Reverse if: a lazy screen's first open is slow enough for people to
notice on the slowest partner phone, or the web's background fetch competes
with a first sync on slow links; then move that screen back, or fetch later.

Amended (2026-10-26, Carl Sauder): both budgets lowered, to 3.9 MiB for a
first visit and 4.75 MiB in all. lucide's entry re-exports every one of its
1,800-odd icons and Metro does not shake out the ones no file uses, so the
main file carried 1.5 MB of icons for the 91 the app draws. Icons now come
one file each through `apps/mobile/src/ui/icons.ts`, and lint refuses the
package's entry elsewhere (`noIconBarrel`, `eslint.config.mjs`). A first
visit went from 5.70 to 3.71 MiB and every file together from 6.54 to 4.54
(performance-audit-2026-10-26.md item 1). The budgets keep about 5% of
room, as above, so the space is spent on purpose rather than by drift.

Amended (2026-11-17, Caleb Koster): the budgets are held on the production
export, the one Workers Builds builds and refuses to deploy when it is over.
CI and `npm run guardrails -- --web` measured the development export, which
its settings (the local stack's shorter address, no app address and no
nearby certificate keys) make about 500 bytes smaller. When nearby sync on
iPhones (256) merged on 2026-11-17, the development export was 59 bytes
under and passed every check, and the production export was 437 bytes over:
`main` built but did not deploy, and next.langquest.org stayed on the
commit before it. web-smoke now builds the production export first, only
for the budget, and then the development export its tests serve; guardrails
builds the production one; `e2e/export-web.sh` reuses an export only when
it holds the running stack's address. Reverse if: the two exports' sizes
are made equal, so that one build measures both.
