# 210. The web app is at app.langquest.org, next.langquest.org stays as an alias, and links move only once phones can read them

Date: 2026-11-12 · By: Caleb Koster · Status: accepted

Reason: Caleb agreed the hostnames on 2026-11-02 and 2026-11-03 (LAN-219):
`app.langquest.org` is the Next web app, `langquest.org` is the landing page,
and `next.langquest.org` keeps working so nothing that names it breaks. On
2026-11-06 Caleb chose that the old website goes to `legacy.langquest.org`, so
the legacy web app goes to `legacy-app.langquest.org`. Ending a
legacy web session is accepted; everything else moves gracefully.
`docs/cloudflare.md` has the steps, in order.

What moves in this change, and what does not:
- **People's address moves.** `apps/web/wrangler.jsonc` routes both hosts to one
  Worker; the phones declare `app.` too (`app.json`, `appLinks.json`,
  `DECLARED_HOSTS`), and the ops dashboard watches it. The `.well-known` files
  and the page's API need no change: they are the same files, and a browser asks
  its own origin.
- **Links stay at `next.` for now.** `EXPO_PUBLIC_APP_URL` and the invite email's
  `APP_URL` still make `next.` links. A build before this one refuses a scanned
  or pasted link at a host it does not know, and does not open `app.` links in
  the app, so an `app.` QR would fail on those phones. The cost: someone on
  `app.` who follows a Forgot password email lands on `next.`, a different origin
  with its own sign-in and storage.
- **Machines stay at `next.` for now.** `next.` stays first in `routes`, so
  `API_URL`, the webhook poke (`appUrl` in `scripts/secrets.mjs`) and the YouTube
  callback registered with Google do not change, and no secret or console step
  is tied to the move. Scripts' API addresses and OIDC audiences stay too.
- **Published and declared addresses stay.** The privacy and deletion addresses
  in Play Console and `src/auth/legal.ts`, and video links already on YouTube,
  still work on the alias, so no store answer changes.
- **`next-preview` keeps its name.** Only the team uses it, and a new name would
  cost work and change nothing for anyone.

Merging is the switch: a deploy attaches the route and takes the name in DNS
without asking. So the legacy app moves first, and `preview.app` gets its own
record first, because a record for `app` ends the wildcard that serves it. The
legacy app's Supabase site URL stays `langquest.org`: its phones and emails use
the website, not `app.`, though LAN-219 had planned to change it. One website
project answers at both `langquest.org` and `legacy.langquest.org`, so that the
paths its phones and emails open stay where they are; only the home page differs.

Alternatives: a redirect from `next.` to `app.` now, which drops a bearer token's
POST and strands work a browser has not uploaded (58); moving links in the same
change, which breaks scanning on phones already in the field.

Reverse if: `app.` causes a problem that `next.` does not (then remove its route,
and the legacy app can have the name back). `next.` may redirect once its traffic
has moved and browsers there have drained, as `docs/cloudflare.md` says.
