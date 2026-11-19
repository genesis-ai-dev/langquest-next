# 112. Diagnostics reach us without waiting on a stuck upload, cover sign-in, recording and the server's own jobs, and stay counts and codes

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: Carl asked for an audit of what field diagnostics (39) can and
cannot see after the features added since, and for every gap it found to be
closed (2026-10-15). The worst gap was delivery itself: records went out
only after a language sync with no upload waiting, and uploads retry for
ever, so one file the server always refuses (a 413 over 50 MB, a 403 after
removal) kept every record on the phone that support most needed to hear
from; and a phone that never opened a language (no organization yet, a join
request waiting, stuck on the organization stream) never sent anything.
Now records also go when every waiting upload has failed at least once,
after a refused sync, when the organization stream settles and on sign-in.
The rest made failures that were invisible or mislabelled readable, still
within 39's rule that a record is measurements and code-written tags:
- `sync` says why work was rejected, separates a sign-in that could not be
  renewed (a rate limit, a 5xx, a captive portal: it read as offline) and
  carries an error's SQLSTATE or PostgREST code and where it failed;
- `load` says why a fold ran and splits reading from folding; `checkpoint`
  and `open` (first full pull) are new; `snapshot` says why it was fetched;
- `transfer` names its source (guide media, hand-over, streamed play, source
  audio, help, study files were untallied) and the Worker's refusals by
  meaning (401/403, 404, 413, 422), and a file gone before upload;
- `device` adds lost files (92), unsent and unrecoverable recordings, the
  oldest unsent recording, the streams and events held, and the
  diagnostics queue, including records dropped past its bound;
- `error` takes a fixed code (a recorder's `nospace`, a SQLSTATE);
- `expected` tallies per hour what `noteExpected` saw (it only logged), by
  where, class and code; `audio` tallies recording and playback per hour per
  language; `auth` records sign-in, renewal, a sign-out the person did not
  choose, invites, hand-over and the account outbox, never a name, an email,
  an invite or the other person on a shared phone.
On the server, jobs that leave nothing support can read (push delivery,
projection passes, the v2 import, webhooks, invite email, Worker errors)
write counts to `diag.job_runs` through a service-role function, and
`diag.jobs()` flags a job whose last success is too old; `npm run diag` gains
`org`, `person` and `jobs`. Messages are still never kept: they can quote
what someone typed. Turned down: accepting records before sign-in with the
public key (an abuse and privacy cost for a gap that sign-in closes), native
error codes from the microphone module (a native build; the JS side maps its
texts to codes), and a third-party tracker for the Workers (39's reasons
stand). Reverse if: the volume of `expected` or `audio` records outgrows the
5000-a-day cap per install, or Play's Data safety review reads recording and
sign-in outcomes as more than "App info and performance".
