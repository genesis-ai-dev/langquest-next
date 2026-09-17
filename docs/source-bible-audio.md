# Source Bible audio

The passage recording view keeps source playback and recording together.
Play or pause the source, seek ten seconds, and record another part without
leaving the view. Playback pauses before microphone startup. Keep composes
all pending parts in recording order. Redo discards the pending parts and
starts a replacement recording. Existing recording recovery remains active.

In **Reference material**, an organization manager adds either source Bible:

- Berean Standard Bible (BSB), Frederick Surrey.
- Majority Standard Bible (MSB), Frederick Surrey.

Sources require explicit organization opt-in. Projects can disable an added
source. Settings use existing `v1.CatalogItemToggled` events and permissions;
no database migration is required. The app does not enable either source
on behalf of an organization.

Chapter Units, Book Overview, and FIA catalog version 1 map to the source
chapters. FIA audio covers the full chapter, including every chapter for
passages spanning a boundary. The player labels this coverage explicitly.
Custom unit ids need an explicit mapping before they can use catalog audio.
Passage reference audio and source recordings also appear beside the recorder.

## R2 trial

Eight MP3s cover Jonah 1–4 in both editions, about 14.3 MB total.

- Cloudflare account: the existing Frontier account used by invite email.
- Bucket: `langquest-source-bibles`.
- Base URL: `https://pub-e5e8108b319c42069acd1ebf4fd0fb02.r2.dev`.
- Provenance: `/manifest.json` contains source URLs, SHA-256 hashes, sizes,
  narrator, and CC0-1.0 license metadata, following the supplied license check.
- Origin: [OpenBible audio](https://openbible.com/audio/).

Jonah uses R2; other chapters use OpenBible directly. To override the R2 base,
set `EXPO_PUBLIC_SOURCE_AUDIO_BASE_URL` before bundling the app. An empty value
uses OpenBible for all chapters. R2's development endpoint is appropriate for
this trial; use a custom domain before production rollout.

Remote source audio streams and needs a network connection. It does not yet
participate in the app's durable offline blob cache. Locally saved reference
audio and target recordings keep their existing offline behavior.

Run `npx tsx scripts/mirrorSourceAudio.ts` to download and verify the bounded
pilot. Add `--upload` to upload its files and manifest to R2. The script uses
Wrangler's existing login and deletes temporary downloads after completion.

Verification covers source mapping, opt-in/opt-out, multipart recovery,
serialized audio modes, type checks, and HTTP byte-range delivery. Before
shipping a mobile update, test listen → hold → release → replay → another
part → keep on iOS and Android, plus VAD, offline playback failure, and
microphone interruption. The mobile update is not published by this change.
