# src/server

Every call this app makes to Supabase, and the blob transfers through the
Worker, live here (decisions.md 105). Screens, hooks and models call these
functions; nothing outside this folder imports `supabase.ts` or calls
`.rpc(`, `.auth.` or `.functions.invoke(` (`test/serverBoundary.test.ts`).

Each function is a thin, named call: the RPC or table, its parameters, and
supabase-js's own `{ data, error }` answer, so a caller decides what a
refusal or a lost connection means for the person using it. One file per
area: `auth`, `account`, `invites`, `library`, `languages`, `moderation`,
`notifications`, `reference`, `diagnostics`, `globalViewer` (decisions.md
158), `v2`, `personas` (dev builds),
`handOver` (sessions kept for a shared phone), `sync` (the transport the
streams use) and `blobTransport`.
