# 233. The web app may take 3.94 MB on a first visit and 4.92 MB in all, for nearby sync

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: the web app never runs nearby sync (58), but every client carries
what the shared sync path needs: the checkpoint gates, the pull's
comparison, the stores' nearby tables, ids that name their author, the
own-file counts and `holding`, and the Share nearby screen's words, stubs
and flow edges. Main had about 2 KB left. Carl chose to raise the budgets
in `apps/mobile/scripts/export-web.mjs` rather than hold the work back:
the first visit to 3.93 MB with the sync changes (3.91 MB then), then to
3.94 MB with Share nearby (3.92 MB to 3.93 MB: 6 KB of English words, the
rest stubs and flow edges), and all chunks to 4.92 MB (4.90 MB to 4.92 MB,
13 KB of it the screen's chunk, which the web never opens but the screen map
names), each rounded up to the next 0.01 MB. Everything else moved behind
the Android-only nearby entries (`@langquest-next/sync/nearby`, `.android`
files), which is also why diagnostics' `nearby` kind lives there (235).
Reverse if: a later change needs room and nearby's share can move behind a
chunk the web never loads.

Amended (2026-11-09, Carl Sauder): the budgets now stand at about 3.97 MB
on a first visit (3.94 MB and 35 KB) and about 4.98 MB in all (4.93 MB and
55 KB). Carl chose that each later nearby change raise them by what it
measured rather than wait for a trim, and each raise's reason sits beside
the number in `export-web.mjs`: joining offline, the carried build and its
install file screen, Share nearby's two jobs, the Sync reminders, the fixes
from the two-emulator test, and main's own 2 KB for LAN-221 merged in. A
trim pass before the branch merges is still worth doing.

Amended (2026-11-10, Carl Sauder): the trim pass lowered them to 3.94 MB
and 14 KB on a first visit (about 3.95 MB) and 4.93 MB and 50 KB in all.
Nearby sync's words left the catalogs for `src/nearby/i18n`, as the
disguise's did (171): a phone loads them at start, the web bundles their
English only with the nearby screens and serves the other languages' inside
each catalog file it already fetches. The two small parts of nearby code every
client read (the user-state flags, the token check) left the modules they
were in, so the rest no longer loads on the web. What the first visit still
carries for nearby sync, about 53 KB over main, is the shared sync path this
entry already names, and the local person's Me and Sign In branches.

Amended (2026-11-12, Carl Sauder): the dependency upgrades (247 to 250),
stacked on this branch, raise them to 3.94 MB and 91 KB on a first visit
(about 4.03 MB) and 4.93 MB and 115 KB in all (about 5.04 MB), counting
main's merge into this branch. Measured on the merged code, the upgrades
add 72,051 bytes to a first visit and 49,438 in all, none of it the app's
code: 20 KB from the library updates (lucide, i18next, React Navigation,
supabase-js, react-i18next) and the rest from Expo SDK 58, React DOM 19.3
the most of it (28.5 KB). Each figure is in `export-web.mjs`, measured
package by package from the source maps.
