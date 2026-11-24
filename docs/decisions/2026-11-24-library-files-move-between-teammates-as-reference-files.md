# A team's library files move between teammates' phones as reference files, after needed and review recordings and before backups, and a phone never passes on a file any language's recording names

Date: 2026-11-24 · By: Carl Sauder · Status: accepted

Reason: a phone that joined offline must do what its inviter's does, and
Carl asked for "all the ref material, key words, and other files that the
carrier's device has stored" (2026-11-24). The documents now come
(2026-11-24-a-starting-copy-carries-every-library-document-a-language-uses),
but not the files they name, so a team's guide showed no pictures and played
no audio until first contact. The files do not go in the starting copy: the
copy runs before the person is set, partly over Bluetooth, and as text through
JavaScript, while files move natively, one at a time, resumably and from any
teammate. So they become wanted files of step 7 between any two members, on
Share nearby and while LangQuest is open, on links that move files.

What counts is core's `libraryFilesOf`, from the documents on the language's
list that the phone holds: a team's guide's (`study@2`) step and word audio
and the phone's copy of each picture, map and illustration, as the app reads
them (`mediaFileOf`, which `guideMatch.mediaFile` now uses), and a key-word
list's audio that has no address. Only audio and picture formats, so never a
film and never a carried build's file. Not FIA's media, which documents name
only by address and a later change carries, and not a source's audio, which
waits for its own change (the source index must learn a chapter that arrives
offline).

Both phones' Hellos name a new ability, `library-files`. At step 7's start
each says which library files it holds (`lib-held`, in parts like holdings),
so neither asks in vain, and each asks for those it lacks after needed and
review recordings and before backups (Carl, 2026-11-24: small files first),
with the ordinary `file-ask` and the native hash check. A library file lands
with no nearby mark: nothing nearby deletes it, no holdings entry counts it,
and it never makes room by deleting. With less free than every file keeps,
it waits and the rest go on.

A phone serves one only if a document on its list names it, it is here, it
is not a teammate's recording marked here, and no recording of this language
or of any language kept on this phone names it (`keptIdsAnywhere` over the
`audio` rows). So a library manager, or an organization whose items are
followed, who names a recording's hash in a guide never makes a phone hand
that recording to a teammate as a library file. This replaces the plan's
record of where each library file came from: that would have kept back every
guide file a phone already held, Carl's test phones among them, and the
`audio` rows already say which files are recordings. A recording still goes
only by the rules for recordings.

No event changes and the protocol range stays where it is: an older phone
names no `library-files`, so it is sent no `lib-held` and asked for no
library file.

Amends 2026-11-24-a-starting-copy-carries-every-library-document-a-language-uses,
whose files were left out, and decision 242's "no source audio or guide
media", now true only of source audio and FIA's media.

Reverse if: a team's phones run short of room for guide files they never
open (then only the files of passages a phone keeps offline go), or a
recording reaches a teammate as a library file in some way the `audio` rows
do not see (then a phone keeps a record of where each library file came from,
as the plan first proposed).

Amended (2026-11-24, Carl Sauder): FIA's media move too, on a teammate's
word, as Carl chose. FIA's guides name their step audio, pictures, maps and
word audio only by web address, and a phone keeps them by address in its
study folder, so no hash can hold the bytes to them. Core's `libraryLinksOf`
lists the https addresses of audio and pictures a guide names, as the app
takes them along (`studyUrls`), never a film; a key-word list's audio is
played from its address and never kept, so it is not among them. A phone
lists the SHA-256 of each address it holds in `lib-held`, never the address,
and asks with `file-ask` under that key after the team's own library files
and before backups, what its kept passages need first, then the rest only
while the study folder's room for files no kept passage needs lasts, so the
folder's clearing never throws away what a teammate just gave. The bytes are
not checked against anything: they land under the address's name in the
study folder, as if downloaded, and the address is written down
(`study-files:nearby`). Once the phone is online it fetches each one again
from its address, replacing the teammate's word, and one its source refuses
goes. Reverse if: a teammate's word is found to matter, a picture or audio
passed off as FIA's (then FIA's media wait for an import that names them by
hash, as a team's guides are).

Amended (2026-11-24, Carl Sauder): a library source's chapter audio
moves too, named by hash in its `sourceBook@1` (`kind: 'source'`), but only
for chapters this phone's kept passages want and lack, exactly what its
sources' pass would download online within the sources' 1 GB share
(`sourceAudioWanted`), so never a stream-only source's and never Bible
Brain's. It comes last, after backups, as Carl chose. The pass now indexes a
chapter already in the store under its document's hash while offline too;
before, only a pass that could fetch did, so a chapter a teammate gave would
have stayed hidden. And a phone under a cover (decision 171) takes no library
file its own kept passages do not need: none of a team's guide files, which
are not known by passage, and only the FIA files and source chapters its kept
passages want. It still serves what it holds.

Amended (2026-11-24, Carl Sauder): after the security review of that day,
the `audio` rows did not see every recording, which this decision's
"Reverse if" foresaw. A redacted recording is in no plan and no row, yet its
file stays on the phone; another language's unsent recording and one not yet
in a checkpoint are in none either. So a phone now keeps a record of where
each library file came from (`LibraryFileOrigins`, a `library_files` table in
the file ledger's database): a guide file fetched from the organization's
guide files or uploaded from the guide editor, a library source's chapter
downloaded with its hash checked, or a library file taken from a teammate. It
passes on as a library file only a file in that record, and the `audio` rows
still hold back any recording besides. A file from before the record began is
passed on once it is fetched again, and Bible Brain's audio never enters it.
Files taken on a teammate's word are bounded: each at most 8 MB, all of them
not yet fetched again within the study folder's 256 MB spare room, needed or
not, and only bytes that begin as a picture or audio of the address's kind.
The address is written down before the file takes its name, so a crash
between never leaves a teammate's bytes passing as the source's.
