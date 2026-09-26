# Smart tests (Jev journeys)

First line of automated defense. Jev drives the web build (a test target, not
a shipped platform) through avatar journeys; outcome oracles judge only the
device event log, the device blob store and the server. Native iOS/Android
behavior is a separate gap, tested on devices.

Run: `npm run smart` (needs local Supabase up and `~/.bash_profile` exporting
`TYPESAFE_API_KEY` and `OPENROUTER_API_KEY`). It reuses the journey web server on
8091 (`SMART_PORT`) or starts one. Start it from a shell, not the preview pane:
here only a shell-started Metro picks up edits.

- `world.ts` seeds a fresh org, project and translator through the real
  server, then hands the browser a signed-in session. No sign-in screens.
- `fixtures/voice.ts` writes the WAV Chrome plays as the microphone.
- `outcome.ts` holds the verdicts: `passed`, `product_failure` (the product
  was exercised and got it wrong), `inconclusive` (Jev never reached the
  action; not a pass). `outcome.test.ts` pins its false passes.
- `driver.ts` and `jev_bridge.py` are ported from aquilla/smart-tests, same
  Jev pin. Retries are off on purpose.
