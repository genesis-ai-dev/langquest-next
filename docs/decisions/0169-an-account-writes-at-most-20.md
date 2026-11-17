# 169. An account writes at most 20,000 events or 100 MB dated any one day, a person's stream holds each event once, and a language's member reads only their languages' templates

Date: 2026-10-26 · By: Carl Sauder · Status: accepted

Reason: a security audit (2026-10-26) found that decision 115 bounded each
event but not how many, so any account (sign-up is open and confirms no
email) could fill a log that never sheds an event, through `append_events`
or `record_user_event` with ids of its own choosing. 115 turned down a quota
on events per day because it would refuse a phone pushing weeks of offline
work at once; this one is counted by the day on each event's own clock, so
that work goes up when it reaches the server. Carl chose (2026-10-26):
- **The allowance.** A signed-in account writes at most 20,000 organization
  and language events, or 100 MB of their payloads, dated any one UTC day
  (`append_allowance`, `_append_allowance_refusal`, migration
  20261026200000). In the local data, v2's history included, a person's
  busiest day is about 9,300 events and 1.9 MB, and the 99th percentile
  about 1,150. A day is never earlier than the day the account was made, so
  a new account cannot date events into the past to write more: an abuser
  gets 20,000 events a day of the account's age. Only what was taken
  counts, not duplicates or refusals, and the service role's imports and
  seeds are not counted.
- **An event over it is refused on its own**, `may not emit <type>: this
  account has written 20000 events dated <day>`, which the phone keeps and
  shows (invariant 1, `NOT_ALLOWED`), and the rest of the push goes on.
  Failing the whole push, so the phone would try again, was the first
  choice, made while the allowance was counted by the day the server
  received events; counted by the event's day, an allowance that is used up
  stays used up, so a failed push would have held back that language's
  uploads for good.
- **A person's stream holds each event once.** `VisionSeen` and
  `WalkthroughDone` are kept once, with an empty payload; `TermsAccepted`
  once a version, with only the version, and at most 100 versions. A repeat
  is answered as done, so a phone that sends one again sees no error.
- **`invitecheck:` is the server's.** `redeem_invite_for` puts the person
  joining on the invite's check teams with ids that begin `invitecheck:`,
  which `_server_event_id` did not reserve, so a member who knew the
  invite's id could take one first and the person would quietly not join
  the team.
- **`library_template_users` names only the languages the caller may read**
  (`can_read_stream`), as `language_book_names` does; a language's member
  saw every language's template. Defining or publishing a library item
  takes an organization-wide role, which reads every language, so the
  app's choice between a new version and a copy (`breakup/model.ts`
  `planChange`) is the same for everyone who can make it.
- **Kept on purpose:** `register_push_token` and `diag_ingest` move a push
  token or an install id to whoever registers it. On a shared phone the next
  person must take over the phone's token when the hand-over could not
  unregister it offline, and knowing either id takes the device.
Reverse if: real work dates more than 20,000 events or 100 MB to one day
for one person (then raise the allowance, or count by language), or phones
with clocks set far back start being refused (then measure how far, and
count their events on the day received).
