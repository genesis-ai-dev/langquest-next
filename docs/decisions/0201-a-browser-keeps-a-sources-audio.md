# 201. A browser keeps a source's audio by asking the Worker for it, which passes the bytes on and keeps nothing

Date: 2026-11-03 · By: Caleb Koster · Status: accepted

Reason: no browser had ever kept a chapter of reference audio. The field
snapshot of 2026-11-03 found 63 of 63 downloads failing in two browsers in
two to twelve milliseconds: the page's content security policy (58,
`apps/mobile/scripts/webHeaders.mjs`) lets it read only its own site and
Supabase, and openbible.com sends no header that lets another site read
its files either, so widening the policy alone would not have done. Playing
worked all along, because `media-src` allows any https host. So in a
browser `sources/offline.ts` asks the Worker (`sources/throughWorker.ts`):
`/api/source-audio?url=` for a library source's link, only on a host in
core's `SOURCE_AUDIO_HOSTS` (today openbible.com), so it is no general
proxy (`apps/web/worker/sourceAudio.ts`); and `/api/bible/file/:fileset/
:book/:chapter` for Bible Brain, only for a fileset `/download` allows, as
the audio route already decides (`bible.ts`). Both need a signed-in person
and stream the file through without caching it, so Bible Brain's rule that
nothing of theirs stays on our servers still holds; the browser keeps it
by hash as a phone does. Phones still download from the source's own link.
Considered: `connect-src https:` (needs the hosts' cooperation, and gives up
what the policy protects); keeping no source audio in browsers (the offline
promise is the same on every platform, 58).
Reverse if: the sources serve cross-site reads and the policy can name
them, or the traffic through the Worker costs more than keeping the files
would.
