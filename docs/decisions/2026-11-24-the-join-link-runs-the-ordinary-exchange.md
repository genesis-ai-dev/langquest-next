# After a whole starting copy, the join's link runs the ordinary exchange before the person is set, and the grant carries the revocation list

Date: 2026-11-24 · By: Carl Sauder · Status: accepted

Reason: the review of 2026-11-24 found that a newcomer let in offline
started behind the phone right beside it (item 2). The starting copy is the
inviter's last checkpoint, which on a language kept on disk can be 1,999
confirmed events old, and the QR session ended straight after the copy, so
the work the inviter had pulled since, its unsent work, the teammates' work it
carried and every file stayed on the inviter's phone. If the newcomer's first
ordinary partner had a newer checkpoint, `nearbyClaimed` jumped past the gap,
and even the inviter never sent those events again; outside an organization
with `nearby_open` nothing started that next session at all. Carl took the
report's fix: on a granted QR link where both Hellos name the new ability
`join-exchange`, a whole copy is followed on the same link by steps 4 to 8
(have, holdings, events, files and library files when both say so, done),
exactly as any session runs them. The report's two-line alternative, taking a
checkpoint at the cursor before giving the copy, was not taken: a checkpoint
deletes the log behind it, so the inviter could no longer claim those events
to members who are behind (item 18), and it moves no unsent work or file.

The exchange runs before the person is set, in the same session, because
setting the person starts the app over as them (`Shell` remounts on the actor
id), which would stop the join's session and drop the link. A newcomer's
session runs on `joinOnlyPort` and `joinOnlyKeep` before the grant; after it,
`granted` answers the person's own keep, and after a whole copy the newcomer's
`exchange.open` answers its own pieces: in the app (`ownLanguage` in
`nearbyJoin.android.ts`) its language opened as the app opens it
(`appLanguagePlatform`), but idle, with no server, sync or transfer worker,
on the store the copy went into, so the session moves each file itself; its
door and signer as Look's room has them. That language is closed when the
session ends, before the person is set, and the app then opens its own.
Setting the person waits on these steps; a drop, leaving the screen or a stop
during them still sets the person, since the copy is whole. A phone that dies
during them, or an app swiped away, is covered too: the session says when the
copy is whole (`whole`), before the steps, and the app marks the person's
record (`copyWhole`, still `filling`, so `Shell` does not remount), and the
join screen's check at the next start sets the person from that mark with no
teammate. That setting the person waits on these steps was the implementer's
choice in carrying out Carl's fix, not one Carl made; the review of
2026-11-24 asked him to confirm it. While the newcomer keeps its documents and
opens its own language before its `have`, the inviter, which has given every
state part by then (it has answered the names or a document), waits a file's
time (`fileStallMs`) rather than a message's, since that work does not show on
the link. A newcomer's Hello names `join-exchange`,
`files` and `library-files` before the grant, by what its pieces will bring,
since both sides work out from the two Hellos what the session does; pieces
short of what it said, a copy that is not whole, or an older phone on either
side end the session with the copy, as before. `NEARBY_PROTOCOL` does not
change: abilities grow without a new version.

The grant also carries the Worker's revocation list as the inviter's phone
holds it (`join-grant` `revoked`, an optional field, item 11). The newcomer
checks it against the Worker's keys, checks the grant's chain against it, and
keeps it in its own keep before it asks for the copy, so from the start it
turns away a stolen phone still signed in, which it otherwise took for a
teammate until it met an honest one. A list that does not check is dropped
and counted, as a `revoked` message's is, and the join goes on; one too long
to ride with the chain goes as before, after `have`. An older newcomer
ignores the field. A newcomer whose `granted` answers no keep of the person's
(the app always answers one) holds the list for the session alone and notes
no meeting, rather than writing to `joinOnlyKeep`, which refuses and would end
the join; it then runs no steps after the copy either.

Each phone's join record says, when the steps did not follow a whole copy,
why: `exchangeOlder` (the other phone's app is older), `exchangeNoPieces` (the
newcomer's own language did not open, or came short of what its Hello said)
or `exchangeLeft` (the newcomer's person left first), so the field tells this
phone's own failure apart from an older app (decision 235 as amended). The
inviter says `exchangeOlder` only once the newcomer has ended, with `bye`
`done`, a copy it gave whole, never for a copy that dropped or one it gave
short.

Since the link now brings the guides' pictures and audio after a whole copy,
Let someone in and the new phone's progress screen say that they come the
first time the new person uses Share nearby over Wi-Fi only when none came on
the link: the session did not end done, or its library files step moved
none. While the copy comes, the progress screen says nothing of them. When
some came, neither screen says anything: any the inviter's phone did not hold
come in a later session, as for everyone.

Reverse if: the steps after the copy hold newcomers on the progress screen
long enough that they leave before the person is set, or the field's join
records (`exchangeNoPieces`, decision 235 as amended) show the idle language
failing to open on phones; then the person is set first and the exchange
moves to the first session after, which needs the inviter to stay in a room.
