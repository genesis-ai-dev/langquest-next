# 250. On Expo SDK 58, release builds shrink with R8 and keep the speech runtime's classes, and a notification that arrives while the app is open still shows nothing

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: Carl moved the app to Expo SDK 58 (React Native 0.88) on 2026-11-11,
knowing it needs a store build. Two of its new defaults would change the app
without a line of ours. Release builds now shrink with R8
(`android.enableMinifyInReleaseBuilds`); we keep that, since opting out
takes a plugin, but ONNX Runtime 1.22.0 (135) ships no keep rules and its
native library finds its Java classes by name, so a shrunk build would fail
to load the speech model and the recorder would fall back to 125's rules
without a word. The microphone module carries `-keep class ai.onnxruntime.**`
as consumer rules (`modules/microphone-energy/android/proguard-rules.pro`).
On 2026-11-11 a release build on an emulator, against the local stack,
signed in, synced and opened the recorder with both ONNX libraries loaded
and no load failure logged. The same build showed that `expo-crypto` 58.0.7
lets R8 strip its digest enums, which `docStore.ts` uses for SHA-256, so
the app takes 58.0.8, its fix, the day it came out rather than three days on (248).
And expo-notifications now shows a notification that arrives while the app
is open unless a handler says otherwise; `src/notifications/push.ts` sets one
that shows nothing, as before, so the upgrade changes nothing people see and
showing them stays a choice of its own. The rest of the move keeps
behaviour: `File.write` and `FileHandle.readBytes`/`writeBytes` became
asynchronous and the app's calls take the `*Sync` forms, refs take React
Native's instance types, `InteractionManager` gave way to `whenIdle`
(`src/ui/whenIdle.ts`), and `withSceneLifecycle.js` went, since SDK 58's
template does what it did.
Reverse if: a release build crashes or misbehaves where a development build
does not, which says R8 removed something else a library reaches by name;
or the team wants a banner for work that arrives while the app is open.
