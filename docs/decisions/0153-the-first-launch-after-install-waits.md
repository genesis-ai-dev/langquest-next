# 153. The first launch after install waits up to 5 seconds for the latest OTA update

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: `app.json` sets expo-updates' `fallbackToCacheTimeout` to 0, so a new
install opens on the code built into the store build, which can be weeks
older than main, and gets the latest OTA update only on its second launch.
Someone who installs the app at a workshop then meets bugs that were fixed
long ago. Raising `fallbackToCacheTimeout` would make every launch wait, and
people often open the app with no connection for months. So only the first
launch after install waits (`apps/mobile/src/shell/useFirstLaunchUpdate.ts`,
the rules in `firstLaunchModel.ts`): on a phone running the code built into
the app, with no `first-launch-update:looked` mark in its storage, the app
sets the mark, then looks for the latest OTA update and downloads it, for at
most `FIRST_LAUNCH_WAIT_MS` (5 seconds). The person sees a spinner and no
words while it waits. When the update arrives in time, the app restarts into
it once; when the phone is offline the check fails at once and the app opens
on its built-in code; when the connection is slow, the app opens at the
5-second limit and the download goes on, and the update banner offers the
restart when it is ready. The mark is set before the app looks, so a launch
killed mid-wait never waits again, and an account's deletion leaves it.
Browsers and development builds never wait. The wait is in the app's code,
so it reaches a new install only in a build whose built-in code has it: the
next new build.
Reverse if: first launches on slow connections time out often enough that
the wait only delays people (then shorten it), or expo-updates gains a
setting that waits on the first launch only (then use that instead).

Amended (2026-11-24, Carl Sauder): the app's own looks for an update, this
first-launch wait among them, do not run while the phone holds a teammate's
starting copy the server has not replaced, and once this wait is over the app
has a look of its own at each start (`useUpdateAtStart`), held the same way,
which runs only once a store build sets app.json's `checkAutomatically` to
`NEVER`; until then expo-updates looks at each start by itself, as above
(2026-11-24-a-lost-or-short-copy-is-taken-again-and-updates-wait). The first
launch after install still waits as above, and holds no copy then.
