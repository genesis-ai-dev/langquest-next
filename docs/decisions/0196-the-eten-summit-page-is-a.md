# 196. The ETEN Summit page is a static page in the web export's public files, and it alone may frame YouTube's no-cookie player

Date: 2026-10-30 · By: Ryder Wishart · Status: accepted

Reason: ETEN's Innovation Lab asked each featured tool for a landing page
for the 2026 Summit's virtual tools lounge (10–12 November), with a short
demo video, and Ryder wanted the LangQuest page at next.langquest.org/eten
with the film embedded from YouTube. It is a plain HTML page in
`apps/mobile/public/eten/`, like `singapore-pcrt-2026/`: the web export
copies it and the Worker's assets serve it, so it needs no Worker code
and no app build. The site's policy (58, `apps/mobile/scripts/webHeaders.mjs`)
frames nothing, so `_headers` gives `/eten/*` its own block: it detaches
the site's Content-Security-Policy and sets the same one plus
`frame-src https://www.youtube-nocookie.com` (Cloudflare applies the
detach before the block's own value; checked on `wrangler dev`, and
`apps/web/test/securityHeaders.test.ts` holds the block). Every other
path keeps the policy unchanged.
Rejected: a Worker-made page like `/videos` (187), which would add code to
the Worker for a page that never changes on its own; allowing YouTube
frames site-wide (the app has no use for them).
Reverse if: the page needs to play where YouTube is blocked (then the
film's file beside it, played in a `<video>`, as `/videos` does), or
another page wants frames (then one policy for public pages, not one
block per page).
