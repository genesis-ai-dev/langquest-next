---
name: run-app
description: Launch and drive the LangQuest mobile app on the iOS simulator and the Android emulator, against the hosted database or the local one, to see a change working on a device rather than only in tests. Use when asked to run, test, screenshot or walk through the app on a simulator or emulator, to test with two accounts on two devices, or to check something offline. Covers the dev client, Metro, test accounts, Maestro and the quirks that cost time.
license: MIT
---

# Running the app on simulators

Worked out end to end on 2026-09-30 (report and block, PR #16): iOS
simulator and Android emulator, two accounts, against production. Each step
below is one that failed first.

## Ground rules

- **Several sessions share this machine.** Work in your own git worktree,
  run your own Metro on its own port, and create your own simulator. Never
  `npm run db:reset` the local database (`supabase_db_langquest-next` is
  shared); test SQL inside `begin; … rollback;` instead.
- **Secrets:** the worktree needs `.env.keys` at its root for dotenvx. Link
  it, never read it: `ln -s ../langquest-next/.env.keys .env.keys` (git
  ignores it). Remove the link when done.
- **Test accounts:** sign-up sends no confirmation email, so any address
  works. Use the developer's test accounts (their addresses are in the
  developer's own notes, never in this public repository) or invent
  `@example.org` ones. Delete them at the end from Settings, Delete account.
- **Production is real.** A note you remove stays redacted in the log for
  good. Test in a throwaway organization, not LangQuest Sample (Play's
  reviewers use it).

## Metro

From the worktree's `apps/mobile`:

```sh
CI=1 npm run start:remote -- --port 8095   # hosted database (.env.preview)
CI=1 npm start -- --dev-client --port 8095  # local database (.env.development)
```

Another session's Metro is usually on 8081; a dev client that opens on 8081
runs that session's code. Check `metro.log` for `iOS Bundled` /
`Android Bundled` to know the device loaded yours.

## iOS simulator

```sh
UDID=$(xcrun simctl create "LQ <topic>" "iPhone 17" com.apple.CoreSimulator.SimRuntime.iOS-27-0)
xcrun simctl boot $UDID
```

- **Dev client:** no build needed if another simulator has it. Find it with
  `xcrun simctl listapps <their-udid>` (bundle `com.frontierrnd.langquestnext`,
  the `.app` path under `Containers/Bundle/Application`), copy the `.app` to
  your scratch directory and `xcrun simctl install $UDID <copy>.app`. It must
  contain `EXDevLauncher.bundle`. Otherwise build: `LANG=en_US.UTF-8 npm run ios`.
  A dev client built with Xcode 27 before the scene-lifecycle plugin
  (`plugins/withSceneLifecycle.js`) stops at launch on iOS 27; check its
  Info.plist has `UIApplicationSceneManifest`, or build a new one.
  JavaScript-only changes need no new build.
- **Open on your Metro:** `xcrun simctl openurl $UDID "langquestnext://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8095"`, then tap Open.
- **Turn off password AutoFill first** (Settings, General, AutoFill &
  Passwords, AutoFill Passwords and Passkeys). Otherwise "Automatic Strong
  Password" covers both password fields and the app never gets the text, so
  Create Account stays disabled. The switch only toggles when tapped on the
  switch itself (about 85% across).
- **The dev menu** shows on first open: tap Close. Continue expands it.

## Android emulator

- **Use `LangQuest_NetTest`** (Google APIs image). The Play Store image
  `Medium_Phone_API_36.1` stays "unauthorized" to adb until someone taps the
  prompt on its screen.
- **Start it with explicit DNS**, or nothing resolves (`UnknownHostException`):
  `emulator -avd LangQuest_NetTest -no-snapshot-load -no-snapshot-save -dns-server 8.8.8.8,1.1.1.1`
- **Dev client:** `CI=1 npm run android -- --no-bundler --device LangQuest_NetTest`
  from `apps/mobile` (about 5 minutes; `--device` takes the AVD name, not
  `emulator-5554`). It prebuilds `android/`, which git ignores.
- **Open on your Metro:**
  ```sh
  adb reverse tcp:8095 tcp:8095
  adb shell am start -a android.intent.action.VIEW -d "exp+langquest-next://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8095"
  ```
  Repeat `adb reverse` after the emulator restarts.
- **Offline:** `adb shell cmd connectivity airplane-mode enable` (and `disable`).
- **The dev menu:** press Back to dismiss it, but only when it is showing;
  otherwise Back sends the app to the background.

## Driving it with Maestro

`maestro --device <udid or emulator-5554> test flow.yaml`; pass values with
`-e NAME=value` and use `${NAME}` in the flow. `takeScreenshot: shots/x`
saves under `~/.maestro/tests/<newest>/`, not next to the flow. For a quick
look: `xcrun simctl io $UDID screenshot x.png` or `adb exec-out screencap -p > x.png`.
Shrink with `sips -Z 800` before viewing.

- **Selectors are regular expressions.** Escape `? ( ) +`
  (`"Report or block someone\\+tag"`). A row's text includes its sub-line, so match
  `"Members.*"`. `index: 1` picks the second match (a footer button that
  repeats the title).
- **iOS multiline fields** don't expose their placeholder: tap by `point`.
- **The dev tools gear** sits over the top-right header button: tap the left
  part of the button by `point`.
- **Keyboard:** `hideKeyboard` works on Android; on iOS tap a static label
  instead. Footer buttons sit behind the keyboard until it hides.
- **The red dev error banner** at the bottom covers the tab bar; tap its ✕.
- `maestro --device … hierarchy` lists everything on screen, for example an
  invite code to type on the other device.

## Two accounts

1. Create the first account on one device, then Create an organization, Add
   a language (FIA template).
2. Manage, Members, Invite, Invite by QR code, pick a role, a name; read the
   code from the screen with `maestro hierarchy`.
3. On the other device: create the second account, Join with QR code, paste
   the code.

Bring the local stack up with `npm run dev:local`: `npm run db:start`, then
the web Worker on :8787 in the foreground, which Reports needs (without it
Reports says "You are offline"). Never plain `supabase start` (and whoever
owns the database resets it with `npm run db:reset`): these also run the
projection worker every minute (server Inbox rows, pushes, snapshots) and
seed the library. If another session already serves :8787, `dev:local` uses
it and returns. The iOS simulator never receives pushes. After pulling a branch that adds or renames an Edge
Function, restart the local stack (`npx supabase stop && npx supabase
start`, which keeps the database): the functions served are fixed when it
starts, and a missing one answers 404 ("non-2xx status code" in the app).

**Clear the app's data after a `db:reset`, or after pointing a dev client
at the other server** (`npm start` and `npm run start:remote`). The device
keeps its own copy of every stream in `langquest-next.db`, with how far it
has pulled. The file is named the same for every server, and the sample
org's id is the same on every seed. A reset log restarts at 1, so the
device asks for events after a number the server has not reached yet and
never hears of anything new. A member who just joined then lands on "What
brings you here?", because the device's copy of the org does not list them;
a wrong role or missing work are the same fault. Check it by comparing the
device's `cursors` table with `max(server_seq)` on the server. To clear:

- iOS simulator: quit the app, then delete `Documents/SQLite/langquest-next.db*`
  under `xcrun simctl get_app_container $UDID com.frontierrnd.langquestnext data`.
  This keeps the sign-in. Uninstalling also works, but an account made by
  joining has no password to sign back in with.
- Android: `adb shell pm clear com.frontierrnd.langquestnext` (signs out),
  then open it on your Metro again.
- Web: clear the site's data for that address (DevTools, Application,
  Storage, Clear site data).

## Checking the server

From a checkout linked to the hosted project (`npx supabase link`; the main
checkout is): `npx supabase db query --linked -o json "select …"`. Compare
secrets by hash, never print them. Staff views: `npm run moderation -- --hosted`,
`npm run diag -- --hosted`.

## Cleaning up

```sh
lsof -ti tcp:8095 | xargs kill        # your Metro only
xcrun simctl delete $UDID              # your simulator
adb emu kill                           # the emulator you started
rm .env.keys                           # the link in your worktree
```
