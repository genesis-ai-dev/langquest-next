# 179. Clean up runs DeepFilterNet 3 on the phone, and the person hears each part both ways before picking

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-28, thread "Choose voice protection and audio cleanup
tools") said go on Clean up with "the slider rather than the 3 buttons"
(his mockups 11 to 20). Decision 176 made the record; this is the tool and
the screens.
- **DeepFilterNet 3 on the device, never a server.** Partners record
  offline for months, so noise removal runs where the part is: an 8.6 MB
  ONNX model (`models/deepfilter.onnx`, MIT license) in the
  microphone module beside the speech model, run by the same ONNX Runtime
  (1.22.0, 135), and served at `/models` on the web, where its code is a
  chunk of its own that loads when a part is first cleaned. No new
  dependency. It took a steady hiss from −35 to under −75 dB in our tests.
- **One arithmetic, three copies.** `deepFilter.ts` (the feature
  extraction, the model's runs and the resynthesis) is ported line for
  line to Kotlin and Swift; `test/deepFilter.test.ts` holds the TypeScript,
  and the Kotlin was checked against it to the bit. A part is cleaned in
  runs of 10 seconds with 3 seconds to settle and 1 to cross-fade, so a
  long part never sits in memory whole; the part and its cleaned sound wait
  in the phone's cache as 48 kHz floats until the sheet closes.
- **The slider mixes, it does not clean again.** The sound kept is
  g·recorded + (1 − g)·cleaned with g = 10^(−limit/20): the slider's place p
  is a limit of 6·8^p dB (6 at Less, 12 where it starts, no limit at More),
  so moving it costs a mix, not a run of the model. The module hands back
  per-slice sums, so the two-tone bars (amber noise around the purple voice)
  follow the slider without reading audio. The note keeps `limitDb`.
- **Where it is.** The parts card's bin became a ⋯ with Clean up and
  Delete every part. The sheet offers the parts `mayCleanUp` allows: for one
  part, the part as recorded and the cleaned sound with Use or Not used;
  for several, the slider on top and Original or Cleaned for each. The
  button keeps every pick in one change (core `cleanUpParts`: one draft for
  all the cleaned sounds) and the undo history keeps each note
  (`PartsSnap.cleanUps`), so Undo takes the picks back and nothing asks
  "Are you sure?". A part kept as recorded wears a grey ear saying who
  tried it and when.
- **The kept file is a recording's file.** On a phone it is AAC, as parts
  are (106); a browser has no AAC encoder, so the web keeps WAV.
- The native code is new, so this ships in a store build, not an OTA
  update (the runtime is fingerprinted). The iPhone module's podspec moved
  to the module's root (`expo-module.config.json` `podspecPath`), because
  CocoaPods does not follow the `ios/models` symlink it used: the phone
  check on 2026-10-28 found the models bundle empty, in this build and in
  a dev build from 2026-10-26, so iPhones have most likely split parts by
  level alone since 135 (the speech model was missing and the module fell
  back without a word). From this build on, the bundle holds both models.
Reverse if: cleaning takes longer than people will wait on the phones we
support (2 GB Android phones, 30 parts in a passage), voices come out
damaged in languages we did not test, the 8.6 MB matters for downloads, or
people want a whole book cleaned at once.
