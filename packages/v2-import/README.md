# packages/v2-import

Brings LangQuest v2 into this app, one way, and keeps it coming while v2
runs (decision 94). How it works: `docs/v2-import.md`. Run it with
`npm run v2`.

Many v2 projects carry the wrong language: people picked English (or their
own copy of it, or a national language) and put the real language in the
project name. Before importing or mapping any v2 project, or any record tied
to its language, read `docs/v2-project-languages.md`, and use the language
confirmed on the import's board (`npm run v2 -- board`) or in the CSV's
`decision` column; if neither says, ask the developer
(`CONTRIBUTING.md`, LangQuest v2 records). Languoids that v2 users made are
never imported (`docs/languoids.md`). Change the import here, never by
appending v2 events by hand.
