# 58. The web is a published platform: one Worker serves it, and a browser keeps its work like a phone

Date: 2026-10-03 · By: Carl Sauder · Status: accepted

Reason: with the reports in the app (57), the Expo web build replaces the
dashboard page, so it has to hold up as a platform rather than a test target
(55 left blob storage, notifications and publishing aside). What changed:
- Hosting: the dashboard's Worker (`apps/web`, 44) serves the app's web
  export (`npm run export:web`, `output: single`) as its static assets, with
  `/api/*` first, at `next.langquest.org` (preview `next-preview`), custom
  domains on the langquest.org zone in this account. EAS Hosting has
  no Durable Objects and wants Expo Router; Supabase functions have no
  per-organization memory. The Vite page is deleted.
- Durability: recordings and library documents live in the browser's origin
  private file system (`webFiles.ts`), so one not yet uploaded outlives a
  reload as it outlives a restart on a phone; the app asks the browser to
  keep its storage (`navigator.storage.persist`). The database stays
  expo-sqlite's, whose file pool is exclusive to one page.
- One tab: a Web Lock decides which tab holds the database (`tabLock.ts`,
  `storageGate.tsx`); another says so and offers "Use it here", and nothing
  opens storage before the lock is held.
- Honest audio: phones play only what a file's label says, so a browser
  records MP4 when it can and otherwise converts the take to WAV
  (`audioFormat.ts`); `BlobRef.format` stays `wav | m4a`. A tab in the
  background keeps recording; leaving the page warns first.
- Shared computers: sign-out forgets the browser (11, 12 amended).
- Links: one https link per key (54 amended), served `.well-known` files
  from `appLinks.json` for universal links and app links.
- Addresses: the address names the section (`webPaths.ts`), a refresh
  returns to it when the person may open it, Back steps back in the app, and
  the tab title names the screen; navigation still follows `flow.ts` only.
- Headers (`webHeaders.mjs`): a content security policy from what the app
  loads, HSTS and the rest. No cross-origin isolation: the async database
  API needs no SharedArrayBuffer, and isolation would block study images.
- Launch needs a connection (no service worker); work continues offline once
  open. Push notifications stay phone-only for now; the Inbox works on the
  web.
- Updates: each build writes its commit to `/version.json`, and the open app
  offers a reload when the deployed one differs. Diagnostics name the build
  the same way; source maps are kept out of what is served.
- Checks: `smart-tests/web-smoke` runs the release build, served by the
  Worker, in Chromium, Firefox and WebKit on every pull request, with an
  axe accessibility check; the export holds a 5.5 MB JavaScript budget. The
  muted text colour moved from the demo's #7D72A8 to #6E629E, the same hue at
  4.5:1 (WCAG AA), which axe required.
Changing the domain later: the Worker route, EXPO_PUBLIC_APP_URL and APP_URL,
the Supabase redirect URLs and `appLinks.json`, plus a native build listing
both domains; keep the old host serving, then redirecting, until links sent
and work unsent there have drained, since a browser's storage belongs to its
origin.
Reverse if: field use needs the web to open offline (then a service worker
for the app shell), people need several tabs at once (then a shared worker
holds the database), or browsers' storage proves less durable than phones'
in practice (then the web becomes read-mostly and recording stays on phones).

Amended (2026-10-05, Carl Sauder): iOS does not claim the domains yet.
`ios.associatedDomains` in `app.json` failed the App Store build: the
provisioning profile EAS made before it lacks the Associated Domains
capability, and builds from the workflow cannot add one (that needs an Apple
ID with access to Certificates, Identifiers & Profiles, which is being
sorted out). Until then iOS links open the web app; Android app links and
both `.well-known` files are unchanged. To turn it on: enable Associated
Domains on `com.frontierrnd.langquestnext` in the developer portal, make a
new App Store profile (`eas credentials`), and put `associatedDomains` back.

Amended (2026-10-13, Carl Sauder): one tab at a time no longer mistakes a
reload for another tab. After a reload, the page that went still held the
Web Lock for a moment, and about one reload in eight said "LangQuest is open
in another tab". Now a taken lock is asked for again every 250 ms for two
seconds before the page says another tab has it. Stopping releases the lock,
and a page keeps one lock however often its storage gate remounts
(`tabLock.ts`, `storageGate.tsx`).

Amended (2026-10-14, Carl Sauder): the export's JavaScript budget is 6.1 MB
(`apps/mobile/scripts/export-web.mjs`). It was raised from 5.5 to 6 MB with
localization (81), and is raised again because moving the app's logic out of
its screens into feature modules (105) added 57 small modules: Metro wraps
each one, about half a kilobyte apiece, so the move cost 30 KB beyond the
code it moved (5.98 MB on main, 6.01 MB after). The budget still says when
the download grows; one module per concern is worth that half kilobyte.

Amended (2026-10-15, Carl Sauder): the export is now a main file and one
file per screen module that loads when opened, and the budget is two: 5.7
MiB for what a first visit loads, 6.5 MiB for all of it (123).

Amended (2026-11-03, Caleb Koster): iOS claims the domains again.
`ios.associatedDomains` is back in `app.json` for both hosts, so an iPhone
opens invite, sign-in and Forgot password links (`/invite`, `/signin`) in
the app, as Android does. Ryder Wishart found Associated Domains already
enabled on `com.frontierrnd.langquestnext`; Caleb asked for it in the next
iPhone store build, which is a native change, so phones on older builds
keep opening the web app.

Amended (2026-11-06, Caleb Koster): the web app's address is now
`app.langquest.org`, with `next.langquest.org` as an alias (210).
