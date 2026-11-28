# The public roadmap

Kind: reference

`/roadmap` on the app's Worker (next.langquest.org and app.langquest.org)
shows what the LangQuest team works on now, plans and considers, and what
it finished. Anyone can say how important an item is, write what they need,
leave an email, or suggest a new item, signed out. The ops dashboard's
**Roadmap** page (menu The product) makes and changes the items and reads
what people sent
(`docs/decisions/2026-11-27-a-public-roadmap-that-anyone-can-answer.md`).

```
reader ──► /roadmap ─────────► ops_roadmap_list() ──────┐
       ──► /roadmap/p/<id> ──► ops_roadmap_picture() ───┤
       ──► /roadmap/send ────► ops_roadmap_send() ──────┼─► ops.roadmap_items
                                                        │   ops.roadmap_notes
admin ──► Roadmap page ──► /ops/api/actions ──► ops_roadmap_item_save()
                                            ──► ops_roadmap_suggestion_decide()
      ◄── /ops/api/roadmap ◄── diag.ops_roadmap() (diag_reader)
```

## The page

`apps/web/worker/roadmapPage.ts` and `roadmap.ts`, in the same style as
`/videos`: one HTML page from the Worker, its own content security policy,
kept 5 minutes by caches, in the reader's language (`accept-language`, or
the language list; `apps/web/worker/i18n/*.json`, area `roadmap`).

- **Roadmap tab**: three parts, In progress, Planned and Under
  consideration. Each item is a card: an optional picture, the title and
  the first lines of the text.
- **Done tab**: the 50 newest finished items, with the date each one was
  done.
- **A card opens** the item: its picture, the whole text, then How
  important is this to you? with four answers (Not important, Nice to have,
  Important, Critical), a box for what the reader needs, an optional email,
  and Send.
- **＋ Suggest**: the same answers and box, for a new item.
- The page never shows counts, names, emails or the Linear issue. The
  browser keeps which items this reader answered (`localStorage`
  `roadmap-picks`) to mark their cards; nothing else is kept in the browser
  and no cookie is set.
- Item titles and texts show as the team wrote them, in one language. Only
  the page's own words are translated.

## What a reader sends

`POST /roadmap/send`, JSON: `item` (null for a suggestion), `importance`
0–3, `words` (at most 2000 characters; a suggestion needs them), `email`
(optional), `language`. Answers: 204 kept, 400 not a good send, 404 the
item is gone or hidden, 413 too long, 415 not JSON, 429 too many, 503 the
database did not answer.

Three limits keep spam out, and none keeps an address:

1. The Worker's rate limit `ROADMAP_RATE_LIMIT`: 6 sends a minute for each
   address (`wrangler.jsonc`).
2. A field no person sees (`website`). A send that fills it gets 204 and
   nothing is kept.
3. The database takes at most 1000 sends a day (`ops.roadmap_day_max()`).
   Past that it answers `full`, the page says it did not send, and the
   dashboard shows a Fix soon line (`roadmap-full`).

## The data

Migration `20261127233000_ops_roadmap.sql`.

- `ops.roadmap_items`: state (`progress`, `planned`, `considering`, `done`,
  `hidden`), title (at most 120), text (at most 2000), picture (a data URL,
  WebP, JPEG or PNG, made by the dashboard at 960 by 420), Linear issue,
  the date it was done, who made and changed it.
- `ops.roadmap_notes`: one row for each send: the item (null for a new
  suggestion), importance, words, email, language, time. A suggestion has
  `suggestion = true` and a state: `new`, then `added` (to an item) or
  `hidden`.
- Every note is deleted a year after it was sent (`ops.roadmap_expire()`,
  pg_cron `langquest-purge-roadmap`, 03:53 UTC).
- `claude_reader` never reads an email; `agent_reader` reads the words only
  through `masked.roadmap_notes` (`docs/production-reads.md`).

## The dashboard page

`apps/admin/src/pageRoadmap.ts`, `sources/roadmap.ts`.

- **Suggestions**: each new one with its importance, words, language and
  email. New item makes it an item under consideration (its first line is
  the title), Add to item joins it to an item, Hide takes it off the list.
  A suggestion that waits is a Watch line (`roadmap-suggestions`).
- **Items**: the board by part, the most critical first, then the most
  answered. The bar is how many people chose each importance.
- **An item opens** the editor: the part (or Done, or Hidden), title, text,
  picture, Linear issue, and Save; then what people wrote, newest first,
  with their emails.
- Each tap is recorded in `ops.actions` (`roadmap_item`,
  `roadmap_suggestion`).
