# 225. Phones open sealed, and a phone shows and connects to a teammate only after hearing its own salt echoed

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: a broadcast with a fixed id, or a readable first message in a public
format, would be a certain yes that a phone runs this app, with no key
needed (plan 5.5 and 5.12). So an advert is a salt and an HMAC under the
language's discovery key, as valid version 4 UUIDs with no manufacturer or
service data, device name or transmit power; the scan response is masked
with a new `r` every tick so no mask repeats under a salt; and a rotation
changes salt and Bluetooth address together on a jittered period. Anyone
can connect to a pipe, so the opening is 80 raw bytes with no JSON, type or
version, sealed under a key from the discovery key and the responder's salt,
and a phone that has not checked the other's opening says nothing at all; a
stranger gets silence and a close at a short random deadline, and holds
nothing (`packages/sync/src/nearbyOpening.ts`, native never sees `kSess`).
An advert has no clock, so a recording of one verifies for good and,
played back elsewhere, would draw a teammate's phone to connect and so
show that it holds that team's key. So a phone that can advertise connects
only after hearing its own current or previous salt echoed in a teammate's
scan response, and shows nobody before that (`NearbyRoom`); after a while
with no echo the screen says "A teammate may be nearby" and connecting
takes a tap (Carl's answer 21), so one-way hearing does not strand a pair.
A phone that cannot advertise connects as before and keeps this risk. The
limits that remain: a live relay to a real team phone can still pass, the
form of the broadcast may tell a determined scanner the phone probably runs
this, and where a restart keeps the Bluetooth address or uses the public
one, rotation does not stop a continuous scanner. Those phones still run,
because refusing could strand a team.
Reverse if: the real-phone test finds an echo misses meetings between phone
makers, or that addresses repeat across salts on common phones (plan
section 11); then the notice on Share nearby, and this entry, say so.

Amended (2026-11-08, Carl Sauder): an echo, once heard, held for the whole
room run, so a recording made while a teammate was live drew a connection
for good (final security review). A phone now forgets every echo when its
own salt changes; a live teammate's next advert echoes again, since it
names the previous salt until it hears the new one, and a recording stops
counting once it names neither.
