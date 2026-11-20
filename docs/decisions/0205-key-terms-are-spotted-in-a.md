# 205. Key terms are spotted in a take by matching audio to the team's recorded renderings, on the phone

Date: 2026-11-05 · By: Ryder Wishart · Status: accepted

Reason: a partner team on the 2026-11-05 call (users of Render) said a
missed key term is usually found at the consultant stage, and the draft is
redone from the start; they want the check while drafting, against key-term
recordings made before the book begins (LAN-228). The app holds key terms
per language (`KeyTermDefined`, text renderings in `KeyTermRenderingAdded`,
a manual tie in `KeyTermLinked`) and only the translator's tagging says
whether a take has one. Of the ways to detect a term automatically,
fixed-vocabulary keyword spotting (the sub-megabyte models) is ruled out:
its size comes from thousands of labelled recordings per word, and the
words are each team's target-language renderings, for which no data exists.
Speech recognition then text matching is ruled out on the phone for the
same reason, since ultra low-resource languages have no recognizer, and on
a server it would send recordings to a third party, which changes the Play
"Shared" answers (decision 49). Query-by-example is what remains and fits:
the team records each rendering two or three times, and a matcher slides
those clips over the take and reports a confidence. The term and the take
are usually spoken by the same translator or a small team, the easy case
for acoustic matching; both inputs are content-addressed blobs (decision
4), so a result keyed by take hash, rendering hash and matcher version is
derived, cached per device and recomputable, never synced as status
(PLAN.md section 4). The matcher runs in the native `microphone-energy`
module after a take is saved, not during recording. The output is a hint
("3 of 4 key terms heard"), never a gate, because renderings inflect, get
paraphrased or split across clauses; the translator's tie or dismissal
remains the record (`KeyTermLinked`) and calibrates the threshold for that
language locally. The shipped rendering event is text-only and keeps its
shape; recorded renderings are a new versioned event. Stages: the audio
rendering event, then an evaluation set from a partner language, then MFCC
features with subsequence DTW (no model to download), then a small
pretrained multilingual encoder only if that misses the bar, keeping the
DTW, cache and screen.
Reverse if: a partner language gains a usable recognizer and the organization
opts in to server transcription (then text matching can run in Aquilla and
feed the same hint), or MFCC matching is wrong often enough across speakers
that the encoder download is the cheaper cost.
