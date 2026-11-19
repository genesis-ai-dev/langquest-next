# 57. The app shows the organization's reports: a Reports section on wide windows, server totals on a phone's Progress

Date: 2026-10-03 · By: Carl Sauder · Status: accepted

Reason: the Expo app now runs on tablets and in a browser (55), so the
separate web dashboard (`apps/web`, 41, 44) was a second front end with its
own sign-in, routing and charts. Its report pages move into the app as a
Reports section (`src/screens/reports.tsx`, its parts in `src/reports/`): a
tab after Map, shown only when the window is 768 or wider and the person has
`view_status` (`tabsFor`), with the dashboard's sections behind a row of
chips (Overview, Recent activity, Languages, Geography, Field report,
Monthly ledger, Pace, Alerts) and one language's page. Two app-only screens,
`reports_home` and `reports_language`, with one edge each way, are in
`flow.ts` and the parity test's drift log; the demo has no such screens, and
a phone's screens stay the demo's. Their figures are core
`portfolio.ts` (moved from the page) over the rows the dashboard's server
returns, fetched by `packages/client` `fetchOrgReports`; a language's
country and target go straight to the server with `appendConfirmed`, since
that language's partition need not be on the device. A phone gets no
Reports tab, but its Progress overview and organization home now count every
language: the local fold for the language it has open, the server's
`?view=summary` for the rest, labelled with how old they are and kept on the
device for offline (`useOrgSummary`, `orgFigures.ts`). The page in
`apps/web/src` is frozen until the app's web export replaces it behind the
same Worker. The cost: four libraries ship in the app for the map and country
names, and Reports need a connection.
Reverse if: partners want reports on phones (then a phone-shaped Reports
chain, which the demo would need to define), or the server's figures and a
phone's own fold disagree in ways people notice (then show only one source
per screen).
