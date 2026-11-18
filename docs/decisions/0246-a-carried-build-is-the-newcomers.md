# 246. A carried build is the newcomer's install file: made when the reducer, lines or protocol version or the Android fingerprint changes, fetched from Play and served from an R2 bucket of its own

Date: 2026-11-12 · By: Carl Sauder · Status: partly superseded by 2026-11-18-carried-file-matches-by-versions

Reason: an iPhone cannot install an app offline and a store build holds only
the JavaScript it was built with, so Carl chose (2026-11-06) that the app
comes to a newcomer as a carried APK built from the team's latest
JavaScript (docs/nearby-sync-plan.md 14.4); it is also how phones with no
Play Store, as in China, get the app at all. A merge into main that changes
`REDUCER_VERSION`, `LINES_VERSION`, the nearby protocol range or the Android
fingerprint makes one: the first three decide whether a starting copy can be
read and two phones can talk, and the fingerprint because after a native
change the old runtime gets updates only from `release/android`, which 155
deletes. The file's name holds only those versions (core `carriedApkName`,
`r21-l1-p1-<first 8 of the fingerprint>.apk`), because a carrier keeps it in
Downloads or on an SD card where no disguise applies; one function names it
for the script, the route and Let someone in. EAS clones only the latest
commit, so `scripts/carried-build.mjs --check` asks the bucket for that name
and a 404 means make one, which also retries a failed publish. The jobs
(`carried_check`, `build_carried`, `submit_carried`, `publish_carried` in
`deploy-to-testers.yml`) need only the fingerprint and no store job needs
them, so a failure there cannot stall `publish_android_update`. Its own
profile, `carried`, because `get_android_build` matches on profile and
fingerprint, and a carried build on `production` could satisfy that check
when the store build failed. It goes to Play's alpha track as a draft (157,
amended); the job then reads its Play-signed universal APK through
`generatedApks` with `PLAY_REVIEW_KEY`, GET only, and puts it in a new R2
bucket, `langquest-next-apks`, with a token limited to it (Carl's answer
12), served by the Worker at `/apk/<name>` with that name in
`Content-Disposition`, apart from teams' recordings and their auth, and
public by design. It cannot be a static asset, as an APK is past
Cloudflare's per-file limit. The script fails closed: a missing setting or
key, a fingerprint not the build's, or any answer from Google or the bucket
it does not expect stops it before it writes. A carrier downloads the file
with their browser while online; the app never downloads or installs it,
which keeps clear of Play's rules on apps that download APKs, and
`REQUEST_INSTALL_PACKAGES` stays out. A person creates the bucket and its
token, and someone with `PLAY_REVIEW_KEY` tries `generatedApks` on an
existing build first. `server-calls` holds the carried profile's builds as
store builds and `store-build-guard` refuses one started outside the
workflow, since it is in the field too.
Reverse if: carried files go out of date faster than carriers can replace
them (section 14.3), China cannot reach the address, or a phone installed
from one does not take Play updates.

Amended (2026-11-09, Carl Sauder): a carrier now finds and checks the file
from Let someone in, instead of seeing only its name (Carl's choices, all
four). Get the install file, while online, opens `<Worker>/apk/<name>` in the
phone's browser, which downloads it; the app still downloads and installs
nothing, and a line says to get it before going offline, that the new phone
must allow apps from other sources, and to pass it by Quick Share (Google
Play services on both phones), SD card or USB; offline the button is
disabled and says it needs the internet. The press keeps the name in one
phone-wide meta row, `carriedApkOpened`, holding no person, organization or
time; while the name this phone needs differs, Let someone in says the file
is for an older version, and Share nearby says so while online, because a
carrier who leaves town with an old file can let nobody in. Check my file
opens Android's system picker and compares only the chosen file's name with
the one needed, since the name is the versions; a right file is remembered
as got. That adds `expo-document-picker`, Android only (excluded from iPhone
autolinking), with `copyToCacheDirectory` off so nothing is copied or read:
`expo-file-system`'s picker gives only the file's address, not its name. It
needs no permission, and no Play Console answer changes
(`docs/play-store-declarations.md`). A version refusal now names the file on
the inviter's phone and tells the newcomer to get the inviter's file, from
the session report's existing `versionsDiffer`, with the wire unchanged. On
a disguised phone one more line, in `src/disguise/i18n`, says the browser's
history shows where the file came from. Plan 14.4 has the details.

Amended (2026-11-09, Carl Sauder): the file is now got and checked on a
screen of its own, Get the install file (`get_install_file`), not on Let
someone in, because the two jobs happen at different times: getting the file
online before a trip, letting someone in in the field (Carl's choice). Share
nearby opens it from a row above Let someone in, on the same terms, and from
its too-old line; Let someone in opens it from a line at its top saying the
new phone needs the app installed first, and keeps the role, the code, the
pictures, the one tap and the version refusal's words. What the screen does
is unchanged. Plan 14.4 has the details.

Amended (2026-11-09, Carl Sauder): while online, Sync reminds someone who can
let a new person in, and whose phone has never got the file it needs now or
got one for an older version, to get it: a line on the Ready for offline card
with a Get it link to Get the install file, and an amber line on the Share
nearby row (Carl's choice), until the right file is got (`apkReminder`, plan
14.4).

Amended (2026-11-17, Carl Sauder): `submit_carried` now also waits, with
`after`, for the store build's Play uploads and its review step
(`submit_android_internal`, `submit_android`, `review_android`), however
they end. Play deletes an open edit when another opens, and the carried
upload deleted build 55's mid-upload
(`docs/decisions/2026-11-17-play-uploads-take-turns.md`). The store's jobs
still never wait for or depend on the carried ones.

Amended (2026-11-18, Carl Sauder): Sync reminds a carrier of the install file in one place, as an item of Ready for offline's packing list (got, never got or too old, online or not, with Get the install file while online), not as an amber line under the Share nearby row nor a line on the Ready for offline card (docs/decisions/2026-11-18-sync-and-offline-one-screen.md).
