# Between teammates, text goes whole and recordings go only where a phone wants them, and a person can ask for them while offline

Date: 2026-11-25 · By: Carl Sauder · Status: accepted

Reason: partly supersedes 166 ("No download is offered offline") and
extends docs/decisions/2026-11-23-share-while-langquest-is-open.md. On
2026-11-25 Carl let a new person in offline. Their phone got the language's
text whole, but on the Map the team's recorded passages were marked as not on
the phone, and their recordings would not play. A starting copy and nearby
sync carry a language's events, state and documents whole. A recording moves
only for one of the purposes in docs/nearby-sync-plan.md 5.6: needed (the
phone's offline scope, or kept offline), open for review, library files, or
a backup of one the server has not confirmed. Confirmed recordings outside a
newcomer's scope reach no one, and 166 offered no download offline, so the
phone could not even ask for them. Sending every recording to every phone
would spend air time and battery and fill teammates' phones: recordings are
AAC at 128 kbps (`RecordingPresets.HIGH_QUALITY`), about 1 MB a minute, and a
language's run to gigabytes. Carl wanted the balance between teammates being
able to work and what moves and is kept, and chose (2026-11-25):

- **Text goes whole; recordings by want.** Every member keeps what the app
  needs to be right. A recording moves only when the phone that takes it
  wants it, in 5.6's order, so a short meeting brings what matters most.
  Nothing is pushed to a phone that did not ask.
- **The inviter picks a newcomer's first work set.** Let someone in offers an
  optional choice of what the new person will work on, a book or some
  passages. The grant carries it, and the newcomer's phone keeps those
  passages offline before the join's ordinary steps, so the join brings
  their recordings like any kept passage's. The passages around them are not
  added (Carl: not now).
- **Keep offline works offline wherever Share nearby can run.** Keeping a
  passage is a want, and 5.6 already counts a kept passage as needed, so any
  teammate's phone that holds its files brings them. The passage says that a
  teammate's phone can bring it, and once kept, that it waits for one, where
  166 said it needed a connection and offered nothing. Where Share nearby
  cannot run (the web, a phone or organization without it) 166 holds.
- **About 100 MB a teammate a session while LangQuest is open.** A quiet
  session moves at most that much of files, both ways together, most wanted
  first; the rest waits for the next meeting. Share nearby, which the person
  opened to spend the time, and a join have no limit.
- **A book that would not fit is still not kept.** Carl first chose a warning
  over a block, then kept the block on hearing why it exists: a download from
  the server is not held back when space is short, so a book that would take
  the phone under the 500 MB kept for recording is not offered
  (docs/decisions/2026-11-20-a-book-has-its-own-download-button.md). Offline
  the same rule holds.

Reverse if: newcomers still lack the recordings they need after their first
meetings (the work set too narrow, the limit too small, or wants not reaching
a teammate who holds the files), or teammates' phones fill, or their
batteries drain, from files they were asked for (the limit too large, or
chosen sets too big).

Amended (2026-11-25, Carl Sauder): a phone's new files make it meet its
teammates again. A test the same day: once the inviter's phone, online, filed
Matthew's chapter audio under the hashes a new library version named, the two
phones still read "Up to date", since the summary they advertise says nothing
of files a phone holds outside holdings, so a want could wait for a meeting
that never came. A pair's record now keeps a fingerprint of the files this
phone held as the two finished, and a different one now makes that teammate
worth another session (`filesChanged`), leaving the summary, "Up to date" and
the quiet mode's rest as they were, since teammates hold different files by
design. Left as it was, by Carl's choice: a new library version reaches a
phone only from the server or in a starting copy, because organization
changes do not travel between phones (docs/nearby-sync-plan.md 14.1).
