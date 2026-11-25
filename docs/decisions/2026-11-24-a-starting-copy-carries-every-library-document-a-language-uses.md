# A starting copy carries every library document its language uses, publishers' included, and the grant carries what the inviter's phone knows of the organization's nearby features

Date: 2026-11-24 · By: Carl Sauder · Status: accepted

Reason: a phone that joined offline must do what its inviter's does in that
language, given the same role (Carl, 2026-11-24, testing offline onboarding).
It could not. Recording a new chapter showed no FIA steps on the new phone,
because decision 242 kept publishers' documents (FIA's study guides and key
words, sources) and `study@2` out of a starting copy until Carl confirmed the
terms (answer 19). Carl has confirmed them. And it never shared while
LangQuest was open, because a phone learns that its organization has
`nearby_open` only from the server, which a phone that joined offline has
not heard. So `STARTING_COPY_FORMATS` becomes a table over every format
`LibraryDoc` has. A format added later does not compile until someone decides
on it there, and any other string is refused at run time, so the copy still
fails closed. `mayGoInStartingCopy` no longer refuses a material that says
`source` or `pattern`, and `docsThisLanguageNames` counts an item the language
chose whether the organization owns it, copied it or follows it.

What a language uses stays as narrow as before: its own events and what is
chosen for it, and what those refer to. A chain holder still cannot read
another language's template, nor anything the language does not use. The
sender still refuses any hash off the list, and the newcomer still keeps a text
only if it hashes to its name, is canonical, validates and is a format on
the table.

The join grant gains `features`: the organization's nearby features as the
inviter's phone last heard them. The newcomer keeps `nearby_open` from it
(`nearbyOpenOrgs:<profile>`) until its first contact with the server
replaces it. A grant from an older inviter has none. A newcomer phone that
cannot read the field ignores it. The field names only features this build
knows, and one of another kind is malformed. No event changes, and the
protocol range stays where it is.

The files those documents name are still left out: guide pictures and audio,
key-word audio and source audio. They come at first contact, or from Share
nearby once teammates' phones can serve them as wanted files, which is a
change of its own. So until then a new phone shows FIA's steps without their
audio or pictures.

Supersedes in part 242 (its allowlist, its material rule, and answer 19's
exclusion; its "no source audio or guide media" stands until that change).
Amends 2026-11-23-share-while-langquest-is-open, whose phone learned
`nearby_open` only online.

Reverse if: a publisher's terms forbid passing its documents from one
member's phone to another's (then that publisher's formats or items go back
off the table), or a forged inviter's word on `nearby_open` is found to
matter (then the grant's features are signed, as a certificate is).

Amended (2026-11-24, Carl Sauder): what a language uses now includes the
guides the app offers it from the rest of the organization's library
(`guidesThisLanguageOffers`: the current version of every material item, not
archived and not hidden by the language, of which only `study@1`, `study@2`
and `collection@1` count), because Carl chose "everything the app shows". The
language's own come first on the list, so a phone that can take only some
takes those. A copy no longer asks one hash at a time of a sender that can
say what it holds: a phone that says `copy-library` answers `held`, the
sorted hashes on its list that it holds, and the taker asks only for those. A
copy or session keeps at most 5,000 documents and 128 MB, so a forged
collection cannot fill a newcomer's disk. Phones walk with document heads
(format and references, `docHeadOf`), and a teammate's guide, source book or
timing goes to disk only, so FIA's 1,525 English guides (65 MB) never sit in
memory. And documents now move between any two members, not only into a
newcomer's copy: every phone serves the documents its language uses, from its
own state on any versions, to whoever passed its read gate, and asks a
teammate for those it lacks, on Share nearby and while LangQuest is open, on
Android and iPhone. Over the Bluetooth pipe a session takes 256 KB of them
and leaves the rest for the next, so events are not held up. No event
changes and the protocol range stays where it is: `held` goes only to a
phone that names the new ability. Reverse if: documents crowd out events or
files on a slow link (then a session takes them after files, or only over
Wi-Fi), or a team's phones run short of room (then offered guides wait until
a passage reads them).

Amended (2026-11-24, Carl Sauder): the files those documents name are no
longer all left out. A team's guide's pictures and audio and its key words'
audio move between teammates' phones in step 7, never in the copy
(2026-11-24-library-files-move-between-teammates-as-reference-files). FIA's
media and a source's audio still wait.

Amended (2026-11-24, Carl Sauder): after the security review of that day, a
teammate's document is at most 4 MB, the server's own limit, and every
character that comes counts against a copy's or session's bounds, kept or
not, so a teammate cannot make a phone gather gigabytes it then refuses. A
teammate whose text does not check, or runs past its bound, is asked nothing
more that session. A sender holds at most four texts part-way sent. A phone
under a cover takes only the documents its language itself names, never the
rest of the library's guides.

Amended (2026-11-24, Carl Sauder): the review of that day. The names other organizations give the followed items a language uses, in the app's language (`labels@1` sets, decision 195), go with the copy and a member's top-up from a phone that says the new ability `copy-labels`, from what the sender keeps and only for the items its list uses, and a phone asks only while what it keeps came from no server read (item 13). Once the events of a session are in, a phone works out what it lacks again, and when they named a document no ask covered, or the documents stopped at a bound, the pair is not recorded as finished and that phone's room keeps the teammate worth a session, so the two meet again in the same run, at most three times a run with one teammate (item 15). A store that cannot read or keep names gives none and the session goes on. A sender also serves the older versions of the items on its list, those the library records and those its earlier lists named, kept in `nearbyListed`, so a teammate whose organization data is behind gets the version its data names; both are still this language's own (item 17). No event changes and the protocol range stays where it is.

Amended (2026-11-24, Carl Sauder): after the review of nearby sync that day,
item 9 and P4. Carl chose that shared Bibles travel. A team whose language
recommends no Bible reads other organizations' shared ones, so the list of
documents a language uses takes, after what the language names and before
the offered guides, the shared Bibles the app lists in the team's languages
and their books; a phone under a cover takes none. A new ability,
`copy-shared`, and copy-ask part, `shared`, carry the rows behind them (at
most 200 and 512 KB), kept only while a phone's list came from no server
read, never over a row it has, at most 200 a teammate leaves in all, and
replaced by the server's next read. Below a shared Bible the list follows only
its books, numbering and timings, at most 2,000 documents in all, and a
teammate's row whose document turns out to be no Bible in the team's languages
is dropped; a teammate's document waits while the phone is short of the room
it keeps for recording (the security review of that day). This amends the
plan's "nor what other organizations share". And on the Bluetooth
pipe documents now come after the events (`docs-after-events`, both phones
must say it), as this decision's "Reverse if" foresaw: a session's first
document may be any length, each after it only within what is left of the
share, `held` counts against the share and is asked over the pipe only when
more than 16 are lacking. An event that names a document in the same session
is then covered without a second session. Reverse if: other organizations'
shared Bibles are found to fill a newcomer's share of the pipe ahead of the
team's own guides (then they come after the guides).
