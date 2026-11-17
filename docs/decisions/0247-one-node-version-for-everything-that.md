# 247. One Node version for everything that installs or runs the code, its npm named exactly, and every third-party action pinned to a commit

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: a review of third-party dependencies (2026-11-06) found five Node
setups in play: Carl's machine had Node 22 and npm 9; GitHub CI took the
newest Node 24 of the day; EAS builds were pinned to 24.21.0 and missed the
24.22.1 security release; the job image took `node:24-slim` as it was on the
day of a deploy; and Cloudflare's builds installed with their image's npm
10.9.2, which is what failed every build from 2026-10-16 to 2026-10-19
(docs/cloudflare.md). Carl asked for the upgrades on 2026-11-11.
`.node-version` now names one exact version (24.22.3). GitHub CI reads it
(`node-version-file` in every `setup-node` step) and so do Cloudflare's
builds; the places that cannot read it name the same version: `eas.json`'s
profiles, the EAS workflows' `defaults.tools.node` and the job image's
`FROM`. `packageManager` names npm 11.19.1, the npm that Node ships with,
because it is the only way to choose Cloudflare's npm; `devEngines` warns on
an install with another Node or npm major, and `npm run guardrails` stops on
one. `@types/node` follows the Node major, so the types offer no API the
runtime lacks. Every third-party action runs at a commit with its release in
a comment, as all but two already did; those two, `create-github-app-token`
and `claude-code-action`, hold the release app's private key and the
Anthropic key, and a moved tag would have run with them. Steps that set no
npm cache say `package-manager-cache: false`, since `setup-node` now caches
on its own when `packageManager` is set. `scripts/toolchain.test.ts` holds
all of this, so a new Node patch is a change to the files it names.
Reverse if: a Node security release waits on these pins for more than a
week, which would argue for a major-only pin wherever the place allows one.
