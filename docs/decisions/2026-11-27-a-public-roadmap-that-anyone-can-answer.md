# A public roadmap on the app's Worker that anyone can answer, signed out, with an optional email, and that the ops dashboard controls

Date: 2026-11-27 · By: Caleb Koster · Status: accepted

Reason: Caleb asked on 2026-11-27 for a general product roadmap on the
LangQuest website, modeled on PowerSync's (three parts: In progress,
Planned, Under consideration), controlled from the dashboard, where
readers can say what they need and suggest items. He looked at a mock and
chose that anyone may send, with an optional email.

So:

- The page is `/roadmap` on the app's Worker (next.langquest.org and
  app.langquest.org), like `/videos`, not on langquest.org (a separate
  Next.js site on Vercel, outside this repository). langquest.org can link
  to it.
- Items and what people send live in the production database
  (`ops.roadmap_items`, `ops.roadmap_notes`), not in a third-party roadmap
  service, so the dashboard reads and changes them like the rest of ops,
  and no reader's words or email go to another company.
- A reader answers an item with one of four importances (as PowerSync
  does), optional words and an optional email. A suggestion is the same
  with no item. No account and no sign-in: most readers have no LangQuest
  account. The public page shows no counts, names or emails; only Global
  Viewers see them on the dashboard.
- Spam meets a per-address rate limit on the Worker (no address kept), a
  hidden field, and a cap of 1000 sends a day in the database.
- What people send is deleted after a year.
- Items are written in one language by the team. The page's own words
  are in every app language.

Reverse if: spam passes the three limits, or the team wants items in each
reader's language; then add sign-in or a check, or translated items.
