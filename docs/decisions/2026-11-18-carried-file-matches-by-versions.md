# A phone's carried file is any file for its versions: the Worker sends a name it lacks to the newest one, and Check my file takes any

Date: 2026-11-18 · By: Carl Sauder · Status: accepted

Reason: supersedes the part of decision 246 that makes the file's name an
exact match.

Decision 246 names the file a phone needs by its reducer, lines and protocol
versions and the first 8 of its Android fingerprint, and the app asked for
exactly that name. A carried file is made only at a merge into main, for
main's fingerprint, so a phone on any other build asks for a file that never
exists:

- On 2026-11-17 the store build most phones had (38, fingerprint
  `52e6dfee`) linked to `r21-l1-p1-52e6dfee.apk`. That file was never
  published, since every carried build for it failed before PR 488.
- On 2026-11-18 the two files made while Play's automatic protection was on
  were deleted, since they would not open when installed from a file. After
  that, no build in the field had a file.

Making carried builds on release branches too was weighed and turned down.
Each takes a version code higher than the store build in review, so a phone
installed from one could never take that build from Play. Once the branch
is deleted, its runtime gets no updates either.

A join checks only the reducer and lines versions (`sameVersions` in
`nearbySession.ts`), and the protocol decides whether two phones can talk.
The fingerprint only says which build a file is. So Carl chose (2026-11-18):

- **The Worker** (`apps/web/worker/apk.ts`) sends a name the bucket lacks to
  the newest file for the same versions, by a 302 that is never cached, so
  the browser downloads it under that file's own name.
  - **Newest** is by the Play version code that `scripts/carried-build.mjs`
    now records on each file (R2 custom metadata `version-code`, core
    `CARRIED_APK_VERSION_CODE`), then by when the file was put there.
  - **Listing:** to find it, the Worker lists the bucket by the versions'
    start alone and never shows the list. `/apk/` still answers 404.
- **The app** counts only the versions.
  - **Check my file** takes any file whose name starts with this phone's
    versions (`r21-l1-p1-`; core `carriedApkVersionsPart` and
    `sameCarriedVersions`). The too-old line and Sync's reminder compare the
    same way.
  - **The screens** show that start (`r21-l1-p1-….apk`). The line that said
    the name must be exact now says it must start that way
    (`nearby.letIn.fileStart`, in 16 languages). The 15 translations are
    Claude's and need review.
- **What it gives up.** Decision 246 put the fingerprint in the name so
  that, after a native change, a phone with no Play Store gets a file for a
  runtime that still takes updates. A newcomer now gets the newest file for
  those versions, usually main's latest native build, rather than the
  carrier's own.

Reverse if: joining comes to depend on native code that the fingerprint
stands for, so that two builds of the same versions cannot join; or
carriers are confused by a downloaded name that differs from the one their
phone asked for.
