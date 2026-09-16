# Mobile workflow implementation

The mobile app implements the connected journey from `one-next-action.html`.
The HTML remains an isolated design reference. Mobile screens derive progress
from project events and use the existing local store and sync queue.

## Connected journey

| Step | App behavior |
| --- | --- |
| Setup | Choose a template and book, optionally attach reference content, then assign the first passage in that book. |
| My Work | Show pending work before completed work. Offer one next task. |
| Passage hub | Keep six tiles visible. Derive one yellow next action from references, relevant terms, and the selected take. |
| References | Play one available audio item per slide. Enable Next after playback finishes. |
| Terms | Record and keep one relevant term at a time. Credit existing audio across the lane glossary. |
| Passage recording | Hold to record, or enter the red voice-activated recording screen. Adjust the cutoff and pause length. |
| Keep or redo | Keep a composed take, or discard the pending run and record again. Recover saved segments after returning to the passage. |
| Questions | Browse one question set per slide and optionally attach sets before hand-off. |
| Passage notes | Record an audio note, with an optional written note. |
| Hand-off | Queue a nonempty draft locally. Distinguish queued, synced, and blocked delivery from review outcome. |

References inherit through the passage's unit ancestry. Offline blob selection
includes inherited reference audio and relevant glossary recordings from other
passages. Audio controls show when a file still needs downloading.

Reference listening completion stays on the current phone. Its key includes
organization, project, actor, lane, and passage. Changing reference content
invalidates completion. Term progress and takes come from shared project events.

The setup wizard configures the active project. It does not add project switching.
Its reference step selects existing source recordings or accepts written content.
It does not record or import new reference audio.

## Audio and recovery

Passage segments enter the durable local event log before Keep. Keep composes
those segments into a take. Redo archives a discarded composition so it does
not appear as recoverable audio on the next visit.

Recording startup and release are serialized. Stop waits for native WAV writes
and final segment delivery. Failed JavaScript file delivery offers Retry.
Cutoff and pause controls configure the native detector.

The native microphone module changes require a new development or release
build. A JavaScript reload alone does not install them.

## Remaining content and device checks

The fully oral experience needs recorded prompts in the user's language.
Existing text remains available when reference, question, or instruction audio
is missing. The current key-term model has no separate source-prompt audio
field, so term prompts display the term text.

The iOS simulator build passes. Type checks and workflow regression tests pass.
The Android native module has not been compiled in this environment. Real
microphone timing and audio routing still need device testing.

Use this device walkthrough before release:

1. Set up a book and confirm its first passage belongs to that book.
2. Finish references and return to the hub. Confirm the next action advances.
3. Record multiple terms. Confirm none are skipped as the remaining list shrinks.
4. Start voice detection. Adjust cutoff and pause length, then stop mid-phrase.
5. Replay the saved segments and confirm the last phrase and order are intact.
6. Leave before Keep and return. Confirm saved passage segments remain available.
7. Keep, optionally attach questions, and submit while offline.
8. Reconnect. Confirm queued changes to synced only after events and audio arrive.
9. Background the app during recording and test denied microphone permission.
