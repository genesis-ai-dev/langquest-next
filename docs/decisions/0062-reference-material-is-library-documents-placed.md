# 62. Reference material is library documents placed by coordinates, recommended at three levels, and recorded where it was used

Date: 2026-10-05 · By: Caleb Koster · Status: accepted

Reason: translators need Bible text and audio, study guides and notes beside
the recorder, and the app had a stand-in: a dozen bundled English chapters
with simulated verse timings, two opt-in OpenBible audio editions on the old
catalog toggle, guides matched from every organization's shared material,
and no record of what anyone used (review of 2026-10-05; Genesis 1 played
nothing because no organization had turned a source on). Caleb chose
(2026-10-05): open texts and audio stored by us, Bible Brain content cached
on phones only where its `/download` endpoint allows; organization admins
recommend, language admins narrow or add for their team, translators
choose for themselves and see what works offline and what has audio;
tapping a verse jumps the audio there and plays on; the record keeps what
was offered plus what was opened or played. So: sources are library
documents (`source@1`, `sourceBook@1`), joined to their audio by
`timing@1` documents named by the recording's SHA-256 and versification, so
any text with the same verse numbers can be highlighted against any
recording; recommendations are `v1.ReferenceRecommended` (org partition)
and `v1.LaneReferenceRecommended` (language), hand placement is
`v1.PassageReferenceLinked`, and `v1.ReferencesUsed` names what was in
front of the person on a version or review (`packages/core/src/references.ts`).
Passages take coordinates from their unit ids, never labels. Bible Brain
is reached only through the web Worker, which keeps the key, caches
answers, picks filesets by testament and hands out keyless signed links; we
keep none of their content on our servers. Verse timings Bible Brain lacks
are made by fia-align (genesis-ai-dev/fia), whose model weights (Meta's
MMS, CC BY-NC 4.0) suit a free app; the job takes audio only from filesets
`/download` allows, deletes it afterwards and keeps the timings, and an
admin's app publishes the passing chapters as the source's next version.
Organizations write guides as rich as FIA's in a web editor, as `study@2`
(media by hash, callout kinds, placement by template node). The full design
is `docs/reference-material.md`. Details that follow from it: a passage's
study guides come only from what is recommended, linked to it or the
organization's own (never every shared item); a timing job never replaces
a chapter's existing timing; a Bible added from Bible Brain is the library
item `biblebrain.<bibleId>`; and an organization following one of
LangQuest's sources may ask for its timings, which the web Worker's
scheduled publisher adds to LangQuest's item for everyone who follows it
(the server writes into no other organization's library). The Worker's key
is an optional secret, so deploys never wait on it.
Reverse if: FCBH objects to our timings or to on-device caching (then their
audio plays with FCBH timings only and streams), or field teams find three
levels of recommendation confusing (then the language level goes and
translators pick from the organization's list).

Amended (2026-10-06, Carl Sauder): the three levels stand; the language
level is `v1.ReferenceSet` in the language's stream, and material or
question sets meant for every language are recommended library items,
not copies in the open language (63).
