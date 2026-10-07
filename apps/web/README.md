# apps/web

The Cloudflare Worker that serves LangQuest on the web (decisions.md 58):

- its static assets are the Expo app's web export (`apps/mobile/dist`, from
  `npm run export:web -w mobile -- <env>`), with the headers that build writes;
- `GET /api/orgs/:org/reports` is answered first, by one Durable Object per
  organization (decision 44, `worker/`);
- `GET /api/bible/*` reads Bible Brain with the server's key, which phones
  never see (`worker/bible.ts`, docs/reference-material.md). It answers 503
  until the optional `BIBLE_BRAIN_ACCESS_KEY` secret is set
  (docs/environments.md); locally, export it before `npm run web:dev`.

Locally:

- `npm run web:dev` runs the Worker on :8787 against the local database,
  serving whatever is in `apps/mobile/dist`. `npm run dev:local` (repo
  root) starts the local database and then this, in one command.
- For day-to-day work on screens, run the app with Metro instead
  (`npm run web -w mobile`) and point it at the Worker for Reports:
  `EXPO_PUBLIC_API_URL=http://localhost:8787`.
- `npm run test:web` builds the release export for the local stack and runs
  the browser smoke test (smart-tests/web-smoke) against it.

`npm run web:deploy[:preview]` is what Workers Builds runs (docs/cloudflare.md).
