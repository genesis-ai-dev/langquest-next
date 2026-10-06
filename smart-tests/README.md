# Smart tests (Jev journeys)

**Status on main (2026-09-29): not yet ported.** The harness came from the
`project-is-one-language` branch. The app now loads on web (web SQLite driver,
`__langquestLog` probe, web microphone module), but:

- `world.ts` seeds that branch's model (open project in localStorage, the
  `one_check` flow, its blob upload path). Main selects by organization, so
  Jev lands where it cannot act (0 actions in every journey).
- The blob store has no web implementation (expo-file-system `Directory`
  throws in the browser); the old branch had `disk.web.ts` behind a `disk.ts`
  abstraction main does not have.
- Six journeys wait in `journeys-to-port/` for main's passage-record events.

Until then the CI journey job runs only on manual dispatch, `gate.sh` is not
wired into `npm run ship`, and `stop-hook.sh` is not in .claude/settings.json.
Wire all three back once the journeys pass.

First line of automated defense. Jev drives the web build (a test target, not
a shipped platform) through avatar journeys; outcome oracles judge only the
device event log, the device blob store and the server. Native iOS/Android
behavior is a separate gap, tested on devices.

Run: `npm run smart` (needs local Supabase up and `~/.bash_profile` exporting
`TYPESAFE_API_KEY` and `OPENROUTER_API_KEY`). It reuses the journey web server on
8091 (`SMART_PORT`) or starts one. Start it from a shell, not the preview pane:
here only a shell-started Metro picks up edits.

- `world.ts` seeds a fresh org, language and translator through the real
  server, then hands the browser a signed-in session. No sign-in screens.
  `seedSubmittedWorld` adds a reviewer and a submitted Version 1 whose audio
  is uploaded the way the app uploads it (optionally with feedback on it).
- Jev scrolls only the document; React Native web scrolls inside a view. A
  journey whose screen outgrows a phone viewport sets a tall viewport
  (`test.use`) rather than leaving controls out of Jev's reach.
- `SMART_DEBUG=n` prints Jev's last n observations and the screen 3 s after.
- `fixtures/voice.ts` writes the WAV Chrome plays as the microphone.
- `outcome.ts` holds the verdicts: `passed`, `product_failure` (the product
  was exercised and got it wrong), `inconclusive` (Jev never reached the
  action; not a pass). `outcome.test.ts` pins its false passes.
- `driver.ts` and `jev_bridge.py` are ported from aquilla/smart-tests, same
  Jev pin. Retries are off on purpose.
