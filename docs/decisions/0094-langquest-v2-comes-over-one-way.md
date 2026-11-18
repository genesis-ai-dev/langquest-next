# 94. LangQuest v2 comes over one way and keeps coming, by saying what each v2 project says now, and a v2 account signs in here as itself

Date: 2026-10-12 · By: Caleb Koster · Status: accepted

Reason: v2 keeps running while its users move here, so its data has to come
over and keep coming, one way only (Caleb, 2026-10-12). The first import
(PLAN.md step 8) copied a project once, put v2's languoid UUID in
`LanguageAdded`'s code (78 left that open), made each verse recording a
passage of its own, and treated a Bible project's own recordings as source
material. It could not follow v2 after that, because v2 cannot say what
changed: its `last_updated` is a phone's clock and can be days old when the
row arrives, server jobs change rows without touching it, and rows are
deleted outright. So the import reads each v2 project whole, turns it into
the facts it states now (a member, a unit, a version of a passage, a
review), and compares them with a ledger of what the import last appended
for each fact (`packages/v2-import`, `reconcile.ts`): a new fact is said, a
changed one said again, one v2 no longer has is taken back the way this
app takes things back (hidden, removed, or `v1.Redacted`), and one that
returns is said again. Event ids are the import's own (`v2:<project>:<fact>#<n>`)
and clocks come from v2, never earlier than the import's last word on the
same fact, so passes are idempotent and a pass that dies is finished by
the next; v2's timestamps only choose which projects to read, and a nightly
pass reads all of them. No event changed: v2's work arrives as ordinary
events. Where each v2 project goes is the team's choice on a board (v2 has
no organizations): a project with the Every Language platform account goes
to Every Language, the rest start with their owner's other projects, and a
project comes over only once its organization and its language are
confirmed (`docs/v2-project-languages.md`); a project that has come over
cannot change organization, since its events carry it. A Bible or FIA
chapter or passage quest becomes that passage of LangQuest's Bible (the
organization subscribes to `langquest.bible.chapters` or `.fia`), its verse
recordings one version of it with their verses (`CardVerseSet`), each later
publish a new version; votes become one Community Check per person,
back translations Back Translation reviews, and written work notes until
written translations exist. The plan, ledger, file map and passes live in
a `v2_import` schema only the service role reaches (migration
`20261013000000_v2_import.sql`), so the import is retired by dropping it.
People: a v2 account becomes the account here with the same id, so the
imported work is already theirs. When Sign In does not know an email and
password, `v2-sign-in` asks v2's own sign-in once (and signs that session
out), then makes the account with the v2 id and the same password; ten
wrong tries per email an hour are refused here, since every try reaches v2
from the same servers. An email already here under another id is not taken
over. Design in `docs/v2-import.md`.
Reverse if: v2 gets a reliable change feed (then read changes, not whole
projects), or projects routinely need to move between organizations after
coming over (then a language needs a way to move, which the log does not
have).

Amended (2026-10-12, Caleb Koster): someone who signs in with a v2 account
is welcomed back to their work (demo ADR-043; Caleb agreed to the demo's
screen, 2026-10-12). `v2-sign-in` notes the v2 projects they belong to, as
v2 lists them to that person, and `v2_welcome()` tells the phone which of
those have come over and which are still on their way. It is the one
function in the import's schema a phone may call, and it answers only for
the caller. Their first sign-in lands on Welcome back with or without an
organization here, never on "What brings you here?": until their work
arrives they keep recording in the old app, since everything recorded
there still comes over (`docs/v2-import.md` section 7).

Amended (2026-10-13, Caleb Koster): written work stays in v2 for now. A
translation or transcription hanging off a recording, and a part with words
and no audio, are not brought over (Caleb, 2026-10-13): v2 has 99 of them
in 31 active projects, about half of them tests, and written translations
in this app will want them attached to the version they came from, not as
the Back Translation reviews and notes above. They come over once written
translations exist. An FIA project's team is offered FIA's study guides in
the language it reads, else English, as New language offers them: v2's app
read FIA's guides from FIA, so without them an FIA team would have the
passages and nothing to study.

Amended (2026-10-13, Caleb Koster): a project need not have its language
linked to come over. With none chosen on the dashboard it comes over by its
name, unlinked (a `LanguageAdded` with a code made from the name, as New
language makes one, and no `LanguageCodeSet`), and its admins link it in
Next, as they can any language added unlinked (78). The dashboard's
suggestions are never linked unless someone uses one: v2's own links, which
many suggestions repeat, are often wrong.

Amended (2026-10-14, Caleb Koster): a v2 person whose email already has an
account in Next is linked to it only when someone on the team confirms it
on the dashboard (Same email, Same person). Next does not confirm emails at
sign-up, so an email match alone is no proof, and linking by it would let
anyone claim a translator's work, or an organization, by signing up with
their address first. A confirmed link makes the import name the Next
account wherever it named the v2 one, so memberships and organization
admins move to it at the next sync; work already brought over keeps its v2
author. Changes to who is in an organization are now signed by an admin the
import made there already, and so are take-backs of facts v2 no longer
states, which the import's device id could not sign.

Amended (2026-10-14, Caleb Koster): nothing v2 deletes or turns off is
taken back here ("the point of an event log is that nothing disappears").
Recordings, reviews, notes, units and members that v2 removes stay; a v2
publish without a recording becomes a new version without it, and the
earlier version stays. This replaces taking back by hiding, removing or
`v1.Redacted` above. The import takes back only its own decisions: Leave
out, a link's move, an organization admin dropped on the dashboard, and FIA
guides no longer offered. A member who leaves a v2 project keeps their
place here until an admin removes them.

Amended (2026-10-19, Carl Sauder): the scheduled passes run in the job
container behind the dashboard Worker (141), not GitHub Actions: every 15
minutes from its job tick, and the whole read at 03:15 UTC, owed until a
run starts with it, so a long pass never drops it. The switch is the
Worker's `V2_IMPORT_ENABLED` var ("true" in production, as Caleb set the
GitHub variable on 2026-10-14; "false" in preview). v2's key goes on the
Worker with `npm run secrets`, and the job refuses to start without it;
v2's read-only login is optional there as it was on GitHub, which never
had it, so people come over by id until they sign in. `npm run v2` by
hand and the board are unchanged; `scripts/v2-go-live.sh`, which gave the
workflow its secrets, is gone.

Amended (2026-10-20, Carl Sauder): a whole read resumes, and a file v2
does not have is asked for less often. A whole read records when it began
(cursor `whole`) and when one last finished (`whole_done`); one begun less
than a day ago and not finished skips the projects read since it began,
by it or by a 15-minute pass, since each of those was read whole then, so
a whole read a deploy stops (141) resumes rather than starting over. A
missing file was asked for on every pass for a week, and on 2026-10-20
the 15-minute pass asked again for some 10,000 absent files each time and
took 10 of its 15 minutes. Now one missing under an hour is asked for on
every pass, since a phone's upload can trail its rows; up to a week, only
by the whole read or a transfer someone starts for its project, so about
once a day; older, never, as before (`looksFor` in `pass.ts`).

Amended (2026-10-24, Caleb Koster): v2 audio phones may not play comes over
converted to M4A. Some Every Language teams uploaded whole chapters as MP3,
which v2 took as it was: 573 files in 33 projects, 13 of them Every
Language's, every one in v2's storage (16 are a browser's WebM). The import
read only WAV and M4A, so it wrote each down as not in v2's storage, and
Central Thai SPV, Pwo Eastern Karen and nine more came over with no audio
(Every Language noticed, 2026-10-23). Caleb chose converting over adding
MP3 to what a recording may be, since 58 keeps `wav | m4a` and the app, the
database and the API would all change. ffmpeg, installed in the job image
(141), converts in `server/audioConvert.ts`: AAC in M4A, mono, at a phone's
128 kb/s (106) or the source's rate when that is lower, and lower still if
that is what keeps it under the Worker's 50 MB. It is bit-exact, so a cloned
project's copy converts to the same hash; a copy that comes out different
is not stored there, since R2 refuses bytes that do not hash to their name,
and the log says so instead of the project stopping on every pass. A run
with no ffmpeg leaves such a file out of the file map for one that has it;
a file v2 has that is not audio is reported as unreadable, not as missing.
Migration `20261024013000` forgets the missing marks of files that were
never WAV or M4A, so the next whole read converts them.
Reverse if: teams hear what the re-encode loses, or recordings must keep
v2's own bytes; then add `mp3` to 58's formats instead.

Amended (2026-10-24, Caleb Koster): a project that has come over can come
over again into another organization, as a new language there. Every
Language asked for BIRAT RAJBANSHI, which had come over into its owners'
own organization because the Every Language account was switched off on it
in v2; Caleb: "It needs to be in the everylanguage organization." A
language still cannot move, since its events carry its organization, so
`npm run v2 -- move --project <id> --to <org>` (`v2_import_move`, migration
`20261024053000`) gives the placement the new organization and a new
language id, and records the first copy in `v2_import.moves`. The next pass
reads the project whole into the new language under a ledger scoped by that
id, so its events have ids of their own, and stores its recordings again
for it. The first copy is no longer kept up to date; once the new one is
confirmed and nothing new has appeared in the first, it is removed or made
inaccessible (Caleb). Welcome back names the new language. The board still
never moves a project that has come over.

Amended (2026-10-24, Caleb Koster): a first copy left behind is made
inaccessible by taking back every membership the import gave there, since
Next has no way to delete or archive a language. Caleb, once BIRAT
RAJBANSHI's Every Language copy was confirmed: "please make the old copy
inaccessible". `npm run v2 -- close --org <org> --language <language>`
(`close.ts`) removes the language's members, and the organization's admins
when it holds no other language, signed by one of those admins, who goes
last. It is the service role's append, which no grant rule stops, so the
organization may be left with no admin. The language, its work and its
audio stay, and the memberships can be given again. It refuses a copy the
import still keeps up to date.

Amended (2026-10-29, Caleb Koster): work from a v2 phone that was offline
for weeks waits for its audio, and audio that reaches v2 late still comes
over. A partner asked whether work made offline for weeks comes over. Two
waits of a week were counted from the wrong moment. A version waited for
its files a week from the asset's `created_at`, which is the phone's clock
when it recorded, so for a phone back after three weeks the wait was over
before its rows reached v2, and a version came over without the parts
whose audio was still going up, then again with them. And a file the
import missed was never asked for after a week, even once v2 had it, so
audio a phone sent more than a week after its rows never came over. Now
the wait counts from the segment's `uploaded_at` (v2's server clock, set
when the row arrives), and a missed file is asked for again once v2's
`audio_uploaded_at` for it is later than the miss: on the pass that sees
it arrive, and by every whole read until it is copied (`looksFor`). Only
files v2 says it has are asked for again, so the 15-minute pass does not
go back to asking for the 10,000 absent ones (amended 2026-10-20).

Amended (2026-11-11, Caleb Koster): Welcome back no longer holds someone
whose v2 work is still on its way. A v2 project comes over only once
someone confirms it on the transfer board, which can take days: one person
waited four days on Welcome back with Check again as the only way on
(LAN-250). While nothing has arrived, Welcome back also offers Continue
without it, which opens the app as it opens for anyone new ("What brings
you here?", along the existing Welcome back to home edge). It does not
mark them welcomed, so the app opens on Welcome back until their work is
here, and then says so. The waiting rows say the LangQuest team is moving
the work, not that it comes by itself. `diag.v2_person` (`npm run diag --
person`) tells support where each of a person's v2 projects stands.
