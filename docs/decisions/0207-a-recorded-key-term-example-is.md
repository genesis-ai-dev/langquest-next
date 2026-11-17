# 207. A recorded key-term example is a way of saying the term, needs no written form, and lists the passages it was recorded in

Date: 2026-11-11 · By: Caleb Koster · Status: accepted

Reason: stages 1 and 2 of 205 (LAN-228). Stage 1 is
`v1.KeyTermAudioRenderingAdded { termId, renderingId, blobHash, durationMs,
wayId, duringTakeId? }`, the new versioned event 205 calls for: grow-only, one
entry per (term, renderingId), fill_reference like the other key-term events,
its audio a voice note (m4a unless `v1.AudioFormatSet` says otherwise, 77). The
microphone and the sharing are what voice notes already use, so the Play
answers do not change (49). A source term can be said more than one way in the
target language, depending on context, and a language may be oral only, so a
way cannot depend on written text: `wayId` names the way a clip is an example
of (repeats share it, different ways differ), and is the id of a written
rendering when the team wrote one, else an id the phone makes. A clip also names
the take being drafted when it was recorded (`duringTakeId`, as a key-term
adjustment does), so each way lists the passages it was recorded in, and a tap
opens the version in context. Nothing makes a team record before a book: a word
and its ways can be added in the key words list ahead of time, or on the word's
page as passages come. The later check accepts a take that holds any way, and
can say which. The shipped `v1.KeyTermLinked` keeps its shape.

Stage 2 is the bar: `scripts/key-term-eval.ts` (`npm run key-terms:eval`)
reports each matcher's precision and recall on a set of partner clips with known
contents (`eval/key-terms/README.md`); "always heard" and "never heard" are the
floor. The starting bar, precision and recall of 0.8 each, is a guess for the
team to confirm against the first real set; the first real set needs partner
clips.
Reverse if: the first real set shows no matcher reaching the bar on two or more
partner languages, or teams will not record examples.
