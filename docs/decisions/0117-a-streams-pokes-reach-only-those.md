# 117. A stream's pokes reach only those who may read it

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: `events_notify` broadcast each push's poke on a public Realtime
channel, `events:<org>/<stream>`, on the reasoning that a poke says only
that a stream moved. A security audit pointed out that anyone holding the
publishable key and a stream's name, and organization and language ids are
not secret, could still watch when and how much a language works. The poke
is now private: a policy on `realtime.messages` lets a signed-in person hear
a stream's channel only when `can_read_stream` says they may read it, asked
through `may_hear_stream`, which answers only for the caller (migration
20261016090000), and the phone joins with `private: true`
(`packages/sync/src/supabaseTransport.ts`). Checked on the local stack: a
member hears the poke and a stranger is refused the channel. An app from
before this change subscribes to the public channel, hears nothing, and
falls back to its poll until it updates.
Reverse if: joining private channels costs phones on weak links noticeably
more than public ones did.
