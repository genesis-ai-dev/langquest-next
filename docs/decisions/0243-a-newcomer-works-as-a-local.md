# 243. A newcomer works as a local person with no session until first contact, which makes their account with their own id

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: a newcomer let in offline has no account, so the app runs them as a
*local person*: an actor id and no server session, one per install, kept
in `secureStorage` (`nearby-local-person`, `src/server/localPerson.android.ts`), from
asking through a whole copy to first contact, never going back a stage
(docs/nearby-sync-plan.md 14.1, step 5). The copy finishes before the
person is set, because `Shell` remounts on the actor id. `signedIn` splits
into routing and `serverSession`, an overlay of the chain's membership
(`withChainMembership`) gives real privileges at `Workspace` from the link's
signed ones and writes nothing, and their transport throws `OfflineError`
until first contact, so their events stay `pending` and reach teammates as
`nearby`. When the server answers, `useFirstContact` posts the chain,
proof of key, the id and a request id to the Worker's `POST
/api/nearby/join` (`accountFromChain`, shared with the relay, so a
teammate carrying the newcomer's work makes the same account): an id that
exists is reached only by its own `chain_key`, a deleted id is refused
(245), `pass_refusal` is asked before any Auth call, then `createUser` with
the phone's own id and `app_metadata: { managed: true, chain_key }`, the
`install_keys` row and `redeem_pass_for`. A database error answers 503,
never a refusal, and `JOIN_RATE_LIMIT` runs before any signature check. A
refusal keeps the person and their work, and someone with Invite can let
the same id in with an ordinary invite. Edge Functions cannot import core,
so this is a Worker route and `supabase/functions/join` stays as it is (59,
amended).
Reverse if: local persons strand work in the field often enough that a
shared phone or a second person per install is worth what it costs.

Amended (2026-11-08, Carl Sauder): "Remove me from this phone" is built,
under More settings for a local person in place of Sign out and Delete
account (plan 14.1, 5 "Me"), so a lasting refusal at first contact (taken,
deleted, chain, proof, a lost key) no longer leaves the phone theirs for
good. It asks first, naming what has not been sent from this phone, then
removes their discovery keys, `nearbyPeers:`, every chain and pass (each
named the install key), the install key, and last the record, so a removal
cut short can be done again; with no record the app is back at Sign In.
Their unsent events stay in the log, and push sends only the signed-in
person's own, so nothing ever goes as them.

Amended (2026-11-09, Carl Sauder): once the server answers, a newcomer whose
starting copy stopped part way is set all the same, rather than waiting for
a teammate to finish it. First contact runs only once the person is set, so
on two emulators such a person sat online on the join screen and never
reached the server. The server's first download replaces the copy anyway,
and first contact checks the chain as before, so setting them early costs
nothing but a weak link right after it, which is what anyone signing in for
the first time on one has. Offline, the copy still finishes before the
person is set (plan 14.1, 5 "Identity").

Amended (2026-11-10, Carl Sauder): Sign out waits until first contact is
over, in `joined` too, though that stage has a session (`firstContactOpen`).
A session gone in `joined` leaves the phone running as the record, so a
sign-out with the lock opened straight back into the newcomer's work with no
lock asked, and first contact joined again (pre-merge security review). Me
shows the local person's card in its place, and Sign out reached from a
scanner says the phone is finishing setting up. A join left while the
inviter decides keeps no grant, and the join's session stops with the
screen, so no local person is written once someone has signed in.
