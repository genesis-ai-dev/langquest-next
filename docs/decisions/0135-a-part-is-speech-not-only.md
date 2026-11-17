# 135. A part is speech, not only sound out of the room: Silero VAD scores what the microphone hears on the phone and the web

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb found a loud cafe, or steady noise, boxed as parts (LAN-82,
2026-10-16): his phone boxed a steady background noise as one long part, and
with chatter around him one box swallowed the whole session. 125's splitter
knows only levels, so any sound out of the room is a part, and a cafe's room
never falls quiet enough to show where speech ends. After a research report
(Silero VAD v6 the lead option) he chose to put it in and try it. Narrows 125:
a part is now sound that is out of the room and that a speech model calls
speech; nothing else changes about where parts split or what is kept.
- **The model.** Silero VAD v6.2.3, the 16 kHz opset-15 file (1.3 MB, MIT,
  `modules/microphone-energy/models/`), scores each 32 ms as speech, 0 to 1.
  The microphone's 44.1 kHz is brought down to 16 kHz with a windowed-sinc
  filter and cut into the model's chunks (`src/speech.ts`, ported line for line
  to `Speech.kt` and `Speech.swift`, the same samples from the same sound); a
  frame's score is the surest chunk that ended in it.
- **The rules with a model** (`src/splitter.ts`, `Splitter.kt`,
  `Splitter.swift`, the same parts from the same frames and scores). A part
  starts when the level would start one and two of the last three frames
  score 0.5 or more; a frame is heard when it is out of the room and scores
  0.35 or more; a part ends on the median of the last five frames' level, or
  when the score falls under 0.35, after the pause. The room is the level a
  fifth of the last 8 s fall under, not the quietest moment; in the first
  0.6 s the room heard now replaces a quieter one remembered, when it is not
  speech; and while a part is open the room stays 10 dB under its loud end, so
  someone who reads on without pausing never becomes the room. Without a
  model (it failed to load, or a test build leaves it out) the rules are 125's
  exactly.
- **Where it runs.** ONNX Runtime: `onnxruntime-android` (Gradle) and
  `onnxruntime-objc` (CocoaPods) in the microphone module, held at 1.22.0
  because from 1.29.0 the runtime starts Microsoft's telemetry at launch (on
  Android a content provider that reads the Android ID and adds the INTERNET
  permission), which docs/play-store-declarations.md rules out; on the web
  `onnxruntime-web` 1.29.0's WebAssembly build, one thread, which has none. The
  phones ship the model in the module; the web export serves it and the
  runtime as files (`/models/`, `/ort/`), outside the JavaScript budgets.
  Every platform starts loading it when a recording screen opens
  (`prepareSpeech`), and the microphone waits for it before opening (on the web
  at most 3 s; on a slow network the model joins at the next stretch), so a
  stretch of listening is judged one way throughout.
- **Costs, measured.** Android arm64: the runtime is 18.2 MB installed, about
  6.5 MB to download (1.29.0 was 32 MB); the iPhone framework is 36.9 MB
  before linking (its share of the app not yet measured); the web fetches
  14 MB of WebAssembly and the model once, when a recording screen first opens.
  Speed on a phone is not yet measured (Silero gives 0.19 ms a chunk on one
  desktop core).
- **Measured on recordings** (real narration over simulated cafe babble and
  clinks, a fan, and a quiet room, through today's rules and the new ones,
  scratch measurements in the LAN-82 thread): in three cafes, 93 s each, today
  makes one part of everything, the new rules 15 or 16 parts with at most
  4.9 s of noise inside them, and 0.19 to 0.65 s of speech edges left outside
  a part (still in the room kept around it, so dragging the edge brings it
  back, 129). A fan or clinks alone: today one or two parts of 3.5 to 13 s,
  now none. A quiet room and 60 s of unbroken reading: the same parts as
  today. A second mix (a Yoruba reading over other readings, 98 s) agrees:
  in a cafe today makes 2 or 3 parts, the longest 59 to 71 s, the model 16,
  none over 6.8 s. In the web app, 40 s of that loud cafe gave two boxes
  over everything today and six with the model; 20 s of fan, one box and
  none.
- **Tests.** The UI tests' microphones are tones, which the model rightly
  hears as no one speaking, so their builds leave the model out
  (`NO_SPEECH_MODEL=1` in `e2e/ui-web.sh` and `e2e/web-smoke.sh`) and their
  parts are timed by level as before; unit tests hold the rules with scores,
  the resampler and chunks, and the shipped model's file and inputs. The
  phones' Maestro flows tagged `voice` play the same tone and will make no
  parts with the model; they need a recorded voice before they run again.
- **Not yet: is it the reader?** The model calls any voice speech, a talker
  at the next table too (the research found Silero marks most loud
  background speech as speech). The simulated cafe's talkers were further and
  duller than the reader and scored low; a clear nearby talker can still be
  boxed. A gate on the reader's own learned level is the next step if that
  shows in the field.
Considered: TEN VAD (smaller, but a license with conditions), WebRTC VAD
(passes noise as speech), neural noise suppression before the splitter (changes the
recording that is kept; masters stay raw), Android's VOICE_RECOGNITION
source (left for its own change), a voice gate on the reader's own level
alone (does not tell speech from a loud fan).
Reverse if: parts miss words a person said in a quiet room, the model's
scores differ by phone so parts differ, the runtime's size or the web's first
download keeps people from recording, or a later ONNX Runtime without
telemetry makes 1.22.0 worth leaving.
