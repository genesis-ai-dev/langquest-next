# Dynamic Bible passages

New projects default to **Dynamic Bible passages** and Berean Standard Bible
(BSB) reference material. Existing projects keep their selected template.
Managers can choose **Content templates → Dynamic Bible passages** for an
existing language. Translators open **Bible** from My Work, choose a book,
preview a passage, and use the arrow to start translating it.

The preview includes BSB text, reference audio, and the team's key-term
shortlist. Selecting a passage creates a stable unit and self-assignment.
It does not submit a take or mark any verse translated. Existing selected
passages remain available below the next choices. A warning icon marks
overlapping selections received from another offline device; both survive.

## Passage data

The bundled [OpenBible section data](https://a.openbible.info/data/bible-section-counts.txt)
contains 12,648 observed section ranges across 20 translations. This is a
catalog of observed passages, rather than every mathematically possible range.
The count ranks common choices first. The dataset's third column is a graph
connection hint; progression uses the inclusive end verse plus one instead.
That avoids looping at the final verse of a book.

Genesis starts with these actual choices:

- Genesis 1:1–2:3: 14 translations.
- Genesis 1:1–31: four translations.
- Genesis 1:1–2: one translation.
- Genesis 1:1–2:7: one translation.

Ranges use canonical, one-based verse ordinals within each book. Selected
ranges reserve coverage. The next selection starts at the first unreserved
verse and cannot cross another selected range. If the catalog lacks a choice
at that verse, a fallback ends at the nearest following catalog boundary.
Nothing silently skips untranslated verses. Completion still comes from the
existing translation/review workflow.

The source's 3 John 1:15 maps to BSB 1:14, which combines the final greeting.
The importer validates every range against the bundled BSB verse counts.

## Key terms

All 31,102 BSB verses ship with the app. The text comes from the
[official BSB downloads](https://berean.bible/downloads.htm).
Its public-domain notice is retained in the source provenance.

Scorer version 1 combines chapter TF-IDF with the requested nesting penalty:

```text
score = log2(1 + term_word_count)
  × (1 + ln(passage_frequency))
  × (1 + ln((1189 + 1) / (chapter_document_frequency + 1)))
  × (1 - 0.9 × fraction_of_occurrences_inside_longer_terms)
```

This is an explicit initial scoring formula, not a claim to implement a
particular published C-value formula. Chapter documents avoid inflating
frequencies with overlapping pericopes. The importer precomputes corpus
statistics; the app ranks the selected passage and caches recent results.

Candidates include non-stopword single words and phrases of up to four words
that occur at least three times in the whole Bible. Phrases can contain
internal stopwords, such as “Spirit of God.” They cannot cross sentence or
verse boundaries. Nesting counts covered occurrences once, even if multiple
longer phrases contain the same occurrence.

**Reference library → Bible passage defaults** controls density for the
whole language team. At zero, the shortlist contains up to three terms.
At 100, it includes every non-stopword single word and eligible phrase.
Intermediate values choose a prefix of the same ranking, so increasing the
slider never removes a term. The default is 35.

Selecting a passage populates the language glossary with stable BSB term
identities. Renderings and recorded adjustments carry between passages.
Lowering density hides terms from passage shortlists without deleting them
or their recordings. Manually entered glossary terms retain their scopes.

This version scores BSB English text. Bible Brain selections add reference
audio; they do not silently substitute another Bible's text for term scoring.

## Audio and alignment

Barry Hays BSB narration is enabled by default. Explicit source opt-outs still
apply. Frederick Surrey BSB and MSB remain available as optional sources.
Audio streams from [OpenBible](https://openbible.com/audio/hays/); the app
does not mirror the full Bible or promise offline source-audio playback.

The importer uses the published [bsb-align dataset](https://github.com/BSB-publishing/bsb-align),
pinned to commit `bdb859afc427b215b78e12ee4a7798c32b7b91e0`.
Its word timings match the Hays recording, and never apply to other narrators.
We retain a verse span only when its text matches the bundled BSB, word times
are positive and ordered, and average alignment confidence is at least 0.65.

Validation accepts 17,049 verse spans and rejects or lacks 14,053. A passage
uses bounded playback only when every requested verse in that chapter has
valid timings. Otherwise the player says **Full chapter**. Cross-chapter
passages present one player per chapter. Playback seeks to the start and
stops at the end; timing enforcement uses the player's 100 ms status updates.
These are machine alignments, not manually certified edit boundaries.

No new whole-Bible alignment job runs in this change. The upstream pipeline
can regenerate rejected chapters; rerun our importer afterward to validate
them against this pinned text edition before changing the shipped data.

## Bible Brain

The new `bible-brain` Edge Function provides authenticated, bounded catalog
and chapter requests. Managers search by three-letter language code and
select an audio fileset. Chapter responses include timing and copyright
metadata. Missing timings use chapter playback. Signed audio links can be
refreshed; they are not persisted as durable content identifiers.

The API key belongs only in the server environment as
`BIBLE_BRAIN_ACCESS_KEY`. The sibling project's `supabase/.env` contains a
dotenvx-encrypted value. Use that project's dotenvx execution environment;
do not send the encrypted string as the API credential. Decrypted live
catalog and timestamp requests returned HTTP 200 during validation.
No key is copied into this repository or bundled into the app.

## Persistence and rollout

- `v1.BiblePassageSelected` requires `translate`. It creates canonical passage
  units, glossary terms, and an assignment to the emitting actor only.
- `v1.BibleSettingsSet` requires `manage_reference`. Settings use a
  last-writer-wins register per language lane.
- Dynamic passage identities include the lane, so another language can
  choose different boundaries without inheriting those units.
- Reducer versions invalidate caches only. Older clients retain unfamiliar
  passage events and keep syncing; new UI is needed to display the new feature.

The original migration raised a global version gate. The sync-integrity
correction removes it permanently; see [sync integrity](sync-integrity.md).
Release the backend event validators before enabling writes in new UI.
Configure the server key through the existing secret-management process.

### Rollout status — September 24, 2026

On hosted project `xymxnebdwtbkfxlbylch`, `bible-brain` and
`project-projections` are deployed. Bible Brain has its server-only API key.
The projection worker has matching Edge and Vault credentials; its separate
notification schedule remains inactive. Both endpoints reject unauthorized
requests. The local development account cannot authenticate on the hosted
project, so authenticated end-to-end verification remains pending.

Deploy the projection worker with local Docker bundling:
`supabase functions deploy project-projections`. Uploading its expanded
source with `--use-api` exceeds the API request-size limit; local bundling
successfully deploys the 2.8 MB bundle.

[Production-signed iOS build 14](https://expo.dev/accounts/rwishart/projects/langquest-next/builds/9a80dbfa-e4d6-49fc-b64a-c0f5b30cb73a)
completed from the frozen release snapshot at `/tmp/langquest-testflight-release`.
The snapshot passes 340 tests and core/mobile TypeScript checks. Four
environment-dependent integration tests remain skipped. Native project
generation, runtime fingerprint validation, bundling, and Xcode compilation
all pass. The privacy-icon plugin uses Expo's Xcode resource helpers to avoid
the missing Resources group that stopped the previous build.

The repository upload script ran with `--yes --no-cancel` and this exact build
ID. Apple accepted version **1.0.0 (14)** without upload errors on September 24,
2026. Delivery ID: `67f1eab3-0477-43f3-b006-7217849c2a80`. Apple processing and
device QA remain separate from upload acceptance.

The Bible and OBT migrations are now applied to the hosted database. Its
original minimum-client gate is superseded by the sync-integrity correction;
older clients must remain able to sync.
Live read-only checks verify valid/invalid Bible payloads and role privileges.
The separate account-privacy and translation-tools migrations are not part of
this deployment, even though the frozen native snapshot includes their current
client work. Those features need their own backend rollout before full testing.

## Refresh and verify

Run `npx tsx scripts/buildBibleData.ts` to refresh text, sections, and corpus
statistics. Review the manifest hashes and edition changes before committing.
For reproducible input, set `BSB_TEXT_FILE` and `BIBLE_PASSAGES_FILE` to local
copies. Download the pinned upstream alignment archive and run:

```sh
python3 scripts/importBibleTimings.py <alignment-archive.tar.gz>
npm test
npm run typecheck
npm run typecheck -w mobile
```

`server/bibleSmoke.sql` checks database validation and permissions inside a
rollback transaction. The migration and SQL checks run in an isolated local
database during development. Native device verification must still cover
passage playback, pause/resume, seeking, recording interruption, cross-chapter
passages, and two offline users selecting overlapping ranges.
