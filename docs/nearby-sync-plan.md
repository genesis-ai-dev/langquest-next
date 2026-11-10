# Plan: nearby sync between phones

Status: ready to build, 2026-11-07 (Carl Sauder). Nothing is built. The purposes and the
future requirement in section 1, and the choices in section 2, are Carl's, and his answers
of 2026-11-06 and 2026-11-07 override anything older here. Everything else was checked
against the code at commit `bc1e7522` by reading it, and the second round's additions at
`eddb8297`; nothing was run. Section 5.12 is the contract that implementers code against.
Decision entries land with the phase that makes them (section 12), and everything merges
once, at the end (section 7). The security review's confirmed findings are folded in, and
what is still open is in section 13.

## 1. The goal

A team working on the same language, with no internet, can bring its phones up to date
with each other: events and audio, in both directions. Two people open a screen, the
phones find each other, and each ends up with the other's work. Reviews, requests and
recordings then move around the team as if the server were there. When any phone reaches
the internet, everything settles against the server as it does today.

Teams already work offline for a month or more (PLAN.md section 1), and today nobody sees
a teammate's work until both have been online.

Nearby sync has two purposes, in this order:

1. **Review before anyone is back online.** A teammate can review another's translation,
   and its translator can hear that review, while both are offline. This is the main
   purpose, and it decides what a phone takes first.
2. **One trip to town, and protection from a lost or crashed phone.** Every phone ends up
   holding all the team's unsent work, so any one of them can reach the internet and
   upload the whole team's work, and nothing is lost if a phone is lost or crashes (Carl,
   2026-11-06).

**A future requirement: joining offline.** A new person with a new Android phone and no
internet will need to get the app, the organization and the language from a teammate's
phone, and start work on the team (Carl, 2026-11-06). It comes after delivery (section
14). It is built on this branch as phase 6, behind a flag of its own (`nearby_join`,
section 5.10), so no team has it until staff turn it on.

## 2. Choices made

| Question | Choice |
| --- | --- |
| Which phones first? | Android with Android. iPhones come in a later phase; the protocol does not change for them. |
| Does a phone deliver a teammate's unsent work to the server? | Yes. Any one phone can upload the whole team's work. This is phase 4, and partners get the first release only with it. Keys and signatures go in from the start so that it can. |
| Which audio does a phone take? | Every recording the server does not have yet, from every phone: what this person needs first, then what they could review, then the rest. It stops only to keep 500 MB free. |
| What must the link work on? | Android phones without Google Play services, including in China, so it is our own link on Android's own APIs and not Nearby Connections. iPhones are a lower priority (section 4). |
| How does an exchange start? | Both people open Share nearby. The radios are on only while that screen is open. |
| When a phone runs short of space, may a backup go? | Yes. Files the server has and this person does not need go first, then backups, then recordings they could review. The rest are never deleted (section 5.6). |
| What are these copies called? | Nearby, for anything from a teammate's phone that the server has not confirmed. Needed and backup say why a file is kept (section 5). |
| Who gets it at the start? | It starts as experimental and off for everyone. Staff turn it on one organization at a time, beginning with a test organization. Later, an organization's admins may turn it on or off (section 5.10). |
| How do teams of three or more work? | The phones choose their own partners, and every phone ends up holding everything. Review audio goes ahead of backups across the team (section 5.11). |
| Will a new person be able to join offline? | Yes, in a later phase, on Android only, because an iPhone cannot install an app offline. The app comes from a carried APK file, built from the team's latest JavaScript. The earlier phases are shaped for it now (section 14). |

**Carl's answers of 2026-11-06.** These override the table above, the rest of this plan
and anything the readers of the code proposed.

| # | Question | Answer | Where |
| --- | --- | --- | --- |
| 1 | How does this land? | One merge at the end. Everything merges once, after one real-phone test of the whole branch. Nothing is merged by an agent. Phase 0 is not done first; the real-phone test takes its place. Certificates need a server the phones can reach, so that test needs someone's own stack, because no preview stack is deployed. | Section 7 |
| 2 | How does a phone track what a teammate has received? | A batch counter. Each phone numbers the batches it signs, and the vector records the highest number received in order, per device. Pulled events never feed it. A phone signs what is unsigned before it broadcasts a summary. Clock code and decision 15 stay as they are. Known weakness: a phone restored from a backup could reuse numbers, and teammates would skip those batches until the server has them. | Sections 5.3, 5.12 |
| 3 | How do the SQL and Kotlin get run? | A draft pull request plus a new CI job. Commit each phase on the branch and push to a draft pull request at each phase's end, so CI runs the SQL and web tests. Add a required `android-native` job scoped to the module (prebuild, compile, JUnit, lint), amending decision 150's list. Nothing merges. | Section 7 |
| 4 | What happens to work signed by a key later revoked? | Earlier work is accepted. Events dated before `revoked_at` are accepted and later ones refused, per event, in `relay_append_events`. | Section 6 |
| 5 | On a shared phone, whose unsent work may be shared? | A signed-out person's too, with the key unsealed. The install key and their certificate sit outside decision 168's seal, used only when someone signed in has opened Share nearby. Decision 168 is amended and this goes to the security review. Caleb should see it, since 168 is his entry. | Section 5.5 |
| 6 | What is in a starting copy? | State, member names and the library documents this language uses, checked by hash. No source audio or guide media. Documents from a publisher's import need a terms check that Carl has to confirm; until then they stay out of the copy. | Section 14.1 |
| 7 | What do phones below Android 10 do? | The row is disabled, with a line saying why. | Section 5.8 |
| 8 | Which roles may a join pass grant? | Only roles with no manage privilege (Translator, Reviewer, Viewer and custom roles like them). An admin can raise the role after first contact. | Section 14.1 |
| 9 | How does a pass stop? | Automatically only: past expiry or uses, inviter lost Invite or that role, role retired, inviter's key revoked. An organization that is turned off refuses new joins. There is no withdraw button. | Section 14.1 |
| 10 | How long can a key sign in? | Until the key's first session, recorded on the `install_keys` row. After that, a helper's code as for anyone. Amends decision 75. | Sections 6, 14.1 |
| 11 | What flag does joining use? | Its own feature, `nearby_join`, granted separately in `org_features`. A pass is issued only when it is on. | Sections 5.10, 14.1 |
| 12 | Where do carried APKs live? | A new R2 bucket with a token limited to it, served by a Worker route `/apk/*`. A person creates the bucket and applies the credential. Someone with `PLAY_REVIEW_KEY` should try `GET generatedApks` on an existing build first. | Section 14.4 |

**What the security review did to these answers.** Three of its fixes touch their wording,
and none reverses them. Answer 2: the vector is kept per install key, not per device, which
gives the same numbers on one install (section 5.3). Answer 4: setting a phone's date back
is enough to date its work before `revoked_at`, so the rule protects a lost phone's earlier
work and does not stop whoever took it (section 6). Answer 9: a pass also stops when its
role gains a manage privilege, which follows from answer 8 (section 14.1). All three stand.

**Carl's answers of 2026-11-07,** the second round, after the security review. These override
the table at the top of this section, the rest of this plan and anything the review proposed,
in the same way.

| # | Question | Answer | Where |
| --- | --- | --- | --- |
| 13 | Does a language's discovery key rotate? | Yes, in the first release. A one-way hash chain of generations, made lazily, at most one per language per day, when the newest is over 90 days old, or older than a removal covering the language or a revocation. A one-hop hand-on after Hello. No timed drop. | Sections 5.5, 5.12 |
| 14 | Must every phone hold every teammate's voice? | No. A per-phone switch on Share nearby, "Hold teammates' recordings": on by default, off by default on a disguised phone. With it off a phone takes needed files and a small window of open-for-review passages in `upNextOf` order, sheds outside that set once the server has a file or another person is known to hold it, and keeps the last known copy. Ready to carry says so. On every phone, whatever the row says, a backup goes when the server confirms it. | Sections 5.6, 5.8, 5.11 |
| 15 | Is Share nearby offered under a disguise? | Yes, with limits. Opening the screen does nothing, with no radios and no prompts, and a press starts it. Ten minutes, an argument from JavaScript, or "Up to date" stops it, with no listening bursts. Going to the background stops it for good, and only a new press after the code restarts it. One warning before any permission prompt. `radios.joinHotspot` is false. Code goes through a `.android` seam and the words stay in `src/disguise/i18n`. | Section 5.8 |
| 16 | How far may a revoked key's backdated events go? | 50,000 events and 100 MB per revoked key, counted one by one on the `install_keys` row, with a reason that reads as `NOT_ALLOWED`, so the row is listed with Try again. A staff function raises one row's limit. Duplicates are not counted. No closing date. | Section 6 |
| 17 | What is a pass's id? | One id per organization, language, inviter, key and 90-day window, derived by the Worker, expiring at the window's end. | Sections 5.12, 14.1 |
| 18 | May looked-after accounts hold join passes? | Yes. | Section 14.1 |
| 19 | Do publishers' documents and `study@2` go in a starting copy? | No, both stay out, and the allowlist fails closed. Carl may confirm terms later and widen it. | Section 14.1 |
| 20 | What happens to other people on a lost shared phone? | Only the named person is revoked in the first release. No third helper question. A follow-up issue goes to Caleb. The list holds pairs. | Sections 6, 13 |
| 21 | Which of the security review's changes stand? | The vector per install key, the budget per signer (70,000 rows, 50 MB), the tap where no echo came, and a QR that holds no pass or key. | Sections 5.3, 5.4, 5.8, 14.1 |
| 22 | When does `android-native` run? | Also on changes to `apps/mobile/package.json` and the lockfile, as well as the module's files. This widens answer 3. | Section 7 |
| 23 | Who may revoke a member's phone? | New password and staff only. No admin action on this branch. | Section 6 |

## 3. Why this fits the app

Most of the hard part already exists.

- **Any subset, any order.** The fold is order-independent and idempotent (invariants 2
  and 3), so a phone can fold a teammate's events without an ordering step or a merge.
  There is no merge code to write, which is what PLAN.md section 2 warns about.
- **No new events.** Nothing here adds an event type, changes the reducer or bumps
  `REDUCER_VERSION`.
- **The log already holds other people's work.** On a shared phone, each session pushes
  only its own events (decision 11, `pushNow` in `packages/sync/src/syncClient.ts`).
- **A pull already turns a copy into the real thing.** A pull upserts by id (`putOn` in
  `sqliteStore.ts`), so a copy that came from a teammate becomes `confirmed` when the
  server's version arrives. The fold's guard ignores a second copy of an id, so a copy
  that differs needs a refold (section 5.4).
- **Audio is content-addressed and checked.** A received file is hashed before it is
  trusted (PLAN.md section 14), so it does not matter which phone it came from.
- **Audio delivery nearly comes free.** The upload list is every file that is referenced,
  unconfirmed and present here (`uploadWorkOf` in `packages/core/src/blobs.ts`), whoever
  recorded it. The Worker lets any member with more than `view_status` write files in a
  language (`blob_access`). So a phone holding a teammate's recording uploads it when it
  gets online.

## 4. Transport

Bluetooth is right for finding each other and fine for events, but too slow to be the only
way to move audio.

Recordings are 128 kb/s AAC, 0.96 MB a minute (decision 106), so an hour is about 58 MB.
Reports put phone-to-phone BLE at about 20 to 70 KB/s, with no controlled benchmark behind
them. That makes one hour of one person's audio 14 to 48 minutes between one pair of
phones. A team of five recording an hour a day would never catch up comfortably. Events
are small enough for any radio.

The deciding factor is working on Android phones without Google Play services, including
in China, with iPhones a lower priority (Carl, 2026-11-06). Apps cannot rely on Play
services in China, and Nearby Connections needs them. Nothing below has been tested on
phones in China; speeds are reports, not measurements.

| Option | Needs Play services | Android to Android | With iPhones | Speed reported | Notes |
| --- | --- | --- | --- | --- | --- |
| **Bluetooth to find, Wi-Fi Direct to move** (our own link) | No, Android's own APIs | Yes, and silent to join on Android 10 and later | An iPhone joins an Android phone's group as an ordinary Wi-Fi client, after a prompt each time. One project's test failed. | 53 MB/s on 5 GHz | The mix Xiaomi, OPPO and vivo's own alliance uses (about 20 MB/s), which shows it suits their phones. We would own all of it. |
| Android local-only hotspot | No, Android's own APIs | Yes, after a system prompt to join | An iPhone joins after a prompt | 4 to 10 MB/s on 2.4 GHz | A fallback where Wi-Fi Direct fails. |
| Bluetooth alone | No | Yes | Yes | 20 to 70 KB/s | The radio every phone shares, but too slow for audio. Events can use it if Wi-Fi will not come up. |
| Wi-Fi Aware | No, but needs the phone maker's support | Only on phones that have it; no public list | iPhone 12 and later on iOS 26; developer reports are mixed | No figures found | Too uneven to rely on. Worth a look when iPhones come. |
| Google Nearby Connections | **Yes** | Yes | Wi-Fi LAN only, as reported | "High-bandwidth" per Google | Least code, but cannot be the link for phones in China. Google's open-source repository does not say it can run without Play services. |
| Huawei HMS Nearby Service | Needs HMS Core instead | Could not confirm beyond Huawei and Honor phones | Could not confirm | No figures found | One maker's service. HarmonyOS NEXT phones run no Android apps at all, so they are out whichever link we use. |
| Mutual Transmission Alliance (Xiaomi, OPPO, vivo, Samsung and others) | No | Yes, between members | No | About 20 MB/s | A system feature. No SDK for other apps found. |
| Network framework (peer-to-peer Wi-Fi) | No | No | iPhone to iPhone | Wi-Fi | Apple's replacement for MultipeerConnectivity, which it is moving people off (TN3213). Do not build on MultipeerConnectivity. |
| Bridgefy (commercial SDK) | Could not confirm | Yes | Yes | No figures found | Built for messages over a mesh. Prices are not published, its file-size limits could not be found, and its iPhone licence check needs the internet the first time. |
| A shared Wi-Fi router | No | Yes | Yes | Wi-Fi | Needs a router. A cheap extra for a team office. |
| Ditto (commercial SDK) | Unknown | Yes | Yes | Unknown | Turned down. It replaces our sync with its own store and has contract-only pricing, against decision 5. |

**Chosen for the first release: our own link on Android's own APIs** (Carl's choice,
2026-11-06). The real-phone test at the end of the branch has to prove it (section 7).

1. **Find.** Phones broadcast and scan over Bluetooth LE (section 5.12, Find).
2. **Arrange.** A short Bluetooth exchange runs the key exchange and Hello, says who
   hosts, and passes the Wi-Fi network's name and passphrase, all encrypted with the
   session's keys (section 5.12).
3. **Move.** One phone hosts a Wi-Fi Direct group, and the other joins by name and
   passphrase (`WifiP2pConfig.Builder`, Android 10 and later), then they use sockets.
   Android and the phone maker choose the band, so speed varies widely. A phone asks for 5
   GHz only when both report it, and retries with any band if that fails.
4. **If Wi-Fi will not come up.** A local-only hotspot is tried next, with a system dialog
   on the joining phone, and failing that, events still move over Bluetooth while audio
   waits.

A team can mix phones with and without Play services, and they all have to reach each
other, so using Nearby Connections on some of them would not help: every phone needs this
link anyway. It also means a factory-fresh phone no longer depends on its Play services
being up to date (section 14).

What this costs is that we own what Nearby Connections would have handled: more native
code, our own encryption (section 5.5), and the differences between phone makers. Nothing
has been tried on China-market phones. Carl chose to build the whole branch and let the
real-phone test decide (section 7), so the risk is that this native work is redone or
dropped; the model, identity and delivery work does not depend on the radio. If the link
holds up, but is much slower than Nearby Connections between phones that have Play
services, `NearbyLink` leaves room to add that later as a faster path.

Topology: the first release moves work in pairs. A phone hosts or joins one group at a
time, and moves on to its next partner by itself while the screen is open (section 5.11).
A group can hold more than one member, so the real-phone test compares pairs with one
phone hosting several at once. Since each phone passes on what it received, a few pairings
reach the whole team.

iPhones (phase 5): an iPhone has no Wi-Fi Direct API. It joins an Android phone's group as
an ordinary Wi-Fi client through `NEHotspotConfiguration`, after a prompt each time. This
is unproven: one project reports an iPhone 11 on iOS 18 failing to join a Galaxy A05s
group on 2.4 GHz. A team of only iPhones needs Network framework.

## 5. The design

One word says how a copy got here and others say why a file is kept, because one copy can
serve both purposes in section 1. These are working terms; people see "Holding N for
teammates". "Peer" is avoided throughout, because Peer Review is a real review kind
(`kindId: 'peer'`).

| Word | Means |
| --- | --- |
| **Nearby** | An event or file from a teammate's phone that the server has not confirmed. Every nearby event is folded, so it can be reviewed. |
| **Needed** | A file in a passage this person was asked to work on, worked on, or chose to keep. |
| **Open for review** | A recording nobody has checked, on the phone of someone who can review it. Nobody asked them, but the app suggests it. |
| **Backup** | Any other nearby file, kept so that this phone can carry the whole team's work, and in case the phone it came from is lost. |
| **Batch** | Up to 200 of one author's events from one device, numbered and signed once by that device's install key. |
| **Manifest** | The signed list of a batch's event ids and digests. Any subset of a batch can be checked against it. |
| **Vector** | Per stream and per signer's install key, which batch numbers this phone counts as received (section 5.3). |
| **Generation** | One discovery key of a language. An older one can be worked out from a newer one, and never the reverse (section 5.5). |
| **Bound id** | An id that names its author, `by:<actorId>:<random>`, so that nobody else can take it (section 5.4). |
| **Attestation** | The Worker's signature on what the server holds, which lets a phone pass on what it only pulled (section 5.12). |
| **Newcomer** | Someone whose phone joined offline and who has no account on the server yet (section 14). |
| **Join pass** | A signed document that lets a person with Invite bring in a newcomer offline (section 14). |
| **Starting copy** | The organization and language state a newcomer's phone gets from a teammate's, which the server's first download later replaces (section 14). |

### 5.1 A nearby phone is not a server

A nearby phone is not a `Transport`. A `Transport` assigns `serverSeq` and confirms; a
nearby phone can do neither. Three rules follow, and they keep every existing server rule
true:

1. **Only the server moves a cursor.** A nearby phone never advances `cursor`.
2. **Only the server confirms.** A nearby event is never `confirmed`, and a nearby file
   never makes `isStored` true.
3. **Nothing a nearby phone says can delete anything.** Server-only events are refused
   from nearby phones. `privilegeFor` returns null for `v1.BlobStored`,
   `v1.BlobInvalidated`, `v1.InviteIssued`, `v1.InviteRedeemed` and `v1.JoinDecided`.
   `v1.Redacted` and `v1.ExternalValueSet` have ordinary privileges, so the door, the
   sender and the relay refuse them by name (sections 5.4 and 6). So a nearby phone cannot
   get a file evicted, delete a teammate's work or write a third-party value to the team's
   fold. The one exception is a phone whose person turned off "Hold teammates' recordings":
   a teammate's holdings entry can lead it to shed a teammate's file it chose not to keep
   (section 5.6). Its own work carries no mark, so that never goes.

A newcomer's starting copy keeps these rules: its cursor stays at 0 until the server moves
it (section 14).

### 5.2 A fourth status: `nearby`

`LocalEventStatus` (`packages/core/src/events.ts`) gains `nearby`: an event from a
teammate's phone that this phone holds and folds, and that the server has not confirmed to
this phone. `status` is a plain text column with no check, so it needs no migration, and
invariant 7 holds. Two other things do need one, and `SqliteStore.open` has no alter step
yet: a `via` column, which says how a row got here, and a `nearby_batches` table, which
holds manifests (section 5.12, The store). The pragma read that is already in `open`
guards the alter.

Why not reuse `pending` with another person's `actorId`, as a shared phone does:
`pendingStreamsBy` and the courier (decision 60) would send it as its author when that
person signs in here, which would launder a forged event. The same door exists through
retry, so `requeue` leaves out any row with a `via` (section 5.4).

Nearby rows do cost what pending rows cost: while any exists, `takeCheckpoint` takes the
slow path, and memory does not shed. Section 5.4 and the village scenario in section 8
deal with that.

The store's status queries then behave correctly for events. Push, the sync icon's number
and the sign-out check read `status = 'pending'`, so they ignore nearby events. The fold
reads `status <> 'rejected'`, so it includes them. Three things are not status queries and
need their own rule:

- **The sign-out check also counts files.** `pendingUp` comes from `uploadWorkOf`, and
  `unsent()` becomes a person's `HandOver.uploads`, so teammates' files would hold their
  session on the phone and go up as them. Files marked nearby are left out of both
  (`apps/mobile/src/account/useUnsent.ts`, `languageSession.ts`), and wait for the next
  session on the phone.
- **Refusals are counted per stream, not per person.** A teammate's refused copy is listed
  on the Sync screen but does not drive the indicator (`syncStanding.ts`).
- **`count` now includes nearby rows.** `SyncInspection` gains a nearby count, and the
  fleet's `caughtUp` requires it to be zero.

### 5.3 What a phone sends

Each phone numbers the batches it signs, per stream (Carl's answer, 2026-11-06). The
vector records, per stream and per signer's install key, which numbers this phone counts
as received: a mark, everything at or below it, and a short list of ranges above it. One
key per install gives the same numbers as one entry per device. It is keyed by the key
because a `deviceId` is only a label the caller chose (section 5.5), so a number speaks
only for the key that signed it. The vector lives in device meta, is written in the same
commit as the events it counts, and outlives pruning.

- **Only a verified manifest moves an entry.** Pulled events and claims never do, and
  neither do clocks, Have or anything else unsigned. A plain clock vector cannot work:
  `restamp` moves a device's clock backwards, and a shared phone pushes one device's
  events out of clock order, so a clock entry can claim an event that is on neither side.
  A batch number has neither problem, so clock code and decision 15 stay as they are.
- **A number counts only when its batch is whole.** Each id in the manifest is here under
  the manifest's digest, or here under a later batch of the same signer (a restamp), or
  redacted here, or arrived on a page with a matching digest and this phone's door refused
  it for good, or the sweep found it on the server. A digest mismatch never counts. If any
  id is missing, the rows are still kept and folded, the number stays open, and every
  later partner sends the batch again, with known ids dropping out. That re-send is the
  asking, so there is no ask message and no table of missing ids. So a teammate cannot
  close a number by leaving events out, and a phone holding part of a batch can pass on
  what it holds without closing it for the next phone.
- **Gaps stay open.** A sender sends every batch it holds that the receiver has not
  counted, lowest number first, and a receiver records a number above a gap in its ranges.
  A gap costs one range and no re-sends. An entry that is too low is always safe, because
  it costs only bytes.
- **A signed floor closes gaps.** Each manifest carries `floor`: the signer's own word that
  no batch of its at or below that number has a row still pending or nearby on its phone,
  because the server has them or a restamp moved them. A receiver sets `mark = max(mark,
  floor)`, and a signer can hurt only its own entry. When a sync moves the floor,
  `signUnsigned` signs a batch with no events to carry it, and each phone keeps each
  signer's newest manifest after its rows go, so the floor travels on. If an author's phone
  is lost the gap stays open, which costs extra sessions and nothing else. The five-in-a-
  room scenario measures that cost after a trip to town, because summaries differ while a
  gap is open.
- **Signing comes first.** A phone signs what is unsigned before it broadcasts a summary.
  A restamped row loses its signature and goes in a later batch.
- **A phone's own count is its own.** `n` comes from a counter kept for this key, never
  from a number a teammate sent. It moves at signing, and when a teammate returns a
  manifest this phone's own key signed. Signing refuses an unsafe `n`.
- **Known weakness.** A phone restored from a backup could reuse numbers, and teammates
  would skip those batches until the server has them. Those events are not lost, because
  they are still pending on the phone that wrote them. The install key is not backed up
  (`configureAndroidBackup`), so a restored phone should have a new key and count from 1
  under it, which closes this. Nothing has tested that on a phone.

A session runs in this order, over any `NearbyLink`. Section 5.12 gives its messages, in
eight finer steps, and "step" there means those.

1. **Open.** A sealed key exchange, in which the initiator speaks first and a phone that
   cannot prove it holds the key gets silence (section 5.12, Session keys). Then Hello, the
   initiator first, unless it connected under an older generation (section 5.12,
   Generations): the range of protocol versions this phone speaks, what it can do, its
   `REDUCER_VERSION` and `LINES_VERSION`, its wall clock, its certificate for this
   organization and proof of key (section 5.5). The session uses the newest
   version both speak, and new abilities can be added to what a phone can do without a new
   version. Phones keep speaking old versions while any supported store build uses them,
   because a phone with no internet cannot update. If two ranges do not overlap, the
   message says to get a newer app from a teammate as well as from the store.
2. **Arrange.** Over Bluetooth only: who hosts, the Wi-Fi network to join, and any newer
   discovery key to hand on (section 5.12, Generations).
3. **Have.** The open language, the phone's `cursor`, the highest server sequence it has
   been told of, its vector and how new its holdings are (section 5.11). Then whichever
   holdings are newer pass across.
4. **Events.** Each side sends each batch the other has not counted as one page, lowest
   number first per signer (invariant 12). Each page commits in one transaction, as a pull
   page does, and one page is one batch, so one signature is checked per page. A dropped
   link resumes from the vector. Then it sends attested claims for what it only pulled
   (section 5.5).
5. **Files.** With the new fold in place, each side asks for the files it wants, which with
   "Hold teammates' recordings" off is fewer (section 5.6). Backups can be cut short if a teammate is
   waiting, and go on at a later pairing (section 5.11). A Bluetooth link stops before
   this step.
6. **Done.** Each side sends its final holdings and summary, and both show what came
   across.

The sender skips rejected rows, redacted events and files only they reference, and
server-only events. It also skips a confirmed row at or below the other's `cursor`, or a
phone whose language came from a server snapshot would be sent its whole unpruned log:
adopting a snapshot writes no events and no vector. A phone can send only what is still in
its log. Older confirmed events were pruned into its checkpoint and arrive from the server
later. That is safe: unconfirmed events are never pruned. When it happens the sender says
so in its last events message, and the screen says older work will come from the server.

### 5.4 Taking events in

`SyncClient.receiveNearby(page)` runs under `exclusive`, one page at a time, and takes
only part of the pull's path: apply, lines, revision and one commit. It does not take
`fill.beforeFold`, which calls the server and throws offline; the redaction branch; the
membership retry; or the checkpoint-as-it-goes. It never touches the cursor. The link is
never awaited inside `exclusive`, because a stalled radio there would stop sync, refold
and fill for that language.

An event must pass a door in core (`nearbyDoor`, `packages/core/src/nearbyDoor.ts`). It
holds the same rules as the server, and some stricter ones. `validateEvent`,
`eventSizeError`, `privilegeFor` and `privilegesFor` are not the whole rule set, because
`append_events` and `may_emit` hold rules with no TypeScript twin today. The door takes
what a person may do from one lookup, `NearbyPeople`, which reads this phone's
organization fold, and can also read a certificate or a newcomer's chain without the door
changing. Rows on disk are pre-read per page into `DoorFacts`, since the door is pure. Each
fact reads the log, then `kept_rows` by primary key, then the shared state, so an event
pruned into a checkpoint still answers. `entityTaken` stays a boolean. A passage not filled
in passes with no retry, because nothing reads it until the server is reached, and delivery
settles it first.

```ts
interface NearbyPeople {
  privilegesIn(profileId: string, languageId: string): ReadonlySet<Privilege>;
  languageListed(languageId: string): boolean;
}
interface DoorFacts {
  entityTaken(key: string): boolean;
  reviewAuthor(id: string): string | undefined;
  noteAuthor(id: string): string | undefined;
  departureType(id: string): string | undefined;
}
function nearbyDoor(e: AnyEvent, ctx: { orgId: string; languageId: string; people: NearbyPeople; facts: DoorFacts;
  claim?: boolean /* a row under a valid attestation: step 6 need not bind it, and steps 9 to 11 are skipped */ }):
  { reason: string; retry: boolean } | null;
```

Checks run in this order. `retry: true` means a reason that can change.

1. `nearbyPayloadError`: an iterative walk that refuses depth over 32, any string or key
   holding U+0000 or a lone surrogate, and non-finite numbers. Stricter than SQL on
   purpose: `canonicalJson` and `stable` recurse, and Postgres is believed to
   fail a whole relay page on one such event.
2. `validateEvent`. It must come early because `privilegeFor` reads payload fields and
   throws on a null payload.
3. `eventSizeError`.
4. `orgId` equals the session's and is not `PERSON_ORG`; `streamId` equals the open
   language and is not `ORG_STREAM`. `events.id` is unique across streams, so this also
   stops a row planted in one stream under an id the server later sends in another.
5. `isHlc` (`^\d{15}:\d{6}:[^:]+$`), and `decodeHlc(hlc).nodeId === deviceId`. Today a
   clock with too few parts throws and one like `x1:y:z` gives NaN.
6. `isServerEventId`, the twin of SQL's `_server_event_id`, and `idAuthor`: the event's id
   and the id a create makes must be bound, and bound to `actorId` (Bound ids, below). A
   claim need not be bound, because the server already holds those ids.
7. Any type in `ORG_EVENT_TYPES`, plus `v1.Redacted` and `v1.ExternalValueSet`, by name.
8. A type that is not an own property of `EVENT_PRIVILEGE` returns null: kept and passed
   on, as a pull would keep it. `EVENT_PRIVILEGE[type]` on an unknown type is undefined
   and `privilegeAllows` would throw, so this uses `hasOwnProperty.call`. When
   `REDUCER_VERSION` changes, the door runs again over nearby rows.
9. `privilegeAllows(privilegeFor(e), people.privilegesIn(actorId, language))`, which
   covers null and `bootstrap`. It says `retry: true`, because this phone's fold may be
   older, unless the privilege is null or `bootstrap`, which no fold changes.
10. `may_emit`'s look-ups: `v1.DepartureUndone` of an override needs
    `override_checkpoints`, and `v1.ReviewWithdrawn` and `v1.NoteWithdrawn` come only from
    the target's author. An unknown target passes, because arrival order is free here,
    unless its bound id names someone else, which is refused for good. A target that lands
    later runs this step again (traps, below).
11. `languageListed`, with `retry: true`.
12. `entityKeyOf` and `facts.entityTaken`.

Not held, on purpose: clock ahead (a trap below), `_grant_refusal` (organization stream
only), `_append_allowance_refusal` (the relay holds it, and a phone has a budget per signer
instead, below), and `require_client_version`. That one is a server setting no offline
phone can read, and Hello's `protocol` range is a separate number that only decides whether
two phones can talk. It gates whoever calls the server, as in a push, and says nothing
about who wrote an event (section 6). For a batch the caller rule is that the signer's
chain names the event's `actorId` and `deviceId`, which replaces "actorId does not match
the caller". The `deviceId` there is a label for the clock check and proves nothing.

**Bound ids.** Nearby hands teammates event ids and entity ids before the server has seen
them, and the server gives an id to whoever arrives first. So a teammate could push their
own events under Sam's ids, or sign a batch holding them. Sam's real event would then be
refused for good, the pull would overwrite his row with theirs, and nobody would see a
refusal. New builds mint ids that name their author: `by:<actorId>:<random>`, a marker no
build has used. A bare actor prefix would not do, because today's event ids are already
`<uuid>:<n>` and the server could not tell them from it.

- **Minting.** `commandId` comes from one core helper, `newCommandId(actorId)`, held by a
  lint rule over the command sites, so event ids (`<commandId>:<n>`) and `take:`,
  `review:`, `note:`, `req:`, `dep:`, `rendering:` and `adjustment:` ids inherit it.
  `SyncClient.append`'s default id binds too. Specs that set their own id
  (`draftSpecsFor`) get looked at one by one. A recording id is bound when its event is
  written, for whoever is signed in then, because the recorder's journal is per phone and
  `recoverRecordings` may run for someone else, and `hasRecording` still finds a copy
  written under another name. This adds about 40 characters to an id, and the longest
  stays under the 256 limit.
- **The rule.** `idAuthor(id)` in core has a SQL twin and a parity block. An event id, or
  the id a create makes, that carries `by:<x>:` with `x` not the event's `actorId` is
  refused. For `rendering:` and `adjustment:` keys it reads the part after the term, which
  is shared by design (decision 75). The rule is in the door and in `append_events`, for
  callers only, after "actorId does not match caller" and before the id lookup, with a
  reason starting `malformed envelope`, so it reads as `INVALID`. `by:` is reserved from
  that migration on. Any other id behaves as today, so old builds keep their results
  (decision 152). This is the one change to `append_events` in this plan.
- **Nearby.** A batch event must be bound, or the door refuses it. `signUnsigned` leaves an
  unbound row out and counts it for the screen, so a missed site costs sharing, not
  integrity, and a test drives every `Commands` method and asserts the result can be
  signed. Rows made before this build stay unsigned until pushed.
- **Guards.** `known_events` also returns `actor_id`, and the sweep rejects a batch row
  under another author (section 5.7). A test holds that a pull cannot replace a pending
  bound row with another actor's event, since bound ids make that unreachable.
- **Known limits, for the security review.** `audioformat:<hash>` is a content address and
  cannot be bound, so a teammate can label one voice note first (earliest clock wins), and
  that note may get a wrong label. No recording event is lost. Take ids reach apps through
  the agent API, and would now show their author's profile id.

**A budget per signer.** Every phone keeps what it takes, these rows cannot be pruned until
they settle, and every load folds them, so one member's flood of valid events could stop a
language opening on every phone. `receiveNearby` checks a budget right after parsing a
manifest, before the chain and signature work. It sits outside the door, which runs again
over rows already counted on a `REDUCER_VERSION` change and would miss unknown types. Batch
rows count against the manifest's actor, and claims against the claimer, never the event's
author, because a teammate must not be able to spend Sam's budget. From phase 6, two-link
authors share one bucket per `passId`, read from the chain kept with each batch
(`passIdOfChain`), since one inviter can mint authors offline. That bucket counts their rows,
bytes and manifest text, bare manifests included, which a member's do not spend; a newcomer
key that would make more than the pass's `maxUses` newcomers held under it is dropped as over
budget; and a bare manifest from someone this phone no longer lets in (removed, or let in by an
inviter since revoked or removed) is counted but not kept, so it does not spread. The vector
takes no new key past `NEARBY_VECTOR_MAX_KEYS` (`countBatch`, `applyFloor`), so a flood of
signers cannot push the stored vector past what `parseVector` reads back. An
over-budget page is dropped and its number stays open, so nothing is skipped and the work
stays on its author's phone, and after a few dozen dropped pages in one session the phone
sends `bye` with `busy`. Counting is one grouped query at session start over `status =
'nearby'` (`json_extract` of actor and claimer, `count(*)`, `sum(length(json))`), then added
to in memory, with no new table. The numbers are Carl's (answer 21), from decision 169:
70,000 rows (the 99th percentile day, 1,150, times 60 days offline) and 50 MB, as arguments
from JavaScript. So "every phone takes everything" means room and budget allowing, and for
files the row in section 5.6, and any one phone carrying the team's work holds only for
authors within budget. Read the village
scenario with one member at the budget before phase 3. If those numbers do not fit a 2 GB
phone they go back to Carl, and are not lowered quietly. A runaway bug on an honest phone is
stopped the same way, so the screen's words accuse nobody (section 5.8).

Traps in today's code, each of which needs a test:

| Where | What goes wrong | Rule |
| --- | --- | --- |
| `takeCheckpoint`, fast path; `loadUnits` | The fast path assumes "nothing pending" means the live state is the confirmed fold. A nearby event would be saved into a confirmed checkpoint and become permanent. `loadUnits` reads the same count, so with nearby rows it reruns a whole slow checkpoint every time. | Both use `unconfirmedCount`. The slow path's `confirmedOnly` already leaves nearby rows out. This is safe against rollback only because nearby rows first appear with a native build whose fingerprint keeps older JavaScript off it. |
| `KeptLanguage.split` on the slow path (existing bug) | It reads priors only for passages not `ready`, but the slow path hands it a fold of checkpoint plus confirmed tail, so a passage open on screen has its row overwritten by the tail's value alone. Today this needs pending work across 2,000 pulled events; nearby rows make the slow path normal. | Fix it first, from a failing test: an option reads priors for every placed entry. |
| `putOn` upsert | It overwrites status, so a nearby copy could downgrade a `confirmed`, `pending` or `rejected` row. | `WriteBatch.receive` writes only ids this phone does not have (`on conflict do nothing`). Pulling still overwrites, and clears `via`. |
| `foldLog` `after` filter | A copy with a `serverSeq` at or below the checkpoint is skipped on refold. | `receiveNearby` removes the field by destructuring, because an `undefined` property survives in `MemoryStore`. A sender's claim goes in `via`. |
| `clock.receive` on pull | The server bounds clocks to 5 minutes ahead; nearby phones do not, and field phones often have wrong dates. A bad clock would spread to the whole team. | Receive a nearby phone's clock only when `clockCloseEnough` says it is within 5 minutes of this phone's (`CLOCK_AHEAD_TOLERANCE_MS`), written so that NaN fails. Still accept the event. Warn both people if their clocks differ by more, from Hello's `wallMs`. |
| A far-ahead stamp | M signs events stamped 2035. They pass, spread and win every latest-wins register M's role may write until 2035, and `CLOCK_AHEAD` alone would never settle them. | The door still takes them: its only baseline, `max(wall, last hlc)`, is itself often wrong, and refusing would hold back honest work offline, against purpose 1. `receiveNearby` compares each page's newest stamp with that baseline, and if far ahead, Share nearby and Sync show one line naming the author. The relay settles them (section 6). An offline phone keeps such a stamp until it first syncs: accepted, and the decision entry says so. |
| Malformed clocks at the pull (existing bug, any member can use it today) | `append_events` only strips non-digits from the wall. An hlc of `123` makes `decodeHlc` throw at `syncClient.ts:1529`, so every phone in that language fails every pull. `x1:y:z` gives NaN, and `clockMeta` persists it. | Fix it first, as its own commit and issue: `isHlc` at the pull, and a server-side format check that does not change `append_events`' results for old builds. |
| `restamp` (`CLOCK_AHEAD`) | The event keeps its id and gets a new `hlc`, so the guard in `apply` ignores the server's copy and the fold keeps the old clock. Comparing `hlc` is not enough: a copy can match in `hlc` and differ in payload. | A pull page batch-reads its ids (`getMany`) and refolds if a local row differs under `sameEventBytes`, which compares the whole envelope less `serverSeq`. Only a phone holding nearby rows, or that has ever restamped, reads at all, so others pay nothing. A restamp also clears `via`, since the old digest no longer matches. |
| Pull's redaction handling | It assumes a target it cannot find is inside the checkpoint. A nearby target has no seq, so it reads as in the log, and the refold removes it, which is right. | No change there. In the first release, redactions take effect only from the server: `privilegeFor` would let an admin's through, and the fold would apply it, so door and sender refuse it by name. |
| `requeue` and `retryRejected` | A rejected nearby row naming this actor passes `requeue`'s filter, because its reason reads as `UNKNOWN`, so pressing retry would put a forged event in `pending` and push it as them. | `requeue` leaves out rows with `via`. Try again on the Sync screen runs the door again and moves those back to `nearby`, never to `pending`. |
| `isOnline` on `TransferWorker` | Workers attempt nothing offline. | The nearby worker has its own: link up. |
| Upload list for `view_status` members | They now can hold unconfirmed files, and `blob_access` refuses them forever, so they retry forever. | `LanguageSession` takes `mayUpload` (core `mayWriteFiles`). Phase 4 lifts it for files an accepted event names (section 6). |
| `lostFilesView` (decision 92) | A lost backup would say "record this again" about someone else's recording. | `lostFilesOf` takes the nearby marks, so only the person's own files count as unsent there. A shared phone's unmarked files still count. |
| An undo or withdrawal that lands before its target | `earliestUndo` keeps a backdated entry and `withdrawnBy` ignores it, so the author's real withdrawal can no longer take the slot, and an undo counts for an override it could not have undone. | Step 10 refuses a bound target naming someone else at once. For an unbound one, when a review, note or departure lands and the fold's undo slot (`undoneDepartures`, `withdrawnReviews`, `withdrawnNotes`) already holds its id, `receiveNearby` runs step 10 again over nearby rows naming it, marks refused ones `rejected` and refolds, in the same commit. Ordinary pages pay nothing. The server's half is in section 6. |
| A dropped copy (section 5.7) | `foldLocal` marks lines owed only for events in the log and for rejected rows, so a removed leftover leaves its passage's line worked out from the old copy. | Call `lines.touched` on dropped events before refolding. |
| A passage not filled in | `touchedAt` only queues these, and `isLoaded` stays false, so a nearby review changes no line and the screen says the passage is not here. Filling needs the server. | In this release a phone mid-download cannot review an unfilled passage. Allowing it is a later, small change. |
| A pruned event coming back | With pulls not feeding the vector, a phone back from town gets an event again from a teammate who holds it as nearby. The guard no longer knows that id. | The fold tolerates it (invariant 3), and redactions hold through `state.redactions`. The row sits as nearby until the next sweep, blocks the fast path offline and inflates the count. Accepted, and tested. |
| Memory on a kept language | Decision 143's bound assumes checkpoints shed. Nearby entries stay in memory until settled, every load folds them, and "every phone takes everything" multiplies this by team size over a month. They must not shed without audio rows, because `LanguageFiles.plan` finds their files only through memory. | Read `load` and `foldMs` on the village scenario before phase 3 (section 7), with one member at the budget above. Read 2026-11-07 (`villageMonth`, seed 1, 5 phones, 300 passages, 30 days; Node on the build machine, not a phone): without that member each phone held about 1,830 nearby rows and its app opened in 29 to 45 ms. With one member's notes at 68,000 rows (70,302 unconfirmed rows on every phone, 42.7 MB of event JSON, a fold of 42 MB as JSON) it opened in 6.2 to 6.4 s, `foldMs` all of it, kept and memory phones alike, and one sync in town took 48.7 s of CPU. The fleet's `MemoryStore` sorts the whole stream for each page it reads, which inflates those two; the same 70,300 rows on the app's SQLite store open in 1.03 s, against 0.55 s for `foldLanguage` alone. A 2 GB phone running Hermes is slower than this machine by a factor nobody has measured here, so a phone would wait several seconds on every open for the month, and hold a fold of that size in memory, on every phone in the team. These numbers go to Carl (decision 210); the budget is not lowered. |

### 5.5 Who to trust

There is no server to ask, so identity is arranged while online. A newcomer's is arranged
through someone whose identity already was (section 14).

- **One key per install, one certificate per person and organization.** The phone makes
  its own Ed25519 key the first time someone on it belongs to an organization that has
  nearby sync on (section 5.10). For each such organization the Worker signs a certificate
  binding the key to that person and device and naming that organization alone, valid for
  a year and refreshed once a day or on a membership change. Hello, batches and a join
  grant carry only the session's organization's certificate, because they rest in plain
  SQLite on every teammate's phone, and a person's other organizations are no teammate's
  business (`_org` is members only). One install key stays, so two organizations' phones
  can still be matched on profile id, device id and that key. The first two already can
  today, and more would need separate accounts. The public half of the Worker's key ships
  in the app's public settings, as a list with key ids so that it can rotate. Until phase
  5, key making and the certificate call are Android only, behind `.android` files,
  because iPhones are out of scope and App Store answers are not in this plan. The key's
  randomness comes from `expo-crypto`, because Hermes has no global `crypto.randomUUID`
  and nothing here polyfills `getRandomValues`.
- **The key is outside the lock** (Carl's answer, 2026-11-06). A signed-out person's
  unsent work may be signed and sent, so the install key and their certificate sit outside
  decision 168's seal. They are used only when someone signed in has opened Share nearby,
  apart from proving the key to the Worker in the certificate call of whoever is signed in.
  This amends 168 and goes to the security review. Caleb should see it, since 168 is his
  entry. It weakens what 168 guards against: whoever controls that phone can sign, as any
  certified person on it, whatever is in its log, and with a live pass on the phone can let
  in a new person with no manage privilege. It is not a way to sign in: a copied key gets a
  server session only on an account made from a chain, before that account's first session
  (section 14.1). Discovery keys are not outside the lock: each person's are sealed with
  their session at sign-out and come back at sign-in, since only that person's Share nearby
  uses them.
- **A certificate is a chain.** The first link is the Worker's signature, and each further
  link is signed by the key named in the link before it, in a versioned format (section
  5.12, Chains). Until phase 6 issues any, every chain has one link. Phones check two-link
  chains from phase 2 and refuse a link kind they do not know, because phones must accept
  a newcomer vouched for by a teammate.
- **Membership comes from this phone's organization fold**, using the same rule as
  `can_read_stream`. If the fold is older than a teammate's certificate, the certificate
  decides, so someone added last week is not turned away. A list of role ids would not do,
  because an older fold may not know the role, so the certificate carries resolved
  privileges per scope and the organization stream's newest sequence at signing, and it
  decides only when that sequence is newer than this phone's. A newcomer's membership
  comes from their chain until this phone's fold has any entry for them, live or removed,
  so removing someone sticks on every phone that has seen it (section 5.12, Chains).
- **Discovery shows teammates only, and nothing fixed about the app.** A phone's Bluetooth
  broadcast is a rotating id worked out from a per-language discovery key from the server,
  with no fixed service id and no app name, because a fixed id would mark a phone as
  running this app where that is a danger (decision 171). The id is a salt and a MAC, with
  no clock in it, because field phones often have wrong dates. Any stranger can connect
  and list a phone's Bluetooth services, so those UUIDs are derived too, and a stranger who
  connects gets silence: nothing readable goes out until the other side proves it holds
  the key (section 5.12, Session keys). A played-back advert draws no connection, because a
  phone connects only after hearing its own current salt echoed (section 5.12, Find). The
  Wi-Fi network's name takes Android's usual form with random parts, so it does not stand
  out. A newcomer gets the key from the inviter's phone, after the inviter's tap, over the
  link that the QR code starts (section 14.1), so the broadcast stays the same.
- **Discovery keys rotate** (Carl's answer 13). Otherwise a removed member or a taken phone
  would keep a radar for the team for the life of the language: with `kFind` they can unmask
  any advert, the tag is fixed per install, and the log names the people. So a language has
  generations, made lazily by the server, with no timed drop. An older generation can be
  worked out from a newer one and never the reverse, so a phone needs only one key and a
  `floor`. A phone advertises under its newest and scans down to its `floor`, so a phone
  already on a newer generation can still meet one that is behind. It connects under the
  older generation and holds back its `hello` until the other's has passed, so a lure learns
  no name. A phone that got a generation directly from the server hands it to that teammate
  after Hello, one hop, so one trip to town moves the whole team (section 5.12, Generations).
  The limits that remain: a phone the new generation has not reached stays recognisable under
  the old key; a scan-only phone on an old key cannot meet a newer one until it syncs; someone
  holding an old key can draw a connection from a phone that scans down to it, or read the
  chain of a phone still on it, which tells them a team phone is near; and an informer who is
  still a member is unaffected.
- **What discovery does not hide.** A stranger gets no certain answer, and does not learn
  who it is or which language. But the broadcast's form is fixed and public, so a
  determined scanner may tell that a phone is probably running this. The system also sends
  things the app does not pick: the phone's Bluetooth name to anyone who connects (Android
  10 to 13, and phones whose controller lacks extended advertising), and in Wi-Fi Direct
  beacons and probe responses the device name and address, for host and joiner, where the
  address stays fixed on phones whose maker did not turn on randomization. Timing and
  signal strength can link a phone's adverts in a small room. Anyone holding a generation of
  a language's discovery key can recognise phones still advertising under it, and name them
  from any log, until the key changes, which for each phone is when it first takes a newer
  generation (above). The real bound is that the radios run only while the screen is open,
  for a limited time, and on a disguised phone only after a press and for ten minutes at most
  (section 5.8). The real-phone test measures the rest (section 11).
- **Session proof.** Wi-Fi Direct says nothing about who is on the other end, and its
  passphrase is only a shared secret. So each side runs a key exchange, proves it with its
  install key, and everything on the link is encrypted with the result (section 5.12,
  Session keys).
- **Authorship: a signed manifest of per-event digests.** Each batch is signed once by the
  author's install, at the first send or earlier. A signature over the whole batch would
  fail: a receiver may need 3 events of 200, a holder may have pruned the confirmed ones,
  a sender skips redacted ones, and a restamp changes one row. A manifest lists each
  event's id and digest and is signed once, so any subset can be checked, by a third phone
  and by the relay, with one signature check per batch (section 5.12, Manifests).
  Manifests are stored with their signature and the signer's chain (section 5.12, The
  store), and each page carries that chain, because a third phone and the relay need the
  author's chain, not only the sender's. A signature binds an event to its author's key and
  person. The `deviceId` in a chain is a label the caller chose, proves nothing, and can
  name a teammate's device, so nothing that matters is keyed on it. Only a verified manifest
  can move a vector, and only its signer's entry.
- **Events the phone only pulled.** A teammate who got someone else's event from the
  server has no author's signature for it, and their own word would let any certified phone
  write as anyone, or plant a copy that shadows real work. So the Worker vouches. While
  online, a phone that pulled asks the Worker to attest those rows, and the Worker reads
  them itself and signs their ids, digests and `serverSeq` (section 5.12, Claims). The phone
  sends the event with that attestation, and the receiver folds it as nearby, with `via`
  naming the claimer. Without an attestation the work simply waits for the server, so an
  offline team loses nothing it could have had. A claim is sent only for a row this phone
  holds as `confirmed`, so it is never passed on second-hand in this release.
- **A teammate who was removed.** A phone cannot know of a removal it has not seen, so it
  accepts them, and anyone they let in, until it syncs. Once it has seen the removal it
  refuses both (section 5.12, Chains). A certificate lasts a year: shorter revokes faster,
  but risks stranding long-offline teams.
- **A key that was revoked.** A person whose phone was marked lost is still a live member,
  so the fold does not help, and teammates would keep handing it the team's work. The
  Worker signs a revocation list per organization (section 5.12). Phones get it with the
  certificate answer and pass it on in each session, so one trip to town protects the whole
  team. Hello refuses a listed key, and later-dated events from it are refused one by one,
  under answer 4's rule, and past a cap, under answer 16's (section 6). A revocation also
  makes a new generation, so the taken phone keeps only keys that go stale as the team takes
  the new one, and ends the person's sessions, so a taken phone still signed in cannot answer
  `{ revoked: true }` with a new key and a fresh chain. Suspending an account revokes its keys
  the same way, and a suspended inviter's pass lets nobody in. A holdings entry from a listed
  key, or from someone removed, counts as no copy (section 5.12, Holdings). A team that has
  met nobody who has been online stays exposed.
- **Expiry.** Hello checks a teammate's certificate against `max(wall, last hlc)`, with no
  not-before: `HlcClock.last` never goes back, so setting the date back does not revive an
  expired certificate, and a phone with an old date does not refuse a fresh one. Batches
  are carried for months, so a batch's chain is checked with expiry skipped, on phones and
  at the relay, and a retired Worker key stays listed.

Bulk bytes stay out of JavaScript: files move, are hashed and are encrypted natively, with
the session's key. Signing and checking reach sync as constructor arguments (decision
104).

**Security review.** Run `security-review` on this section and section 5.12 before phase
1's wire types are written, and again on the code before the merge (section 7). The wire
format is free to change until the first store build. A first review on 2026-11-06 is
folded into this plan. The next should look at: signed manifests; the door's list; what
the fixes leave open, which is a backdated withdrawal of an unbound target, the
`audioformat:<hash>` slot, take ids showing an author's profile id, and a signer stating a
false floor for its own key; the unsealed install key, and a copied key with a live pass
letting in a new person; clocks for expiry; `kFind` in native memory during Find; what
stays visible with no key, which is the broadcast's form, the system's Bluetooth and Wi-Fi
names and address, a live relay past the echo, a replayed opening under one salt, and a
lure advertising under a held key; generations, which are the one-hop hand-on, `you-first`
giving a chain to someone holding an old key, and echoing a salt no key matched; a false
holdings entry making a phone with the row off shed a file; the warning and press on a
disguised phone; the typed name a QR holder could copy; what a taken phone holds, including
`nearbyPeers`, the vector, chains and `via`; the carried file's traces, which are the
browser's download entry and history, the APK's own label and icon, and Settings → Apps;
and the open items in section 13.

### 5.6 Audio

The list a phone asks for follows the purposes in section 1, in order:

1. **Needed.** Files for the passages in its offline scope (`defaultOfflineScope`: asked
   of them, or worked on by them) or kept offline.
2. **Open for review.** For someone who can review: recordings nobody has checked, in the
   order the app offers them. `upNextOf` (`packages/core/src/passageLines.ts`) suggests
   these with no request behind them, so the offline scope misses them, and a reviewer
   would otherwise be sent to a passage with no audio. With "Hold teammates' recordings" off,
   only a small window of them (below).
3. **Backup.** Every other recording the server has not confirmed, from every phone, so
   that this phone can carry the whole team's work (section 5.11). The fewest known copies
   go first, then `plan.order`. No file has an age, and adding one would change kept rows
   for everyone. Only with that row on.

A file the server already has does not need carrying, so it moves only if it is needed or
open for review. A kept language's plan names only what memory and the asked passages
name, so the wanted list comes from a store query over audio rows with no stored verdict,
not from a walk of the plan. It walks references rather than the passage index, so that an
unconfirmed aside file (a part as recorded, decision 176) is still carried.

Level 1 files below give way to make room. A phone stops taking files only when that would
leave less than 500 MB free, the room already kept for recording (PLAN.md section 14), and
the screen then says it cannot carry everything (section 5.8). A phone serves a file only
if it is referenced in that language and not redacted: `LanguageFiles` answers that from
memory and, on a kept language, from audio rows by hash.

Transfers reuse `TransferWorker`: its backoff and the pause while recording. A third
worker per session has `isOnline` as link up. It has its own `isPulling`, because the
session's flips true on every offline sync attempt, and it pays no shared byte budget,
because the budget bounds bytes held in JavaScript and native moves hold none. A link drop
is an `OfflineError`, so dropped radio links do not file Linear issues through the
user-issue watch. Files land in their own staging name, `<hash>.<format>.nearby.part`,
because `downloadBlob` deletes any existing `.part` for the same name. Native writes it,
hashes it, and JavaScript compares the hash and renames. A dropped file is sent whole
again; there is no partial resume in this release.

**When space runs short, files go in three levels** (Carl's choice, 2026-11-06). Today
there is only a yes or no (`evictableOf` in `packages/core/src/blobs.ts`).

| Order | What | Deleted when |
| --- | --- | --- |
| 1 | On the server and outside this person's offline scope. Today's rule, unchanged. It goes by passage, not by author. | Under 500 MB free, the store over 2 GB, or to make room for a nearby file |
| 2 (new) | Nearby files outside the offline scope: backups first, then files open for review. | Under 500 MB free, once level 1 cannot free enough |
| Never | Everything else: the person's own unsynced files, another person's on a shared phone (decision 60), needed nearby files, and files in the offline scope that the server has. | Never |

A backup may be the last copy, because the phone it came from may be gone, and it goes
before a kept file the server has safe. That is accepted: the person's own recording has
to win, and deleting a kept file could stop someone working while offline. A phone that
gives up a backup can no longer carry everything, and its screen says so. Files open for
review go last in level 2 rather than being protected, because a team's unreviewed audio
could otherwise fill a reviewer's phone and leave no way to free room for their own
recording.

What this needs. It is a work item of its own in phase 3, testable with no native code:

- **A nearby file is marked, never inferred.** The store knows a file only by its hash,
  and an unconfirmed file here could be anyone's. Each file that lands over the link gets
  a mark in the file ledger (`packages/sync/src/fileLedger.ts`, a new table beside
  `kept_files` and `lost_files`), and its group is worked out when space is short. So a
  backup in a passage this person is later asked to review becomes needed, and a file open
  for review becomes a backup once someone has checked it. No mark means protected. That
  keeps shared-phone recordings safe, and means nothing a teammate's phone sends can make
  this phone's own file deletable. A teammate's events can move a nearby file between
  groups, but only this phone deletes anything: when it runs short of space, when the server
  confirms a backup, or with the row below turned off (section 5.1). The session cannot reach
  the ledger today, since only `apps/mobile/src/sync/blobs.ts` holds it, so `LocalFiles` gains
  what it needs.
- **`evictableOf` does not change.** Level 2 is a new core function beside it,
  `nearbyEvictableOf`, given the marks, so today's guarantee and its tests stay as they
  are. A marked file no reference names goes first, or a file named only by a rejected
  event could never be freed.
- **One rule for open for review.** The list and `upNextOf` share one test
  (`isOpenForReview`: `recorded && !reviewed && steps.length > 0`), so what the app
  suggests and what the phone fetches cannot drift apart. What a line says does not
  change, so the linesVersion test's hash is recorded with no bump, which would cost a
  carried build.
- **Every level in one pass.** `reclaim` works out what to free once, and files leave the
  disk a moment later (`discard`), so a second call would still see the disk as short and
  delete too many backups. `LocalFiles.reclaim` takes ordered lists and one limits object,
  and uses up each list before the next. `blobs.ts` re-sorts everything by size today, so
  that moves to the caller: level 1 goes largest first, as today, so the fewest files go.
  Within level 2, the files with the most known copies go first, so a last copy goes last,
  and then the largest.
- **The 2 GB cap leaves nearby files alone.** `totalBytes()` leaves marked files out, so
  taking them pushes out no level 1 file, and the cap alone never deletes one.
- **Level 1 gives way first.** A phone frees level 1 before a nearby file lands, not
  after.
- **Another language's level 2 files can go too.** `reclaim` sees only the open language,
  and a person recording in one language must not be stuck behind another's backups. So
  the mark names the language, the file's group and its known copies, kept current by that
  language's session when it runs. Any session can free another language's level 2 files
  from the mark alone. A mark is keyed by hash and names one language, while the store is
  global by hash, so this could delete a file a second language also names. That is rare
  and accepted, and the decision entry says so.
- **A nearby file stops being one when the server confirms it.** The mark goes then, and
  when `discard` forgets the file. At the end of each sync `backupsConfirmedOf` lists marked
  files in the backup group that the server holds at the size held here, as `evictableOf`
  asks, and they go at once, on every phone, whatever the row below says (Carl's answer 14),
  so a phone back from town does not keep voices it never needed. A file open for review is
  then level 1. A needed one is kept.

**Hold teammates' recordings** (Carl's answer 14). A voice is hard to deny, the events beside
it name the speaker, and no file has protection at rest, so after a month offline one taken
phone, even a viewer's, would hold a month of all five people. So every phone has a row on
Share nearby (section 5.8). It is phone-wide, in `meta` as `nearbyHold`, written only when
someone presses it. With nothing written it is on, or off on a phone that wears a disguise
(`holdByDefault(worn)` in `nearbyModel`, through the seam in section 5.8). A pressed choice
stays, whatever the disguise does later. It covers files only, and events still go to every
phone. Role does not decide it, because role is not risk. Open for review alone would not do
either, because Translators hold `review`, so nearly every phone would still take everything.

With it off:

- **What it asks for.** Needed files, and those of a small window of open-for-review
  passages: the first ones in `upNextOf` order, five as a starting guess, an argument from
  JavaScript. No backups. It still serves what it holds.
- **What it sheds.** `nearbyShedOf` lists marked files outside that set in two cases: the
  server has the file at the size held here, as `evictableOf` asks, or another person is known
  to hold it. "Known" means a holdings entry
  from an install key other than this phone's, certified to someone other than whoever is
  signed in here. Its owner must keep its files, which its signed `hold` says (the row on), or
  its key must sort below this phone's, so that two phones with the row off cannot each shed a
  file because of the other, and the lowest such key holding a file keeps it. So the phone
  keeps the last known copy, and a disguised phone with the lowest key does not keep voices that
  teammates with the row on hold. It runs when the row is turned off,
  in each session at step 8, before this phone's own entry goes, so that the final summaries
  already count it, and at the end of each sync, not only when space is short. Holdings can be out of date, and an owner's own entry
  can be false (section 5.11), so a copy believed safe may not be. That is accepted on a phone
  whose person chose not to hold these files.
- **What is accepted.** A team where everyone wears a disguise has no backups unless someone
  turns the row on. Third-phone audio bridging stops on those phones. A speaker's voice stays
  on any phone with the row on until the server confirms it.

`wantedFilesOf` takes this choice with no default, so a test has to say which it means.
"Every unconfirmed file is wanted" is true only with the row on. Fleet phones run with it on,
unless a scenario turns it off (section 8).

**This departs from two records**, both amended when this is built: PLAN.md section 14
("Unsynced recordings, kept units, and other languages' files are never touched") and
decision 60 ("recordings evicted only once the server has them"). The file store's own
promise in `apps/mobile/src/sync/blobs.ts` ("only for files the caller has proven the
server can give back") changes with them, and so does the `LIMITS` comment in
`appLanguage.ts`.

### 5.7 Keeping nearby events honest

When a phone with nearby events is online, after push and pull, it asks the server about
them through one small new read, `known_events(org, stream, ids)`, gated by
`can_read_stream`, in pages of 500. It returns each known event's `id`, `server_seq`,
`hlc` and `actor_id`, because the table below needs all four. Without it, a nearby event
already inside a checkpoint would stay nearby forever, because a pull only asks for what
is past the cursor. A phone with no nearby rows makes no call.

| The server says | What the phone does |
| --- | --- |
| It has that id under another author | Marks a batch row `rejected` with a reason, keeping `via`, and refolds. It is neither dropped, which would lose a teammate's copy and claim nothing was lost, nor left nearby, which would hold the slow path for good. Bound ids make this a guard only. This is checked before the next rows. |
| It has the event, past the cursor | Nothing. The next pull confirms it. |
| It has the event, at or below the cursor | Drops the leftover copy (`WriteBatch.dropNearby`, which deletes only nearby rows; `prune` touches confirmed rows alone), and calls `lines.touched`. It refolds if the clock differs, or the row's `via` is a claim. Nothing is lost, because the server holds it. |
| It does not have it, and a teammate's phone claimed it did | Should not happen, since the Worker signed that claim. Marks it `rejected`, names the phone, refolds, and puts its record of claims back to its cursor. |
| It does not have it, and it is signed by its author | Keeps it. The author has not sent it yet. |

An event the server refused from its author is the remaining case. Its author's phone
shows the refusal, but a teammate's copy stays folded until that teammate reaches the
server, when the sweep or delivery settles it (section 6). The first design had the
author's phone tell teammates at their next exchange, and they would drop it, but a
dropped id is unknown again and can come back from a third phone. So that message is not
built. The decision entry says so, and it can be added later as an ability with no new
protocol version.

### 5.8 The screen

- **Share nearby**, from the Sync screen (`sync_status`) when the organization has it on
  (section 5.10), as a new screen `share_nearby` labelled experimental (`Badge` tone
  amber). It has an `APP_ONLY` edge in `apps/mobile/test/specParity.test.ts`, since the
  demo has no such flow. It also goes in the screen list there, `appOnly` in
  `flow.test.ts`, the `SCREENS` map through `lazyScreen`, a `screens.share_nearby` title
  in 16 catalogs, and a top-level function in `src/screens/nearby.tsx` with
  `contractsFor`. PLAN.md section 13 and `docs/ux/demo-parity.md` get a row.
- **Two jobs, said as two** (Carl's choice, 2026-11-09). Share nearby brings teammates'
  phones up to date, and, with joining without internet (14.1), gives a new person the app
  and lets them join. A short intro names both; then two headed sections, each with a line
  saying what it is for. "With teammates": phones that already have LangQuest bring each
  other up to date, kept open until Up to date; it holds the stage, warnings, teammates, what
  came across, Ready to carry and Hold teammates' recordings. "A new person", shown only on
  Let someone in's terms (`joinRows`): give them the app, then let them join from this phone;
  it holds the install file's too-old line, Get the install file (before going offline) and
  Let someone in (once their app is installed). The Sync row keeps its name and badge; its
  line names both jobs on the same terms, else teammates' phones alone, and a reason while it
  cannot run (`nearbyRowWords`). Its words say work goes both ways (Carl's words, 2026-11-09):
  "Share work progress with teammates, or bring in a new person, without the internet", else
  "Share work progress with teammates without the internet", with help to match. While it can
  be pressed, online, and this phone lacks the install file it needs now, a small amber line
  under it says "Get the install file before you go offline" (14.4, "Reminded while online");
  tapping the row still opens Share nearby.
- It asks for its permissions with a line saying why (section 9), and shows teammates who
  also have it open, with name and picture. Phones with equal summaries never connect, so
  a phone works out who it sees from the tag in the broadcast, and from what it already
  holds (section 5.12, Find). A tag it cannot match shows as "A teammate" until they
  exchange. A phone shows a teammate, and connects, only after hearing its own salt echoed,
  so a played-back advert shows nobody. After a while with no echo the screen says "A
  teammate may be nearby", and connecting takes a tap, so a phone that hears only one way
  is not stranded (Carl's answer 21). It is a small exception to starting by itself, and
  without it a played-back advert would test who is on a team. Otherwise it starts by itself,
  with no second confirmation, since both people opted in by opening the screen and the
  phones have checked each other, except on a disguised phone, which waits for a press (below).
  Each person shows progress, then "Up to date". Progress lives in a store read by this screen
  alone, because anything ticking in `ctx` or `LanguageHandle` redraws every mounted screen.
- **Hold teammates' recordings.** A switch row on this screen (section 5.6), 48 pt, in all 16
  catalogs and help mode, with no reason shown, here or in help, and no word about a disguise.
- **What the phone itself sends.** After the permission prompt and before the first Find,
  a one-time notice, shown again if the name changes. It shows the names others can see,
  where the test shows they leak (`BluetoothAdapter.getName()`, and
  `WifiP2pManager.requestDeviceInfo` for the Wi-Fi name), and how to change them. One
  general sentence covers the address, because a phone cannot read this about itself: some
  phones keep the same Wi-Fi address, so someone with equipment nearby could recognise this
  phone.
- **Ready to carry.** It says whether this phone holds everything it knows of, or how much
  is missing and why: no room, a file nobody in range has, pulled changes that can be
  shared only after this phone next reaches the server, or "This phone holds as much of
  Sam's work as it can. The rest stays on Sam's phone until someone reaches the internet."
  It lists teammates from the vector, holdings and the language's members, not from who met
  whom, because no phone can know about work on a phone it has not met since. Each shows as
  "today", "since you were last online" or "not since you were last online", and those not
  met today also show the newest work held from them (`batchKeys`' `firstHlc`, the author's
  clock), which adds no new record and counts work relayed by a third phone. No meeting
  time is kept (section 5.12, The store). So the person leaving for town can see that
  nothing is left behind. When a teammate could not send what was pruned, it says that
  older work will come from the server. If a batch carries a stamp far ahead, it says one
  line naming the author (section 5.4). With "Hold teammates' recordings" off it says "This
  phone can carry the team's work, but not all of their recordings", with the row one tap
  away, so one person on a team where everyone wears a disguise can still carry.
- The Sync screen gains "Holding N for teammates", counting recordings, shown whenever the
  phone holds some, even after the organization turns it off. A teammate's refused copy is
  listed there too, with Try again, but does not drive the indicator (section 5.2). The
  sync icon's number keeps its meaning (decision 165), but it does count a teammate's
  recordings waiting to upload, which is true of this phone. So do decision 166's upload
  bar and Waiting list: a phone holding backups shows the amber bar while offline, and
  lists other people's passages. The sign-out check does not count them (section 5.2).
  Carl sees this when it ships (section 13).
- A record's History gains one line for a row that is still nearby ("Came from Sam's
  phone, not on the server yet"), read from row status, since the fold does not know. A
  claim row says only "Came from Sam's phone", because the Worker has said the server holds
  it. No other list marks it.
- The screen stays awake from when Find starts, not only during an exchange
  (`expo-keep-awake`), because an unfiltered scan stops when the screen goes off.
- **The radios stop when it is not on screen.** Screens stay mounted and freeze, so an
  unmount effect or a render will not fire. One pure gate in `nearbyModel`,
  `radiosMayRun({ focused, onScreen, covered, worn, pressed, stopped })`, decides: focused,
  on screen, not covered and not stopped, and with `worn`, also `pressed`. Every start path
  asks it and asks again after any await: focus, coming back from the background, the
  continuation after a permission prompt, Let someone in's `host`, and the progress screen's
  retry. Keep-awake follows the gate, under its own tag. The radios stop on the navigation
  `blur` event and on going to the background, and on a phone with no disguise they resume
  from the vector. The hotspot's join dialog counts as leaving the app, so the hook ignores
  that one pause, as the recorder's `askingForMicrophone` does, or the fallback would cancel
  itself. A disguised phone never sees that dialog and ignores no pause. The upload bar is
  hidden on this screen, since its tap would push Sync over it.
- **Under a disguise, only after a press** (Carl's answer 15). A disguised phone stays
  mounted under its calculator and fires no `blur` (decision 171), so a person coming back
  would otherwise get a calculator that broadcasts, exchanges and holds the screen awake.
  `covered` and `worn` come from a seam: `src/shell/useAppCovered.ts` returns both false,
  `useAppCovered.android.ts` returns `useDisguise()`'s `locked` and `look !== null`, and
  `src/nearby/` reads only that, so iPhone and web builds carry no disguise code
  (`disguiseIphone.test.ts`). On a phone that wears one:
  - **Opening the screen does nothing.** No radios and no prompts. It shows a line and a 56 pt
    "Start sharing" button, whose words never name the cover. A press sets `pressed`. So this
    is the other exception to starting by itself.
  - **It stops sooner.** At ten minutes from the press, `runLimitMs`, an argument from
    JavaScript, even during a session, which ends with `bye` `stopped` and resumes from the
    vector at the next press. Or as soon as it says "Up to date", with no listening bursts
    (`stopWhenLevel`). Both latch, and only a new press starts it again.
  - **Going to the background stops it for good.** Decision 171 locks the app then, and a lock
    clears `pressed`. Typing the code does not set it again, because a code typed under
    pressure would light the radios and show teammates' names in front of whoever asked. The
    screen says sharing stopped because the person left the app, and only a new press after the
    code restarts it. So Home or the lock button is the quick way out.
  - **One warning before any permission prompt.** The first press, and any later press that
    would bring a prompt, first shows one notice: someone with equipment can tell a phone is
    broadcasting, and Android will show the app's real name, so do this alone. The prompts name
    the application, not the launcher alias (`withAndroidAppIcons.js:80`, from memory of AOSP,
    and the real-phone test checks it). A prompt counts as leaving (decision 171), so the code
    is typed and the press made again after it.
  - **`radios.joinHotspot` is false.** It sends that in `arrange`, whatever `capabilities()`
    says, because the hotspot's join dialog also names the application. It may still host, so
    two disguised phones whose Wi-Fi Direct fails stay on Bluetooth with audio waiting.
  - **Let someone in keeps the same rules.** Its QR is gone after a lock, and the tap makes a
    new one.
  - **Its words stay in `src/disguise/i18n`.** Every word only a disguised phone shows, in all
    16 languages and in help mode, goes there, not in `src/i18n` (decision 171, amended
    2026-11-05). The screen reaches them through `src/shell/NearbyCoverNotes.tsx`, which renders
    nothing, and `NearbyCoverNotes.android.tsx`, which imports `src/disguise`.

  Hiding it on a disguised phone would be safest, and would send the most exposed people to
  town and out of offline review while teammates' phones still broadcast beside them. Staff not
  granting `nearby` is the lever for a team where any broadcast is too much.
- **It stops by itself.** `NearbyRoom` holds an idle clock on the fleet's time, with its
  limit an argument from JavaScript (five minutes as a starting guess). The clock runs only
  while no session is open and `choosePartner` returns null or nobody is in range, and it
  restarts only when a verified session commits events or files, never on a Bluetooth
  connection, so a stranger cannot hold the radios on. A phone waiting on a busy teammate
  with something to swap keeps advertising, with a longer backstop (30 minutes as a starting
  guess). A running session is exempt and has its own stall deadline. At the limit the room
  calls `stopAll`, releases keep-awake and shows Look again. That stop latches: going to the
  background and back does not restart the radios, and only Look again or reopening the
  screen does, or on a disguised phone only a press. A latecomer asks a teammate to tap it, and
  the stopped screen says so. Let
  someone in has the same limit, taking down the group and hiding the QR unless a join is
  under way. So a phone pocketed with its screen on does not broadcast through a market, and
  the screen can time out, which brings back the background stop and decision 171's lock.
- It needs help-mode lines (`help`, `HelpRow`), every string in all 16 catalogs, 48 pt and
  56 pt targets, and words that wrap at 360 pt (decision 139). On the web and on iPhones,
  for now, it is absent, through a plain stub with `.android` files (`NearbyRow.tsx`,
  `NearbyRow.android.tsx`), as `AppIconRow` does, so those builds carry none of it. A
  `.web` stub would still ship it on iPhones.
- **Disabled, with a line saying why** (Carl's answer, 2026-11-06), on an Android phone
  below Android 10, or without Bluetooth LE or Wi-Fi Direct. `minSdk` is 24, and
  `WifiP2pConfig.Builder` is API 29, so the module ships on those phones and does nothing.
  The disabled row keeps its `onPress`, or help mode cannot explain it. The screen also
  has states for Bluetooth, Wi-Fi or Location being off, from `capabilities()`, because an
  app generally cannot turn them on.

### 5.9 Where the code goes

| Layer | What |
| --- | --- |
| `packages/core` | The door and its lookup, what to send given a vector, holdings, signing texts, chains, ranking wanted files, level 2, the open-for-review test, protocol pick. Pure, no I/O. It goes through the index, since sync's lint and boundary test allow only that name. Core reaches the web bundle, so it stays small. |
| `packages/sync` | `NearbySession` (the protocol over a `NearbyLink`), the room's loop, partner choice, `receiveNearby`, signing, the sweep, delivery, store changes, ledger marks. Sign and verify arrive as arguments. The session and room go in their own entry, `@langquest-next/sync/nearby`, absent from `index.ts`, so the web bundle does not carry them. |
| `apps/mobile/modules/nearby-link` | A local Expo module, Android only and mechanism only: Bluetooth LE, Wi-Fi Direct, the local-only hotspot, sockets, native encryption, files to `.nearby.part`. Every tunable is an argument from JavaScript, because a Kotlin edit needs a store review. It does nothing at construction and names no API 29 class in its fields. It needs no config plugin: its own `AndroidManifest.xml` carries the permissions, so `app.json` stays unchanged. |
| `apps/mobile/src` | The screen, the hook, the certificate call in `src/server/` (decision 105), and the `.android` files with crypto and the native binding, so the web chunk carries neither. |
| `apps/web/worker` | Certificate signing, for organizations that are on; attestations; the delivery route; the join route; the APK route. |
| `supabase/migrations` | `org_features`, `install_keys`, the revocation list, discovery-key generations, certificate facts, `known_events`, the `get_user_state` fields, the relay functions, passes, the diagnostics allowlist. |
| `scripts` | The staff commands, `org-feature` and the one that lists and revokes a person's keys and raises a revoked key's limit, each with its line in `scripts/commands.mjs`; the signing key script; the carried build script. |

`NearbyLink` says nothing about any one radio. Any link that carries messages and files
will do, because the session proof and encryption sit above it. How two phones found each
other, by Bluetooth or a QR code, is kept apart from it. Section 5.12 names the files.

### 5.10 Experimental at the start

Nearby sync starts off for everyone and is turned on one organization at a time (Carl's
choice, 2026-11-06). No development or preview branch is deployed. The real-phone test
runs against someone's own stack (section 7), and after the merge the flag is how it gets
tried in the field. Share nearby stays labelled experimental until that ends.

| Stage | Who has it | How |
| --- | --- | --- |
| Before merging (the real-phone test) | A few test phones | An APK built from the branch, against someone's own stack, with the features granted there (section 7). |
| Testing after merging | A test organization | Staff turn it on for that one organization, on the store build and the production server. |
| Trying it out | Partners who ask | The same staff command. `nearby_join` is granted separately. |
| Later | Organization admins | A toggle in organization setup changes the same record. Not built now. |
| If it becomes standard | Everyone | The default becomes on, and the records list the organizations that turned it off. |

- **One record per organization and feature.** `org_features` on the server follows
  `org_importers` (decision 174): who turned it on and when, kept once revoked so the
  history stays. Staff use `npm run org-feature -- grant <organization id> nearby
  --hosted`, with `list` and `revoke`. The default compiled into the app is off.
- **Two features.** `nearby` is the exchange. `nearby_join` is joining offline (Carl's
  answer, 2026-11-06), granted separately. A pass is issued and redeemed only when both are
  on, because a newcomer also needs the discovery key, and staff turning an organization
  off by revoking `nearby` must stop joins too.
- **The certificate carries it to the phone.** Nearby sync cannot run without a
  certificate and a language's discovery key (section 5.5). The Worker hands those out
  only for organizations that are on, one certificate each. Holding them is what makes
  Share nearby appear for that organization's languages, so it works offline. The one new
  call in sync is the attestation of pulled work, which only a phone holding a certificate
  makes (section 5.12, Claims). A teammate's phone checks the certificate at Hello, so
  unhiding the screen gets nobody in.
- **A phone learns through a call it already makes.** `get_user_state` gains a field,
  `orgFeatures`, saying which features each of the caller's organizations has on, and only
  then does the phone ask for a certificate. Someone in an organization that is off makes
  no new server call. `useGlobalViewer` reads `get_user_state` on every `OrgWork` mount
  and on token refresh, so it runs for everyone at sync time. `my_organizations` does not:
  it runs only on Me, More settings and the organization switcher, on a device with no
  saved organization, and while a join request waits, so a person who stays on their work
  screens would never learn the flag. `get_user_state` returns `jsonb`, so it takes
  `create or replace`, and old builds ignore the field.
- **A team can leave ready.** Everyone in an organization that is on gets a key and
  certificate the next time they reach the server, so nobody has to be online when they
  first open Share nearby. The certificate refreshes once a day or on a membership change,
  and discovery keys and passes travel on the same answer. Discovery keys and passes come
  only for the languages this phone has opened (decision 37), not all the person can read,
  so an admin's phone holds no key for a language it has never held. The phone asks again
  the first time a language with no key opens, so someone who opens a language in town can
  still share it offline. So turning an organization off reaches a phone within a day of it
  being online.
- **It is still each person's choice.** The radios run only while someone has Share nearby
  open, and permissions are asked for there, so no personal switch for the radios is needed.
  What a phone holds for others has its own row (section 5.6).
- **The flag gates the way in, and nothing else.** Turning an organization off reaches
  each phone the next time it reaches the server: it drops the certificate and discovery
  key, and Share nearby disappears. The sweep (section 5.7), uploads, delivery and freeing
  space keep running, so nearby events and files already on a phone still settle. Gating
  those could leave an event unsettled forever. The one exception is a newcomer with no
  account yet, because the relay will not make an account once the organization is off
  (Carl's answer 9), so that work waits (section 14.3). A phone with no internet keeps
  working until it next reaches the server.
- **It cannot contain everything.** The changes to the shared sync path in phase 1
  (`takeCheckpoint`, `putOn`, the store's queries) run for everyone, so they rest on the
  tests in section 8, not on the flag. Each store build from a merge goes public once
  approved, with no staged rollout (decision 157), so everyone gets the native module and
  its permissions (section 9). There is no way to leave the module out while it is in the
  repository: autolinking picks up `apps/mobile/modules/*`, and the fingerprint hashes the
  folder, so the only real gate is not merging it, which is why the real-phone test comes
  before the merge. Someone in an organization that is off has no nearby rows and sees no
  prompt.
- **Knowing who is using it.** `list` shows the organizations, and diagnostics record
  exchanges, so a field report shows whether a phone has used it (`docs/diagnostics.md`).

**This amends decision 53.** It keeps 53's per-organization control, default of off,
offline behaviour, lack of a third-party service, and its rule that a flag gates screens
and behaviour, never events. It leaves out the synced configuration document, because the
certificate would still need its own server check, and two places would have to agree.
That document can come when a second feature needs a flag; `org_features` names its
feature, so it can grow. As 53 asks, a follow-up issue tracks the rollout and removing the
flag. No such issue exists yet.

### 5.11 Teams of three or more

A team still moves work in pairs (section 4), but the phones arrange them. People never
choose a partner or decide when to switch: each person opens Share nearby and keeps it
open until it says "Up to date". When the exchanges are done, any one phone with "Hold
teammates' recordings" on can reach the internet and upload the whole team's work, and a phone
with it off uploads every event and the files it holds (section 6).

**Every phone takes everything, unless its person says no** (Carl's choice, 2026-11-06, and
answer 14). Every event the server has not confirmed goes to every phone, and every such file
goes to every phone with "Hold teammates' recordings" on, room and budget allowing (sections
5.4 and 5.6). That includes people who only view (`view_status`), so that any phone can carry.
The relay takes a file from them when an accepted event names it (section 6). It also means
one taken phone with the row on holds a month of every teammate's voice under their name,
until the server confirms those files.

Five people recording an hour a day, with nobody reaching the server and the row on:

| Per phone | |
| --- | --- |
| Stored per month | 8.7 GB |
| Received per day | 232 MB |

This is arithmetic from 58 MB an hour, not a measurement. It is the cost of letting any
phone carry everything, and a cheap phone can fill up, which is why the screen says when
one cannot. Space comes back after a trip to town: once the server confirms a backup it goes
at once, on every phone (section 5.6). A file that was open for review falls to level 1 and
goes only under space pressure, so up to about 35 hours of teammates' voices that a reviewer
could have reviewed can stay on a phone after that trip.

Each phone also keeps its **holdings**: for each install key it has heard from, which
unconfirmed files that phone last said it holds, signed by that phone, with a counter so
that newer news replaces older (section 5.12). Holdings pass along after the Have step, stay
in device meta beside the vector, and never reach the server or the log. They decide which
file to fetch and which to delete first, and whether two phones have anything to swap. They
can be out of date until the next exchange corrects them.

**Review ahead of backups.** A session moves events, then needed files, then files open
for review, then backups. If the phone saw another teammate with something to swap before
this session began, backups stop after a time limit (two minutes as a starting guess) and
both phones move on, and the rest goes at a later pairing. So two phones copying backups
cannot keep a third person from audio they need. Needed files and files open for review
are never cut short, and with nobody else in range, backups run until they finish.

**Partners chosen, not rotated.** Each phone gives a short summary in its Bluetooth scan
response, with a device tag, both masked (section 5.12, Find), so phones can decide before
bringing up Wi-Fi:

- **Skip what would achieve nothing.** With equal summaries, two phones know the same
  things, so each can tell from its holdings whether the other has a file it wants. If
  neither does, they do not connect. Two phones that finished together and have not
  changed since do not connect either, even if their summaries differ, as they will when
  one has no room for what the other holds. Each records both final summaries at Done.
- **Spread the work.** Among the rest, a phone picks the teammate it swapped with longest
  ago, or has not met on this screen.
- **Only one side connects.** Of two phones that pick each other and have each heard the
  other's echo (section 5.12, Find), the lower device tag connects at once. The other waits
  with a time-out and then may connect, since a phone that can only scan is never seen by
  anyone. A phone that heard the other under an older generation does not wait, because the
  other cannot hear it (section 5.12, Generations).
- **Stop when level.** Once nobody in range has anything new, the screen says "Up to date"
  and stops connecting. With nobody met since the radios started, the room is level at once,
  and the screen stays on "Looking for teammates" (`nearbyRunModel`'s `met`), or "Up to date"
  would tell a person alone that they are done. Met is a phone that echoed, one the person
  tapped, or a session that began (`NearbyRoom`'s `everMet`), not a phone merely heard, which
  may be a played-back advert; so a disguised phone never stops at level having found nobody. It keeps listening in short bursts, up to the room's idle limit
  (section 5.8), so a teammate who arrives is still found. A disguised phone stops instead
  (section 5.8). Android reportedly allows at
  most 5 scan starts per 30 seconds, failing silently, and downgrades a scan left running
  over 30 minutes, so starts stay 6 seconds apart and a long scan restarts about every 25
  minutes. All of these are arguments from JavaScript.

With a good order, five phones need 6 pairings rather than the 10 it takes for every pair
to meet (at least 2N - 4 for N of four or more). A fleet scenario measures how close this
rule gets, before any radio code exists.

The loop that chooses partners, runs bursts and moves on lives in `packages/sync`
(`nearbyRoom.ts`), not in the fleet or a hook. The fleet's promise is that phones run the
app's real code, so the fleet supplies only time and the link.

**Trust.** A summary and a counter in Have are claims from teammates' phones, and they only
decide whom to talk to and what to send. A holdings entry is signed by its owner, so a
teammate can pass one on but cannot forge or wedge it, and a false entry naming fifty devices
adds at most one copy, because `copiesOf` counts certified people (section 5.12). What an
owner says of itself can still be false, which changes the deletion order or puts off an
exchange. It cannot delete anything by itself on a phone with "Hold teammates' recordings" on,
because only that phone running short of space does that. On a phone with the row off it can
make a file go that the phone would have kept (sections 5.1 and 5.6). The room also treats
"nothing to swap" as a hint: two phones that have not exchanged for a set time connect anyway,
once.

### 5.12 The implementation contract

This is what the people and agents building this must not disagree on. It lands as one
small commit of types and golden test vectors before any phase (section 7). A file named
here that does not exist yet is where the thing goes. All of it can change until the
merge. After the first store build it can only grow, through the protocol range and
abilities in Hello, because phones in the field keep speaking what they shipped with.

Plain bytes on the wire: public keys and signatures are base64url with no padding (32 and
64 bytes), digests are lowercase hex SHA-256 (core's `isHash`), and messages are UTF-8
JSON. Tags and summaries are hex (Find, below). Every other byte string in a message, a
route, a QR code or a native callback, such as `idSalt`, a discovery key, a salt, `r` and
`echo`, is base64url with no padding. Every time is whole milliseconds since 1970
(`wallMs`, `expiresAt`, `revokedAtMs`).

**Where each thing lives** (decisions 104 and 105).

| Package | File | What |
| --- | --- | --- |
| core | `version.ts` | `NEARBY_PROTOCOL = { min: 1, max: 1 }`, `pickProtocol(mine, theirs)`, beside `CLIENT_PROTOCOL_VERSION`. |
| core | `hlc.ts` | `isHlc`, `CLOCK_AHEAD_TOLERANCE_MS = 300000`, `clockCloseEnough`. `HlcClock` and `decodeHlc` do not change. |
| core | `validate.ts` | `idAuthor`, with a parity block in `scripts/record-parity-sql.ts`, and `sameEventBytes`: every client needs both (a command mints a bound id, and a pull compares). |
| core | `commands.ts` | `newCommandId(actorId)`, the one way to mint a `commandId` (section 5.4, Bound ids). |
| core | `org.ts` | Export `EventPrivilege`. In phase 6, `withChainMembership` and `newcomerOrgState`. |
| core | `nearbyDoor.ts` | `NearbyPeople`, `DoorFacts`, `peopleFromOrg`, `nearbyDoor`, `nearbyCopy` (envelope only, no `serverSeq`), `isServerEventId` with its parity block. |
| core | `nearbySend.ts` | `NearbyVector`, `parseVector`, `countBatch`, `applyFloor`, `batchRowsToSend`, `shouldClaim`. |
| core | `nearbyHoldings.ts` | `Holdings`, `mergeHoldings`, `withMyHolding`, `copiesOf`, `parseHoldings`, `summaryText`, `nearbyGroupOf`, `wantedFilesOf`. |
| core | `nearbySigning.ts` | The texts below, `eventDigest`, the manifest and attestation types, the opening's bytes, `utf8Encode`, since core has no `TextEncoder`, `nearbyPayloadError`, and in phase 6 the two pictures from `th`. |
| core | `nearbyChain.ts` | `ChainLink`, `JoinPass`, `Verify`, `Sha256`, `checkChain`, `newcomerProfileId`, `RevocationList`, `peopleWithChains`. |
| core | `nearbyGenerations.ts` | `olderDiscoveryKey`, `discoveryKeyAt`, `handedKeyHolds` (Generations, below). |
| core | `nearby.ts` | The barrel behind `@langquest-next/core/nearby` (`packages/core/package.json`), for every `nearby*` file here. Absent from `index.ts`: Metro does not shake an entry's unused modules out of the web bundle. |
| core | `libraryInUse.ts` | In phase 6, `STARTING_COPY_FORMATS`, `mayGoInStartingCopy`, `docsThisLanguageNames`, `docsThisLanguageUses` (Documents a language uses, below). |
| core | `passageLines.ts` | `isOpenForReview`, `openForReviewOf`. |
| core | `blobs.ts` | A third argument to `lostFilesOf`, and `forScope` exported. `nearbyEvictableOf`, `nearbyShedOf` and `backupsConfirmedOf` are in `nearbyHoldings.ts`, behind the nearby entry, since they take marks and no plan. In phase 4, `filesNamedBy`. |
| sync | `nearbyLink.ts` | `NearbyLink`, `NearbyRadio`, `NEARBY_MESSAGE_MAX`. |
| sync | `nearbyWire.ts` | The messages below, `encodeMessage`, `parseMessage`. |
| sync | `nearbySession.ts` | `NearbySession`. Link, `NearbyCrypto`, door lookup and file moves are constructor arguments, plus a narrow port onto `SyncClient`. It holds no store handle for writes. |
| sync | `nearbyRoom.ts`, `nearbyPartners.ts` | The room's loop; `choosePartner`, pure, with no clock inside. |
| sync | `nearby.ts` | The barrel behind the `./nearby` entry in `packages/sync/package.json`. Absent from `index.ts`. |
| sync | `nearbyClient.ts` | `nearbyClient(platform)`, `NearbyPort`: signing, receiving, the sender's reads, the door again, attesting, the sweep and settling batches, through a narrow port onto `SyncClient`'s private state. A client takes it as its `nearby` argument, which only the Android app passes. |
| sync | `syncClient.ts` | What every client needs: the checkpoint gates, `requeue` leaving out rows with `via`, the pull's comparison and refold, `inspect().nearby`, and one-line calls handing on to `nearbyClient.ts`. Everything here is in the web bundle. |
| sync | `types.ts`, `sqliteStore.ts`, `memoryStore.ts` | The store below, on both stores. |
| sync | `languageFiles.ts`, `languageSession.ts`, `nearbyMarks.ts`, `nearbyFiles.ts` | `holdChoice`, `mayUpload`, `fetchFile` and `nearbyFiles` on `LanguageSession`, own-file counts and `holding`, the multi-list `reclaim`. Behind the nearby entry: the marks (a `nearby_files` table in the ledger's database) and `nearbyFiles(platform)`, which holds the wanted list, serving, the third worker, level 2, shedding and a confirmed backup going. |
| sync | `testing/memoryNearbyLink.ts`, `testing/fleet/nearby.ts` | `memoryNearbyPair`, `fakeSigner`, and the fleet's time and link for the room. |
| app | `modules/nearby-link/` | Native (section 5.9). `src/wire.ts` and `test-vectors.json` hold the id, mask, frame and pipe formats, and both vitest and JUnit read them. |
| app | `src/nearby/` | `nearbyLink.ts` and `nearbyLink.android.ts` (the binding, sign, verify, `@noble/curves`), `useNearby.ts`, `useNearbyIdentity.ts` and `.android`, `nearbyModel.ts`, `nearbyPermissionsModel.ts`, `NearbyRow.tsx` and `.android`, and in phase 6 `useFirstContact.ts`. `src/shell/useAppCovered.ts` and `.android`, `src/shell/NearbyCoverNotes.tsx` and `.android`, the disguised phone's words in `src/disguise/i18n`. |
| app | `src/server/nearby.ts`, `src/server/nearbyKey.ts` | Certificate, attestation, relay and join calls, plain with no hooks; the install key in `secureStorage`. In phase 6, `src/server/localPerson.ts`. |
| app | `src/screens/nearby.tsx` | `ShareNearby`, and in phase 6 `LetSomeoneIn` and the progress screen. Not split by platform: `screenContracts.test.ts` reads every file there. |
| worker | `apps/web/worker/nearby.ts`, `relay.ts` | `POST /api/nearby/certificate`, `POST /api/nearby/attest`, `POST /api/nearby/join`, `POST /api/relay`, written as literals so `server-calls` sees them. In phase 6, `GET /apk/*`. |

`@langquest-next/sync/nearby` needs an exception at `eslint.config.mjs:32`, which refuses
every package subpath from `apps/mobile/src`, and only `.android` files may import it. No
app file imports a sync subpath on Metro today, so `expo export -p android` must prove it
resolves. No `.rpc('known_events')` or `/api/...` text may appear in `apps/mobile/src` or
`packages/sync/src`, even in a comment, before the migration or Worker route that defines
it is committed, or `serverCalls.test.ts` fails. A new `Transport` method goes in three
lists by hand: `FakeServer.transportFor`, `shapeTransport` and `SimDevice.observed`.

**The link and the radio.** `packages/sync/src/nearbyLink.ts`. Every call rejects with
`OfflineError` on a drop.

```ts
export const NEARBY_MESSAGE_MAX = 1024 * 1024; // the native frame ceiling, on every kind of link

export interface NearbyLink {
  readonly kind: 'wifi-direct' | 'hotspot' | 'bluetooth' | 'memory';
  readonly canMoveFiles: boolean; // false on 'bluetooth'
  /** One whole message, resolved when taken, so a full queue slows the sender. */
  send(message: Uint8Array): Promise<void>;
  /** The next whole message, in order. Null once the other side closed cleanly. */
  receive(): Promise<Uint8Array | null>;
  /** The opening: an exact number of raw bytes with no frame, before `secure` (Session keys, below). */
  sendOpening(bytes: Uint8Array): Promise<void>;
  /** Null at the deadline, or once the other side has closed. */
  receiveOpening(size: number, deadlineMs: number): Promise<Uint8Array | null>;
  /** Encrypt everything from now on, both ways. Once per link, after the opening and before any message. */
  secure(keys: { send: Uint8Array; receive: Uint8Array }): Promise<void>;
  sendFile(file: { transferId: string; uri: string; size: number }): Promise<void>;
  receiveFile(file: { transferId: string; stagingUri: string; maxBytes: number; minFreeBytes: number }):
    Promise<{ size: number; sha256: string }>;
  cancelFile(transferId: string): Promise<void>;
  close(): Promise<void>;
}

export interface SeenPhone { peer: string; salt: string; r: string; tag: string; summary: string; echo: string; connectable: boolean; rssi?: number; scan: number /* the place in scanKeys of the key it matched */ }

/** How phones find each other and bring up a link. A QR start uses only host and join. */
export interface NearbyRadio {
  capabilities(): Promise<NearbyCapabilities>; // sdk, advertise, directByName, band5, hotspot, joinHotspot, bluetoothOn, wifiOn, locationOn
  // Advertises under kFind, its newest generation's, and scans for every key in scanKeys, newest first (Generations, below).
  startFind(args: { kFind: Uint8Array; scanKeys: Uint8Array[]; payload: Uint8Array /* tag + summary + echo, 14 bytes */; r: Uint8Array; tunables: FindTunables }): Promise<void>;
  updateFind(args: { payload: Uint8Array; r: Uint8Array }): Promise<void>; // a new scan response under a new mask, never a new salt
  stopFind(): Promise<void>;
  onFound(hear: (seen: SeenPhone) => void): () => void;
  onFormSalt(hear: (salt: string, rssi?: number) => void): () => void; // the salt of an advert of this form that no key in scanKeys matches
  onSalt(hear: (salt: string) => void): () => void; // this phone's salt, at each start and rotation
  onPipe(hear: (pipe: NearbyLink, salt: string) => void): () => void; // someone connected; nothing is trusted until the opening checks
  openPipe(peer: string, salt: string, scan: number): Promise<NearbyLink>; // kind 'bluetooth'
  // On Wi-Fi Direct, whose server is bound to the group's own address, the first connection takes the link. A hotspot's
  // address cannot be found reliably, so its server listens on every network and `nextLink` hands up each later
  // connection: the session tries them all, and the one that proves the attempt's keys is the link. Once settled, a
  // second phone is refused, and reported so the inviter can be told.
  host(kind: 'wifi-direct' | 'hotspot', opts: HostOptions): Promise<HostDetails & { link: Promise<NearbyLink>; nextLink?(): Promise<NearbyLink>; onRefused(hear: () => void): () => void; takeDown(): Promise<void> }>;
  join(kind: 'wifi-direct' | 'hotspot', details: HostDetails): Promise<NearbyLink>;
  stopAll(): Promise<void>;
}

/** What sync may not import: a platform's crypto, an argument to NearbySession and SyncClient (decision 104). */
export interface NearbyCrypto {
  publicKey: string; // this install's key
  sign(message: Uint8Array): Promise<string>;
  verify: Verify;
  sha256(bytes: Uint8Array): Uint8Array;
  hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array;
  hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Uint8Array;
  x25519Pair(): { secret: Uint8Array; public: Uint8Array };
  x25519(secret: Uint8Array, theirPublic: Uint8Array): Uint8Array;
  randomBytes(size: number): Uint8Array;
}
```

`HostDetails` is the `host` message below without its `t`. `HostOptions` is `{ ssid?, passphrase?,
band5: boolean }`, with no name or passphrase for a hotspot, because the system chooses them.
`FindTunables` holds Find's times and retries, `connectable` among them. `fakeSigner`
implements `NearbyCrypto`.

A pipe is a `NearbyLink` whose frames go over GATT. No frame is ever plain. The opening is
raw bytes of a known size, which JavaScript seals and checks. After `secure`, each frame is
a sealed header of 21 bytes holding `u32be len` and `u8 type`, then the sealed body, each
AES-256-GCM with nonce `0^4 || u64 counter` per direction, so a sniffer sees no length prefix
or type byte. `len` is checked against 1 MiB after the header opens and before allocating.
GATT chunks carry only sealed bytes, in order. A failed tag closes the link. Native never
sees a key but `kFind` and the link's two frame keys, and never logs them. Native error
codes are an enumerated list, because the diagnostics allowlist holds them.

**A session, in order.** Both sides send at once wherever the table says "each". Both
directions stream at the same time, so nothing waits for an acknowledgement. A message a
phone does not know is ignored. A malformed one ends the session with `bye`. Before `secure`
there are no messages, so no `bye` either: a phone that has not checked the other side's
opening says nothing at all. A side starts a step once it has both sent and received the end
of the step before: `have`, `holdings-end`, `events-done`, `files-done`.

| Step | Channel | Messages | Then |
| --- | --- | --- | --- |
| 1. Open | The first channel: a pipe, or a QR link | The initiator sends its opening. The responder checks it, then sends its own or stays silent. Both call `secure`. | Keys below. |
| 2. Hello | Same | The initiator sends `hello`. The responder checks it, then sends its own or `bye`, so a refused phone gets no chain. An initiator that connected under an older generation sends `you-first` instead, and the order reverses (Generations, below). | Ranges overlap (`pickProtocol`), chain and proof pass, no key in the chain is on the revocation list, the read gate passes (`privilegesIn(peer, language).size > 0`, which leaves Global Viewers out). Otherwise `bye`. |
| 3. Arrange | A pipe only | Each sends `arrange`. Once the other's has come, an initiator with a generation to hand on sends `discovery-key`. The host sends `host`. | The other joins. Both `secure` the new link and each sends `ready`, which proves the keys, and the pipe closes. With no `ready` by the deadline the host sends `host` again with the next kind, ending with `bluetooth`, when the pipe carries on as the link, so both sides always agree. |
| 4. Have | The best link | Each sends `have`. The side with the newer revocation list sends `revoked`. | Each side now knows what the other lacks, and nothing else: `have` moves no entry. If a newer list names this partner, the session ends. |
| 5. Holdings | A link that can move files | Each sends `holdings` for entries where its counter is newer than the other's, then `holdings-end`. | Drops what does not verify, and writes holdings once. |
| 6. Events | Same link | Each sends one `batch` per batch the other has not counted, lowest number first per signer, then `claims` pages, then `events-done`. | Nothing is merged. Each entry has moved only on the manifests that passed. |
| 7. Files | A link that can move files | Each asks with `file-ask`, in the order of section 5.6. The other sends the file natively or answers `file-no`. Each sends `files-done` when it wants no more. | Backups may be cut by the asker (section 5.11). |
| 8. Done | Same link | Each sends `holdings` for its own entry if it changed, then `done`. On the other's `done` it merges and sends `final`, and on the other's `final`, `bye` with `done`. | Each records both final summaries in `nearbyPeers`. |

```ts
type Message =
  | { t: 'hello'; protocol: { min: number; max: number }; can: string[]; reducerVersion: number;
      linesVersion: number; deviceId: string; wallMs: number; chain: ChainLink[]; proof: string }
  | { t: 'you-first' } // the initiator, in place of its hello, under an older generation
  | { t: 'discovery-key'; gen: number; key: string } // the hand-on, one hop: a newer generation of the session's language
  | { t: 'arrange'; summary: string; radios: { directByName: boolean; band5: boolean; hotspot: boolean; joinHotspot: boolean /* false on a disguised phone */ } }
  | { t: 'host'; attempt: number /* its place in the arranged plan */; kind: 'wifi-direct' | 'hotspot' | 'bluetooth'; ssid?: string; passphrase?: string; port?: number; band?: string; security?: string }
  | { t: 'ready' }
  | { t: 'have'; orgId: string; languageId: string; cursor: number; claimedSeq: number; revokedSeq: number;
      vector: Record<string, { mark: number; ahead: [number, number][] }>; // by install key
      holdings: Record<string, number> /* counters, by install key */ }
  | { t: 'revoked'; text: string; kid: string; sig: string } // the Worker's list, sent only when the other's seq is lower
  | { t: 'holdings'; key: string; counter: number; files: string[]; more: boolean; hold?: boolean; sig?: string; chain?: ChainLink[] } // at most 8,000 hashes a message; hold, sig and chain on the last part
  | { t: 'holdings-end' }
  | { t: 'batch'; manifest: string; sig: string; chain: ChainLink[]; events: AnyEvent[] }
  | { t: 'claims'; text: string; kid: string; sig: string; events: AnyEvent[] } // the Worker's attestation; events may be a subset of its rows
  | { t: 'events-done'; older: boolean }
  | { t: 'file-ask'; transferId: string; hash: string; format: string }
  | { t: 'file-no'; transferId: string; reason: 'not-here' | 'not-referenced' | 'redacted' }
  | { t: 'files-done' }
  | { t: 'done' }
  | { t: 'final'; summary: string }
  | { t: 'bye'; reason: 'done' | 'nothing' | 'busy' | 'protocol' | 'identity' | 'not-member' | 'stopped' }
  // Phase 6, with the abilities let-in and starting-copy (section 14.1):
  | { t: 'join-ask'; installKey: string; idSalt: string; profileId: string; deviceId: string; name: string; proof: string } // the newcomer, first
  | { t: 'join-grant'; chain: ChainLink[]; proof: string; discoveryKey: string; gen: number; floor: number } // the inviter, after one tap; the pass is inside the chain
  | { t: 'copy-ask'; part: 'state' | 'rows' | 'names' | 'doc'; stream?: string; after?: string; hash?: string }
  | { t: 'copy-part'; part: string; stream?: string; next: string | null; body: string } // body at most 900 KiB
  | { t: 'copy-no'; reason: 'versions' | 'not-filled' | 'not-allowed' | 'not-here' };
```

`hello` never loses a field, because it is how two versions learn to talk. `can` holds
ability names, and one a phone does not know is ignored. The first release says `files`,
`let-in` and `starting-copy`. `wallMs` lets each side warn about a clock over 5 minutes
off and refuse to let someone in (section 14.1). A link that cannot move files leaves out
steps 5 and 7 and the `holdings` of step 8, so it costs only events. Parse `vector`,
`holdings` and every other map into a `Map`, using `objectMemberNameIn`, because assigning
a `__proto__` key on a plain object sets its prototype. Cap every list by size. A QR link has
no step 3. `join-ask`, `join-grant` and the copy come between steps 2 and 4, and so does a
copy asked of a teammate after an ordinary Hello.

**The batch counter.** `n` is a safe integer from 1, per install key and stream, kept in its
own row, `nearbyCount:<org>/<stream>:<key>`, so a new key after a revocation counts from 1.
A number a teammate states never moves it; only a verified manifest this key signed does.
`vector` is
`nearbyVector:<org>/<stream>` in `meta`, one JSON row `{ "<public key>": { "mark": n,
"ahead": [[from, to], ...] } }`, because `meta` has no prefix scan. `parseVector` requires a
32-byte base64url key and ranges that are sorted, disjoint, safe and capped (32 as a
starting guess, an argument). Past the cap a phone keeps verified rows but records no number
that neither fills nor extends a range, so a hostile sender can fragment the list but cannot
force a gap closed, and under-recording costs only a re-send. The vector survives pruning,
`dropStaleCheckpoint` and `resolvePendingRedaction`, since what those drop is confirmed.

`signUnsigned` runs before every summary goes out, under `exclusive`, one batch at a time.
It walks this device's `pending` rows with no `via`, in clock order, and groups them by
author. It leaves out anyone on this phone with no certificate for this organization, any
row whose id or entity id is not bound to its author, and `v1.Redacted` and
`v1.ExternalValueSet`. Those rows stay as they are, and the first two kinds are counted for
the screen. It closes a batch at 200 events or 512 KiB of event text, so a page always fits
in a message. `n` is the counter plus 1, refused if that is not a safe integer. `floor` is
worked out at the end of a sync: one below this key's lowest `nearby_batches` row that still
has a row `pending` or `nearby` here, or the counter if none does. When it has moved, the next
signing makes a batch even with no events. One commit writes the rows with `via`, the
`nearby_batches` row, the counter and `n` in this key's own vector entry. Without that entry
a phone's summary could never equal a teammate's who holds all its work, and "Up to date"
would never come. A restamp writes its rows with no `via`, which is all it takes to re-sign
them in a later batch.

Sending a batch reads the row and `getMany` of its ids, then keeps those `batchRowsToSend`
allows: `pending` or `nearby`, `via.batch` equal to `n` and `via.key` the signer, not
redacted, not `v1.Redacted` and not `v1.ExternalValueSet`, each stripped by `nearbyCopy`. It
sends the manifest even with no events, so its floor travels, and a phone already holding
every id can count it. A confirmed row goes by claim instead.

Receiving a `batch` runs in this order. A failure in 1 to 3 drops the page, and its number
stays open.

1. Parse the manifest. `orgId` and `streamId` are the session's, `n` and `floor` are safe
   integers, there are at most 200 entries and no id twice. A number this phone has already
   counted is ignored. A signer over budget is dropped here, before any signature work
   (section 5.4).
2. `checkChain(chain, { now: null, ... })`. The holder's `installKey`, `deviceId` and
   `profileId` equal the manifest's `key`, `deviceId` and `actorId`.
3. Verify `sig` with the holder's `installKey`, outside `exclusive`.
4. For each event: its id is in the manifest, `eventDigest` matches, its `actorId` and
   `deviceId` equal the manifest's, and if the revocation list names this key and person, its
   `hlc` wall is before `revokedAtMs`. A mismatch or a later date is refused for good, and
   holds nothing.
5. Pre-read `getMany` of every id in the manifest and the door's facts, and leave out ids
   already here. Run the door.
6. In `exclusive`: bounded clock, apply, `lines.touched` and `refresh`, `revision += 1`,
   then one commit: `receive` (status `nearby`, `via: { batch: n, key }`), `batches` if any
   row was kept or this is the signer's newest manifest here, clock and vector meta. A row
   the door refused, for good or with `retry: true`, is not written, so a flood of refused
   rows takes no disk.
7. Count `n` if the batch is whole (section 5.3) and the door said no `retry: true`. Otherwise
   it stays open, and the next session sends it again. Either way, `mark = max(mark, floor)`.
   A refusal for good counts as here, unless it was a digest mismatch. If `key` is this
   phone's own, its counter becomes `max(counter, n)`.

`older` in `events-done` is true when this sender's log starts above the other's `max(cursor,
claimedSeq)`, so it could not send all it knows of, and the screen says so.

When a phone takes a newer revocation list, it goes over `nearby_batches` by their stored
chains, marks later-dated rows `rejected` with a reason, calls `lines.touched` and refolds.
Try again does not bring those back.

**Claims.** After each pull, a phone holding a certificate for this organization asks `POST
/api/nearby/attest` to vouch for what it pulled, so `syncNow` becomes push, deliver, pull,
attest, sweep. It checks each answer against its own rows as it arrives, so a mismatch shows
in diagnostics while it is still online, and keeps answers in `nearby_attests`, dropped as
`prune` passes them. It attests in `serverSeq` order and claims only up to the contiguous
attested seq, so a failed page cannot push `claimedSeq` past rows the receiver never got. It
sends only attested rows, and Ready to carry counts the rest.

Claims have their own mark. `nearbyClaimed:<org>/<stream>` is the highest `serverSeq` this
phone has been sent by claim, and Have carries it as `claimedSeq`. `shouldClaim` is true
for a `confirmed` row with `serverSeq` above `max(them.cursor, them.claimedSeq)`, attested
here, not server-only, not `v1.Redacted`, not `v1.ExternalValueSet`, not of an organization
type, not redacted. Claims go in `serverSeq` order, 200 to a page or 512 KiB. Receiving a
`claims` page verifies `sig` against `rootKeys[kid]`, checks that `orgId` and `streamId` are
the session's, and that each event's digest and `serverSeq` are in the attestation's rows. A
claim with no valid attestation is refused. It runs the door with `claim: true`, which is
steps 1 to 8 and 12, skipping 9 to 11 because the server already held the event, which also
means a reviewer added after the village went offline is not refused. It commits with `via: { claim: { key, seq } }`, `key`
being Hello's, and the new mark. A row already here is left as it is, whichever way it came,
because any difference is a pre-restamp clock and the pull's comparison settles it. If every
row of a batch was already here by claim, no manifest is kept unless it is that signer's
newest, which is safe because the server has all of it. A receiver stores no attestation in
this release, so a claim is first-hand only.
Passing one on later is an ability in Hello.

**Manifests and canonical bytes.** `packages/core/src/nearbySigning.ts`. Every text is
built on `canonicalJson` (`packages/core/src/libraryDocs.ts`), with a prefix per purpose
so that a signature made for one cannot be replayed for another. The bytes are always
`utf8Encode(prefix + text)`. Signatures are plain Ed25519 over those bytes. `sha256` and
`verify` are passed in, and either may answer with a promise (`Sha256` and `Verify`, under
Chains), so `eventDigest`, `newcomerProfileId` and whatever else takes one are async. On a
phone `sha256` is `@noble/hashes`, which is
synchronous and already a dependency of `apps/mobile`, and on the Worker it is
`crypto.subtle`, which is not.

| Purpose | Prefix | Text | Who |
| --- | --- | --- | --- |
| Event digest | `lq-nearby-event-v1\n` | `canonicalJson({ id, type, orgId, streamId, actorId, deviceId, hlc, parentEventId, payload })`. No `serverSeq`. An absent parent canonicalizes as absent. | Hashed, not signed |
| Batch | `lq-nearby-batch-v1\n` | The `manifest` string below | The author's install key |
| Attestation | `lq-nearby-attest-v1\n` | The `text` string: `canonicalJson({ v: 1, kid, orgId, streamId, rows: [[id, digest, serverSeq], ...] })`, at most 200 rows, with no expiry. A golden vector holds the Worker's digest equal to a pulled row's, including an absent parent. | The Worker, over rows it read itself |
| Revocation list | `lq-nearby-revoked-v1\n` | The `text` string: `canonicalJson({ v: 1, kid, orgId, seq, keys: [[publicKey, profileId, revokedAtMs], ...] })` | The Worker |
| Holdings entry | `lq-nearby-holdings-v2\n` | `canonicalJson({ v: 2, orgId, streamId, key, counter, filesHash, hold })`, `hold` true when the owner's "Hold teammates' recordings" row is on, `filesHash` being the lowercase hex SHA-256 of `utf8Encode(canonicalJson(files))`, files sorted, which the receiver works out itself | The owner's install key |
| Newcomer's id | `lq-nearby-newcomer-v1\n` | The 32 decoded key bytes, then the 16 `idSalt` bytes (section 5.12, Chains) | Hashed, not signed |
| Session proof | `lq-nearby-proof-v1\n` | `<i or r>\n<hex of th>` | The sender's install key |
| Chain link | `lq-nearby-link-v1\n` | `canonicalJson({ kind, kid, body, prev })`, `prev` being the link before's `sig`, or `''`. An `invite@1` link has no `kid`, which canonicalizes as absent. | The Worker, or the key the link before names |
| Join pass | `lq-nearby-pass-v1\n` | `canonicalJson({ kind, kid, body })` | The Worker |
| Pass id | `lq-nearby-passid-v1\n` | `canonicalJson({ orgId, languageId, inviter, inviterKey, window })`, of which `passId` is the first 16 bytes of the SHA-256, in lowercase hex (The server's names, below) | Hashed, not signed |
| Certificate request | `lq-nearby-certreq-v1\n` | `canonicalJson({ profileId, deviceId, publicKey })`. No time, since field clocks are wrong and this is useless without that person's token. | The install key |
| First contact | `lq-nearby-join-v1\n` | `canonicalJson({ profileId, deviceId, publicKey, requestId })` | The newcomer's key |
| Summary | `lq-nearby-summary-v1\n` | `summaryText`, below | Hashed, not signed |

```ts
interface BatchManifest {
  v: 1;
  orgId: string;
  streamId: string;
  key: string; // the signer's install key; the vector and n are per this
  deviceId: string; // a label for the clock check, which proves nothing
  actorId: string; // one author to a batch, because a certificate names one person
  n: number;
  floor: number; // none of this key's batches at or below this has a row still pending or nearby on its phone
  events: [id: string, digest: string][]; // in clock order, at most 200
}
```

The `manifest` on the wire and in the store is the string `canonicalJson(manifest)`,
exactly as signed, so nobody has to reproduce it. Golden vectors in
`packages/core/test/nearbySigning.test.ts` fix each text, and the Worker's test reads the
same ones.

**The store.** A manifest cannot live on a row: it holds up to 200 ids and digests.

```sql
-- SqliteStore.open; MemoryStore mirrors it. No index on events: it would run over everyone's log.
alter table events add column via text; -- guarded by the pragma read already there
create table if not exists nearby_batches (
  org_id text not null,
  stream_id text not null,
  signer_key text not null,
  n integer not null,
  device_id text not null,
  actor_id text not null,
  first_hlc text,           -- its oldest event's clock, for delivery's order; null with no events
  manifest text not null,   -- the canonical text as signed
  sig text not null,
  chain text not null,      -- the signer's chain at signing, JSON
  primary key (org_id, stream_id, signer_key, n)
);
create table if not exists nearby_attests (
  org_id text not null,
  stream_id text not null,
  last_seq integer not null,
  text text not null,       -- the canonical text as signed
  kid text not null,
  sig text not null,
  primary key (org_id, stream_id, last_seq)
);
```

```ts
// packages/sync/src/types.ts
export type NearbyVia = { batch: number; key: string } | { claim: { key: string; seq: number } };
export interface LocalEvent { event: AnyEvent; status: LocalEventStatus; rejectReason?: string; via?: NearbyVia }
export interface NearbyBatchRow {
  orgId: string; streamId: string; key: string; n: number; deviceId: string; actorId: string;
  firstHlc: string | null; manifest: string; sig: string; chain: string;
}
export interface NearbyAttestRow { orgId: string; streamId: string; lastSeq: number; text: string; kid: string; sig: string }
// WriteBatch gains, inside the same transaction:
receive?: LocalEvent[];                                                 // insert only: on conflict do nothing
dropNearby?: { orgId: string; streamId: string; ids: string[] };        // deletes only where status = 'nearby'
batches?: NearbyBatchRow[];                                             // insert only: the first signature for a number stays
dropBatches?: { orgId: string; streamId: string; keys: { key: string; n: number }[] };
attests?: NearbyAttestRow[];                                            // insert only
dropAttests?: { orgId: string; streamId: string; upToSeq: number };
// EventStore gains, all required, so a store missing one cannot silently break a trap:
unconfirmedCount(orgId, streamId): Promise<number>;                     // pending + nearby: the two checkpoint gates
nearbyCount(orgId, streamId): Promise<number>;
nearbyPage(orgId, streamId, afterId, limit): Promise<LocalEvent[]>;     // by id: for the sweep
getMany(ids): Promise<LocalEvent[]>;                                    // ids as one JSON array with json_each, in slices
unsignedPage(orgId, streamId, afterHlc, limit): Promise<LocalEvent[]>;  // pending with no via
confirmedAfter(orgId, streamId, afterSeq, limit): Promise<LocalEvent[]>; // by server_seq: for claims
batchKeys(orgId, streamId): Promise<{ key: string; n: number; actorId: string; firstHlc: string | null }[]>;
batchesAfter(orgId, streamId, key, afterN, limit): Promise<NearbyBatchRow[]>;
attestedUpTo(orgId, streamId): Promise<NearbyAttestRow[]>;
clearMeta(prefix): Promise<void>;                                       // for nearbyPeers at sign-out, and must not block it
// Transport gains, all optional, each in the three lists by hand (above):
knownEvents?(orgId, streamId, ids): Promise<{ id: string; serverSeq: number; hlc: string; actorId: string }[] | null>; // null: the database is behind
attest?(orgId, streamId, afterSeq): Promise<{ text: string; kid: string; sig: string } | null>;                        // null: off, or not yet
relay?(orgId, streamId, batches: RelayBatch[]): Promise<{ key: string; n: number; refused?: string; verdicts?: AppendResult[] }[] | null>; // null: not yet; LQ001 throws ClientTooOldError
export interface RelayBatch { manifest: string; sig: string; chain: ChainLink[]; events: AnyEvent[] }
```

`SupabaseTransport` has `knownEvents`. It knows no Worker address, so
`apps/mobile/src/server/sync.ts` adds `attest` and `relay` from `src/server/nearby.ts`.

The upsert in `putOn` writes `via = excluded.via`, so confirming a row, restamping it or a
push refusing its author's own row clears `via`. That last is what lets `requeue`, which
leaves out rows with a `via`, still take an author's refused row, which then signs again in
a later batch. A batch goes when nothing is left for it to speak for: at the end of a sync
on a phone holding any `nearby_batches` row, each batch's ids are read with `getMany`, and
one with no row that is `pending`, `nearby` or `rejected` with that `via` goes
through `dropBatches`, because Try again can return a refused row to `nearby`. Each signer's
newest manifest stays, so its floor travels on, at the cost of one manifest and chain per
signer. A manifest's chain is at most 2 to 3 KB by estimate, and each page carries it in full,
for simplicity. The contract tests run on both stores, and include the same id on another
stream.

Other meta rows, one row each and written at the moments given, never per file:
`nearbyHoldings:<org>/<stream>:<key>`, holding the entry with its `sig` and `chain`, and
`nearbyHoldingsIndex:<org>/<stream>`, at the end of step 5 and at step 8;
`nearbyPeers:<org>/<stream>`, at step 8, an ordered list of `{ tag, gen, mine, theirs }`, most
recent last, with no time, device or person; `nearbyToday`, one phone-wide `{ day, tags }`
for "today", dropped when the day changes, and both dropped when this phone takes a new
generation; `nearbyHold`, one phone-wide true or false, written only when someone presses the
row (section 5.6); `nearbyNames:<org>`, install key to `profileId`,
filled from every checked chain, which does not by itself say a meeting took place;
`nearbyRevoked:<org>`, the newest list; `nearbyRestamped:<org>/<stream>`, by a restamp;
`nearbyChain:<profileId>`, a map of organization id to that organization's chain, replaced
whole when a certificate answer arrives, never merged, so a turned-off organization's goes,
except that an organization whose new chain this build cannot check (the Worker's key rotated
past it) keeps the chain it held, and its discovery keys, while that chain still checks;
in phase 6, `nearbyPasses:<profileId>`, that person's join passes, replaced whole the same
way, and `startingCopy:<org>/<stream>`.

The install key is in `secureStorage`, and so is `nearbyFindKeys:<profileId>`, the discovery
keys of whoever is signed in, one entry per language (Generations, below). At sign-out they
are sealed with that person's session, in the
same place (`server/lock.ts`), and they come back at sign-in. Everything above is plain
SQLite, and `nearbyPeers`, `nearbyToday`, the vector and chains
say who is on the team, so they are not secrets but not harmless either, because a taken
phone gives them up. So no meeting time is kept. `nearbyPeers` and `nearbyToday` are cleared
at the end of any completed sync, unless the room is running, and at any sign-out. All that
costs is partner order and perhaps one extra session. Android's backup rules leave the
database out today (`configureAndroidBackup`), and a test holds that, so a later rules change
cannot reopen it.

**Chains.** `packages/core/src/nearbyChain.ts`.

```ts
type Verify = (publicKey: string, message: Uint8Array, signature: string) => boolean | Promise<boolean>;
type Sha256 = (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;

interface ChainOrg {
  orgId: string;
  orgSeq: number; // the newest seq of this organization's _org stream at signing
  scopes: { level: 'org' | 'language'; languageId?: string; privileges: Privilege[] }[];
}
interface WorkerLink {
  kind: 'worker@1'; kid: string;
  body: { installKey: string; profileId: string; deviceId: string; expiresAt: number; org: ChainOrg }; // one organization to a link
  sig: string;
}
interface JoinPass {
  kind: 'pass@1'; kid: string;
  body: { passId: string; orgId: string; languageId: string; inviter: string; inviterKey: string;
          roles: { roleId: string; privileges: Privilege[] }[]; maxUses: number; expiresAt: number };
  sig: string;
}
interface InviteLink { // issued from phase 6; checked from phase 2
  kind: 'invite@1';
  body: { pass: JoinPass; installKey: string; idSalt: string; profileId: string; deviceId: string; name: string;
          roleId: string; privileges: Privilege[] };
  sig: string; // by the installKey the link before names
}
type ChainLink = WorkerLink | InviteLink;

function checkChain(chain: readonly unknown[], opts: {
  rootKeys: ReadonlyMap<string, string>; // kid to public key
  orgId: string;
  languageId?: string;
  now: number | null; // null skips every expiry
  verify: Verify;
  sha256: Sha256;
  revoked?: RevocationList; // given at Hello and for a copy; not for a batch, which applies its date rule per event
  maxLinks?: number; // 2
}): Promise<{ ok: true; holder: { installKey: string; profileId: string; deviceId: string; name?: string };
              org: ChainOrg; links: number; inviter?: string; roleId?: string } | { ok: false; reason: string }>;
```

`checkChain` is a loop. It refuses a kind it does not know before any verify, and more
links than `maxLinks`. For a two-link chain, `holder` is the newcomer, and `org` is built
from the invite link's privileges at language scope, with the first link's `orgSeq`.

- **The first link** must be `worker@1`, verified against `rootKeys[kid]`. An unknown
  `kid` is refused. `body.org` must be one object naming `orgId`. Its `deviceId` must be a
  UUID, as the Worker also requires, once `diag.installs` confirms no live phone holds
  anything else.
- **A later link** must be `invite@1`, verified against the `installKey` of the link
  before. Its pass is verified against `rootKeys`, and its `orgId` and `languageId` must
  match. Its `inviterKey` and `inviter` equal the link before's `installKey` and
  `profileId`. Its chosen `roleId` is in `pass.roles` with the same privileges, none of
  them in core's `MANAGE_PRIVILEGES`. The link before holds `invite_members` and every one
  of those privileges in that language. That is `mayGrantRole`'s rule on signed
  privileges, so it works with a stale fold. Uses are counted only by the server at first
  contact.
- **A newcomer's id follows from their key.** A newcomer who chose their own `profileId`
  could name an admin, or an imported v2 person who has not signed in yet, and the inviter's
  tap shows only a typed name. So an `invite@1` link's `profileId` must equal
  `newcomerProfileId(installKey, idSalt)`: the first 16 bytes of the SHA-256 of the
  newcomer's-id text, with UUID version 4 and variant bits set, in lower case. `checkChain`
  recomputes it, by exact string, and refuses a non-canonical base64url key, a salt that is
  not 16 bytes, and a link whose `installKey` equals the link before's. Aiming at a chosen
  id then needs about 2^122 work, on phones and at the server alike, against existing
  accounts, imported people, v2 people not yet imported and other newcomers. The salt means
  a second person on one install gets a new id rather than the first person's account. It
  applies only to `invite@1`, so a `worker@1` link and a key replaced after revocation are
  unaffected. `deviceId` is not derived, since it proves nothing and comes from
  `ensureDeviceId`.
- **The revocation list.** With `revoked` given, a chain with a listed `(installKey,
  profileId)` pair in any link is refused. Pairs, not bare keys, so another person on a
  shared phone is not refused because of one person's lost phone (section 6). The list's
  highest `seq` wins, and an entry drops a year after `revokedAtMs`, when Hello's expiry
  covers it.
- **Expiry.** With `now` a number, the `worker@1` link and the pass must not be past
  `expiresAt`. Hello passes `max(wall, last hlc)`. Nothing has a not-before. Every batch's
  chain and the relay pass `now: null`: batches are carried for months, and for the relay
  the `install_keys` row is the truth.
- **Which door answer it gives.** `peopleWithChains(org, verdicts, orgSeqHere, revoked)` wraps
  a `NearbyPeople` and takes the `OrgState`, because it must tell no entry from a removed
  one. `orgSeqHere` is `max(store.cursor, the organization checkpoint's serverSeq)` on every
  phone, since `OrgState` holds no seq. `adoptStartingCopy` keeps the sender's `serverSeq` in
  that checkpoint with the cursor still at 0, so a starting copy's fold beats a year-old
  certificate. Then:
  - A one-link chain answers only when `org.orgSeq` is above `orgSeqHere`.
  - A two-link chain answers only while `org.members` has no entry at all for that person,
    so a removed entry refuses and a live one answers from the fold, which keeps an admin's
    raised role working (Carl's answer 8).
  - When `orgSeqHere` is at or above the chain's `orgSeq`, a two-link chain also needs
    `mayGrantRole(org, inviter, roleId, { level: 'language', languageId })` and an inviter
    key not on the list. That is core's twin of `_invite_still_granted`, so it covers a
    removed inviter, lost Invite, lost privileges and a retired role, and refuses only people
    the server would refuse too. It then answers with the signed privileges the role still
    holds in the fold. Below that sequence the signed link decides, so a team that has not
    synced carries on.

  A refusal is the door's `retry: true` and Hello's `bye` `not-member`, so nothing is
  dropped. Only people the fold can speak for are covered: uses and an organization turned
  off stay with the server. That is the one extension the door needs for phase 6.

`rootKeys` comes from `EXPO_PUBLIC_NEARBY_CERT_KEYS` on a phone and `NEARBY_CERT_KEYS` on
the Worker, both `kid:base64url,...`, and a test holds them equal. `EXPO_PUBLIC_*` is
inlined at bundle time, and a phone trusts only what is bundled in it, so rotation
overlaps, and a retired `kid` stays listed. The private key is `NEARBY_SIGNING_KEY`, one
compact JWK with its `kid`, a secret of its own and not derived from the service key,
since rotating that would strand offline phones.

**The server's names.** All in migrations later than `20261106120000`, with new functions
revoked from every role that should not call them, because functions default open.

- `org_features(org_id, feature check (feature in ('nearby', 'nearby_join')), granted_at,
  granted_by, revoked_at, revoked_by)`, primary key `(org_id, feature)`, copying
  `org_importers`, with `org_feature_grant`, `org_feature_revoke` and `org_feature_list`
  for staff.
- `install_keys(public_key, profile_id references auth.users on delete cascade,
  install_id, created_at, last_certified_at, first_session_at, revoked_at, revoked_by,
  after_revoked_events int not null default 0, after_revoked_bytes bigint not null default 0,
  after_revoked_events_limit int not null default 50000,
  after_revoked_bytes_limit bigint not null default 104857600, after_revoked_raised_by text)`,
  primary key `(public_key, profile_id)`, because one key can serve several people on a
  shared phone. `install_id` is the `deviceId`, a label with no uniqueness: a first-come rule
  would let a member take an id before its owner certifies, and would refuse a phone whose
  key was lost. The last five are section 6's cap. The service role only.
- `install_key_limit_raise(p_key, p_profile, p_events, p_bytes, p_by)`, for staff, the service
  role only. It sets one row's two limits to the greater of what they are and what it is given,
  so it never lowers one, and keeps `p_by` in `after_revoked_raised_by`.
- `install_key_revocations(org_id, seq, public_key, profile_id references auth.users on
  delete cascade, revoked_at)`, the service role only, written in `revoke_install_keys`'
  transaction (section 6), one row per organization of that person, with `seq` per
  organization. It is its own table, because a list derived from current memberships would
  shrink when someone is removed.
- `language_discovery_chains(org_id, language_id, top int not null, seed bytea not null)`,
  primary key `(org_id, language_id)`, and `language_discovery_keys(org_id, language_id,
  generation int, key bytea not null, org_seq bigint not null, created_at timestamptz not null
  default now())`, primary key `(org_id, language_id, generation)`, both the service role only.
  `org_seq` is the `_org` stream's newest seq when the row was made. `_discovery_generation(p_org,
  p_language)` makes the chain and a generation when they are due (Generations, below).
- `nearby_certificate_facts(p_profile, p_install, p_key, p_languages)`, the service role
  only. It reads for a revoked row first, and sets `first_session_at = coalesce(
  first_session_at, now())` on all of that person's rows, before any feature check, because
  a bearer token is a session. It then finds organizations with `nearby` on where the person
  has a live membership, and upserts the `install_keys` row only if there is one, so open
  sign-up cannot add rows. A row it inserts starts with `first_session_at` set. It allows a
  small number of new keys per person in a rolling window (5 in 24 hours as a starting
  guess); refreshing a known key never counts, and nothing is evicted, so a reinstall cannot
  strand anyone and a stolen token cannot push out the real phone's key. It answers, per
  organization, the `_org` stream's newest seq, resolved privileges per scope, the newest
  generation and its `floor` for each language the phone named and the person may read, after
  `_discovery_generation`, and the revocation list. From phase 6, roles for passes too, for
  anyone holding Invite there, looked-after or not (Carl's answer 18, and decision 67), with no
  check of `is_managed_account`.
- **A pass's id and expiry,** worked out by the Worker when it signs a pass (Carl's answer 17),
  on its own clock, with nothing stored:

  ```
  window    = floor(nowMs / 7776000000)                      // 90 days in milliseconds
  passId    = the Pass id text above, with that window
  expiresAt = (window + 1) * 7776000000
  ```

  So every certificate answer in a window gives the same id for the same organization,
  language, inviter and key, and the daily refresh makes no new uses. A new key after a
  revocation gets a new id, and so does a new window. A golden vector holds the id.
- `known_events(p_org, p_stream, p_ids) returns table(id, server_seq, hlc, actor_id)`: raises
  42501 unless `can_read_stream` for the caller, and 22023 above 500 ids, and filters by
  organization and stream so no other stream's id leaks. On `PGRST202`,
  `SupabaseTransport.knownEvents` answers null.
- `get_user_state` gains `orgFeatures`, `{ "<orgId>": ["nearby", "nearby_join"] }`, for
  the caller's organizations, and `nearbyRevokedSeq`, `{ "<orgId>": seq }`, so a phone behind
  it asks at once instead of waiting a day.
- `POST /api/nearby/certificate`, with a bearer token and `{ publicKey, deviceId, languages,
  proof }`, answers `{ chains: [{ orgId, chain }], discoveryKeys: [{ orgId, languageId, gen,
  floor, key }], passes, revocations: [{ orgId, text, kid, sig }] }`. With no organization on, every
  list is empty, and the phone drops what it holds. With a revoked key it answers `{ revoked:
  true }`: the phone drops every certificate naming the old key and makes a new one. A
  signed-out person's rows there stay unsigned and are counted for the screen until they next
  sign in, and their earlier signed batches still travel. It answers 503 with no
  `NEARBY_SIGNING_KEY` or on `PGRST202`, and 429 past the limits, when the phone keeps what it
  holds and tries again at its next check. The route goes through `profileOf` and asks
  `session_is_live` uncached, because decision 118's 30-second cache would let a phone whose
  sessions were just ended make a new key, and has a per-minute limiter keyed by profile id,
  a binding of its own.
- `POST /api/nearby/attest`, with a bearer token and `{ orgId, streamId, afterSeq }`. There
  are no digests in the request, or the route would sign whatever it was sent. The Worker
  calls `pull_events` with the caller's token, so `can_read_stream` gates it, maps rows
  exactly as `SupabaseTransport.pull` does, computes `eventDigest` itself and signs at most
  200 rows. It refuses `_org` and `_person` streams, answers 403 to anyone who may not read
  the stream before it asks whether `nearby` is on (so it tells no outsider which
  organizations have it on), answers null when `nearby` is off for the organization, and
  answers 503 with no key. A confirmed tail is usually about 10 pages,
  because `checkpointEvery` is 2,000. It answers `{ text, kid, sig }`.
- `POST /api/relay`, with a bearer token and `{ orgId, streamId, clientVersion, batches:
  RelayBatch[] }`, answers `{ batches: [{ key, n, refused?, verdicts? }] }`, `verdicts` being
  section 6's per-event answers and `refused` the reason a whole batch was not tried. A phone
  sends one batch at a time, so each batch's verdicts are saved before the next. LQ001
  answers 426 with `{ code: 'LQ001', message }`, and a missing secret or `PGRST202` answers
  503.
- `POST /api/nearby/join`, signed out, with `{ chain, proof, profileId, requestId, token? }`
  (section 14.1), `proof` being over the First contact text with the invite link's key and
  device. It answers as `supabase/functions/join` does: `{ session, orgId, signInName }`,
  with `session` left out once key sign-in no longer applies, 410 with `{ error, status? }`
  for a refusal, and 503 or 429 for not yet.

On a phone, `useNearbyIdentity` (Android only, from `SyncEffects`) reads `orgFeatures`
through a small reader shared with `useGlobalViewer`, drops the signed-in person's chain and
discovery keys for any organization no longer listed there, with no call, makes the key if
there is none, and asks for a certificate after an organization pull, once a day, when this
person's membership changed, when `nearbyRevokedSeq` says it is behind, or the first time a
language with no key opens. It asks only while some organization of theirs is listed. It
names the languages this phone holds (decision 37). `useFirstContact` calls the
same route whatever the flag says, so that `first_session_at` gets written (section 14.1).

**Find, and the short Bluetooth exchange.** With `discoveryKey` the key of one generation of
the open language (Generations, below):

```
kFind   = HKDF-SHA256(ikm = discoveryKey, salt = '', info = 'lq-nearby-find-v1', 32 bytes)
kSess   = HKDF-SHA256(ikm = discoveryKey, salt = '', info = 'lq-nearby-sess-v1', 32 bytes)
salt    = 6 random bytes, new at each start and each rotation
r       = 2 random bytes, new at each refresh, never repeated under one salt
tag     = HMAC-SHA256(kFind, 'tag' || install key bytes)[0..6], with the top 4 bits of byte 4 cleared
summary = SHA-256(utf8('lq-nearby-summary-v1\n' + summaryText))[0..4], with the top 2 bits of byte 0 cleared
echo    = HMAC-SHA256(kFind, 'echo' || a heard salt || r)[0..4], or 4 random bytes

advert        = v4(salt || HMAC-SHA256(kFind, 'find' || salt)[0..10])
scan response = v4(r || ((tag || summary || echo) XOR HMAC-SHA256(kFind, 'sum' || salt || r)[0..14]))
v4(x)         = x as one 128-bit service UUID, with byte 6's top 4 bits set to 0100 and byte 8's top 2 to 10
```

A `deviceId` is `ensureDeviceId`'s; there is no second install id. The tag is worked out
from the install key because a `deviceId` can name a teammate. In a message or in
`nearbyPeers`, a summary is the hex of its 4 bytes and a tag the hex of its 6, with those
bits clear wherever they are used, because a receiver clears the same bits after
unmasking; a golden vector holds equal summaries equal under two salts. A legacy advert
has room for this and nothing else. There is no manufacturer or service data, because
their fixed ids would mark the phone, and no device name or transmit power. Core Bluetooth
can advertise only a local name and service UUIDs, so this form keeps phase 5 from
changing the protocol. Every UUID is a valid version 4, because the random version and
variant bits of an underived one are themselves a thing to filter on, and that leaves 74
bits of MAC. Native matches each advert itself, with a cache per salt, and hands up matches,
unmasked, and the salts of adverts of this form that match no key. So the `kFind` of every
generation it scans for sits in native memory while Find runs. GATT service and
characteristic UUIDs derive from the advertiser's `kFind` and the salt in the same way. A phone
that cannot advertise can still scan and connect. A phone writes `nearbyPeers` under the tag worked
out from Hello's chain, never the advert's, and ends the session if they differ.

**No mask is reused.** The room refreshes the scan response on a fixed tick (about 2 seconds
as a starting guess, an argument from JavaScript), whether or not anyone was heard, with a
new `r` and so a new mask. Otherwise the XOR of two responses under one salt would show six
zero bytes and then bytes that vary, which is the tag and summary layout, to a scanner holding
no key. So a summary can change at any tick, even during a session, and a stranger sees 14
fresh random bytes each time and cannot tell an echo from noise. A teammate can link them, and
may. A summary that has not changed still goes out under a new mask.

**Rotation.** A rotation stops the advertising set, swaps the GATT service and starts a
new set with a new salt, and waits for the stopped callback in between. Nothing changes
the salt on a live set, so salt and Bluetooth address change together and neither carries
a link across the other's change. Native runs the timer, on a jittered period set from
JavaScript whose top stays below the stack's shortest own timer (7 minutes in AOSP), so 4
to 6 minutes as a starting guess. Rotation keeps running through a Wi-Fi session, because
the pipe has closed by then. While a pipe that has passed its opening is open the salt
stays, and rotation happens as soon as it closes. A connection that has not passed its
opening holds nothing back (Session keys, below). Advertising stays on throughout, so a
third phone keeps hearing a busy teammate and does not say "Up to date". On some
controllers a restart keeps the address, or the address is the public one. Section 11
measures that. Those phones still run, because refusing could strand a team, and two
sightings with a gap between them stay unlinked. The decision entry says so.

**The echo.** An advert has no clock, so a recording of one verifies for good. Played back
elsewhere, it would draw any teammate's phone to connect, and the connection alone says
that phone holds that team's key. So a phone that can advertise connects only after
hearing its own current or previous salt echoed, and forgets every echo when its own salt
changes, so a recording made while a teammate was live stops counting once it names neither
salt; a live teammate echoes again at once, since its advert names the previous salt until
it hears the new one. Each tick fills the `echo` slot for the
next salt it has heard, chosen partner first, so every pair in a room of five gets a turn,
then salts no key matched (Generations, below), and with random bytes when it has heard none.
A recording cannot answer a salt made after
it. No clock is involved, so wrong dates do not matter. The gate is in `NearbyRoom`, in
JavaScript, and a teammate shows on screen only once echoed. There is no timer that
connects anyway, since a stranger would simply wait. After a while with no echo, the
screen offers a tap (section 5.8). A phone that cannot advertise has no salt to echo, so
it connects as it does today and keeps this risk, which an argument from JavaScript can
change to a tap. A failed connect backs off, so a replay cannot hold off "Up to date". A
live relay to a real team phone can still pass, and needs a teammate live at the far end.

**The phone's own names.** On API 34 and up, advertise with `setDiscoverable(false)`,
which should stop unencrypted reads of the Device Name characteristic (0x2A00) on phones
with extended advertising. On API 29 to 33 a stranger who connects can read the phone's
Bluetooth name. `FindTunables.connectable`, `'always'` or `'after-hearing'` with its
window lengths, lets the real-phone test measure going connectable only after hearing a
teammate, and it starts as `'always'`. A flip keeps the salt, so `openPipe` still works.
Use `'after-hearing'` only where it costs no meetings, because a team that cannot meet
loses more than a name, and it only means connectable for less time.
`BluetoothAdapter.setName` could rename the phone for the session, which would close this
fully, but it changes a phone-wide setting and stays changed if the app is killed, so it
is turned down and left for the review.

A phone maps a tag to a person by computing, under the generation the advert matched, the
tag of each key in its vector and holdings, and each one named by a chain it holds, then
reading `nearbyNames` and the organization's names.

What goes over Bluetooth is steps 1 to 3 of a session: the opening, `you-first` and `hello`,
`arrange`, `discovery-key`, `host`. The vector and holdings wait for the faster link. If Wi-Fi
never comes up, the pipe carries on with steps 4, 6 and 8, for events alone. The GATT server
hosts, or the other phone if `radios` says the server cannot. For the hotspot, a phone says it
cannot join with `joinHotspot: false`, so the other joins and it hosts, and if neither can join
that kind is skipped. Both sides work this out from `arrange`, so they agree on who sends `host`.
The order tried is Wi-Fi Direct, the
hotspot, then staying on the pipe. That order, retries and deadlines are arguments from
JavaScript. For Wi-Fi Direct JavaScript chooses a name in Android's usual form,
`DIRECT-xy-Android_ab12`, with `xy` and the suffix fresh for each group, and a random
passphrase, and never calls `enablePersistentMode(true)`, because a saved group keeps the
device address. For the hotspot the system chooses, and `host` passes on what it chose.
Scanning stops during a session and advertising stays on, so a session notices nobody who
arrives after it began.

**Generations** (Carl's answer 13). `packages/core/src/nearbyGenerations.ts`.

```
key(g - 1) = SHA-256(utf8('lq-nearby-gen-v1') || key(g))     // 32 bytes each
```

Hashing runs only downward, so a chain has to be made from its far end. The first time a
language is named, the server picks a random 32-byte `seed` and `top = 10000`, so that
`key(top) = seed` and `key(g)` is `seed` hashed `top - g` times. Generations start at 1. At one
a day, the fastest allowed, that lasts over 27 years, and nothing handles running out. A golden
vector holds SQL and core equal (`scripts/record-parity-sql.ts`).

- **When the server makes one.** Only in `nearby_certificate_facts`, through
  `_discovery_generation`, for a language the phone named, with no trigger on the append path.
  The newest row is due when it is over 90 days old; or when a `v1.MemberRemoved` event on
  `_org` has a `server_seq` above the row's `org_seq` and a scope of the organization or this
  language; or when an `install_key_revocations` row for this organization has a `revoked_at`
  after the row's `created_at`. A due row more than a day old gets a next generation, so there
  is at most one per language per day, and a younger one waits for a later call. Two calls at
  once work out the same key, and `on conflict do nothing` keeps one. It compares `org_seq`
  and not `removed_hlc`, because that clock is the admin's. Removing someone who never held a
  key still makes a generation, which costs one hand-on per teammate.
- **What the answer holds.** One key, the newest, as `{ gen, floor, key }`. `floor` is the highest
  generation at least a year old, or 1. A phone behind that also has an expired certificate,
  since both came in one answer.
- **What a phone stores.** `nearbyFindKeys:<profileId>` is `{ "<org>/<language>": { gen, key,
  floor, direct } }`. A certificate answer replaces an entry with `direct: true`. A hand-on writes
  `gen` and `key` with `direct: false` and leaves `floor`. A `join-grant` writes all three with
  `direct: false`. A phone keeps no drop timer, because a timer strands long-offline teams on
  wrong dates, and its `floor` moves only when it hears from the server. Older keys are worked
  out when needed and never stored.
- **Advertising and scanning.** A phone advertises under its newest generation only. `scanKeys`
  holds the `kFind` of each generation from the newest down to `floor`, newest first, at most
  16, an argument from JavaScript, so a phone over 16 generations behind is not heard until it
  syncs. `SeenPhone.scan` says which key matched. JavaScript knows which generation that is, and
  native knows no generation numbers. Tags follow the generation, since `kFind` keys them, so a
  tag in `nearbyPeers` carries its `gen`, and taking a new generation costs partner order and
  perhaps one extra session.
- **Meeting a phone that is behind.** Only the phone with the newer key can hear the other, so
  it is always the initiator, and it connects under the generation it heard, whatever the tags
  say. The responder uses its own newest, the only key it advertises under. A phone behind cannot
  match a newer advert, so it could never echo that phone's salt, and the phone ahead would stop
  at the tap. So the room also fills the `echo` slot with salts from `onFormSalt`, after the
  salts it matched, in turn, strongest signal first, at most eight, an argument from JavaScript.
  It learns nothing from them, and the slot changes at the same rate. The phone ahead checks the
  echo under the generation it heard the other on, so a phone that is behind meets it with no
  tap. A scan-only phone has no salt to echo, and connects as it does today.
- **Holding back `hello`.** Under an older generation the initiator sends `you-first` in place of
  `hello`. The responder sends its `hello`, and the initiator checks it as in step 2, then sends
  its own or `bye`. So a lure playing an old advert learns no name: a removed member's chain fails
  against this phone's fold, and someone holding only a key has no chain. The cost is that
  someone holding an old key can send `you-first` to a phone still on it and read its chain. That
  phone is recognisable to them already (section 5.5).
- **The hand-on, one hop.** Once the responder's `arrange` has come, which says it passed this
  phone's `hello`, the initiator sends `discovery-key` if its entry is `direct`, its `gen` is above
  the session's, and its `orgSeqHere` has reached the `orgSeq` in the certificate that came with
  that key. That last rule means it has seen the removal that made the generation, so it has
  already refused that person at Hello. A phone that got its key by hand-on never passes it on,
  because its fold may not have seen the removal and it could hand the key to the person
  removed.
- **How the receiver checks it.** `handedKeyHolds(mine, handed, sha256, 1000)`: `handed.gen` is
  above `mine.gen` by at most 1,000, `handed.key` is 32 bytes, and hashing it down `handed.gen -
  mine.gen` times gives `mine.key`. Only someone holding a newer key can make that. A failure
  drops the message, ends nothing and counts in diagnostics. A success writes the entry at once,
  and the room restarts Find under it when the session ends, as it does when a certificate answer
  moves the key. The session stays on the keys it opened with.

**Holdings and the summary.** `packages/core/src/nearbyHoldings.ts`.

```ts
type Holdings = ReadonlyMap<string /* install key */, { counter: number; files: readonly string[]; hold: boolean; sig: string; chain: ChainLink[] }>; // sorted, unconfirmed hashes only; hold: the owner's row is on
```

- Only the owner changes its own entry, and it signs what it sets, `hold` included. `withMyHolding`
  bumps the counter only when the set or `hold` changed, and never jumps on a number it heard. A restored phone
  has a new key, so it has a new entry. Nobody else prunes an entry, or two phones would hold
  different lists under one counter.
- A receiver works out `filesHash` itself after the last `more` part, and verifies the entry
  outside `exclusive` and before `mergeHoldings`, using `checkChain` with `now: null` and the
  holder's `installKey` equal to the entry's `key`. It drops what fails, one entry at a time,
  and never ends the session for it. So a member cannot forge a teammate's entry, and a forged
  counter near the top of the safe range cannot pin one. A counter in `have` only says what to
  send. The chain is checked against the revocation list, and an entry whose holder Hello's
  read gate would refuse is dropped too. Stored entries can outlive a revocation or removal,
  so the files part reads them through `holdingsInForce`, which leaves out an entry whose key
  and holder, or first link's key and person, are listed, or whose person has only removed
  entries in the organization's fold.
- `mergeHoldings` skips this phone's own key, and takes the higher counter wholesale per
  key, so a phone can retract a file. A tie with different files, which only a restored or
  lying owner makes, goes to the lower `canonicalJson(files)`, so merging is commutative,
  associative and idempotent. A tie on files goes to `hold` false, then as before.
- `copiesOf(holdings)` gives hash to the number of distinct certified people holding it,
  by the first link's `profileId`. One person's many keys add one copy, so inventing
  devices cannot make a last copy look safe to delete. Counting a person with two phones,
  or an inviter and their newcomer, as one errs the safe way: the file looks rarer, so it
  is fetched sooner and deleted later. `parseHoldings` refuses member names, unsafe
  counters and non-hash files, and caps sizes.
- `summaryText(knownSeq, vector, holdings, revokedSeq) = canonicalJson({ k: knownSeq, v:
  vector, h: counters, r: revokedSeq })`, where `knownSeq = max(cursor, claimedSeq)`, `v`
  is `have.vector` with any entry at mark 0 and no ranges left out, so an absent entry and an
  empty one compare equal, and `h` maps key to counter. Counters stand for their
  lists, since only the owner changes one, so no phone hashes thousands of names at each
  change. `knownSeq` is in it so that a phone back from town has something to offer, and
  `r` so that a newer revocation list reaches a phone that otherwise knows the same
  things.

**What a phone keeps.** `packages/core/src/blobs.ts`, pure, given marks from the ledger.

```ts
type HoldChoice = { hold: true } | { hold: false; reviewWindow: number }; // passages, an argument from JavaScript; 5 as a starting guess
type NearbyGroup = 'needed' | 'review' | 'backup' | 'unnamed'; // nearbyGroupOf; 'unnamed' is a marked file no reference names, which goes first
interface NearbyMark { hash: string; format: string; languageId: string; group: NearbyGroup; copies: number } // the ledger's row (section 5.6)
interface WantedFile { hash: string; format: string; group: 'needed' | 'review' | 'backup' }
interface WantedFacts { // what the store query in section 5.6 and the session give
  refs: readonly { hash: string; format: string; confirmed: boolean }[]; // every file a reference names, with no stored verdict
  offlineScope: ReadonlySet<string>; // file hashes the offline scope names
  reviewOrder: readonly (readonly string[])[] | null; // file hashes per open-for-review passage, in upNextOf order; null for someone who cannot review
  copies: ReadonlyMap<string, number>; planOrder: readonly string[];
}
function wantedFilesOf(facts: WantedFacts, choice: HoldChoice): WantedFile[]; // no default, so each caller and test says which it means
function nearbyShedOf(marks: NearbyMark[], wanted: ReadonlySet<string>, holdings: Holdings, me: { key: string; signedIn: string },
  stored: (hash: string) => boolean): string[]; // called only with hold false; another person's entry counts when its hold is true or its key sorts below me.key
function backupsConfirmedOf(marks: NearbyMark[], verdict: (hash: string) => { stored: boolean; size: number } | undefined,
  localSizes: ReadonlyMap<string, number>): string[]; // called on every phone, at the end of each sync
```

`LanguageSession` takes `holdChoice: () => HoldChoice | null`, null meaning not known yet, so
nothing is shed. The screen is not enough, because a phone back in town sheds at the end of a sync
with Share nearby closed. So `useNearbyIdentity`, which runs from `SyncEffects` whatever screen is
open, reads `nearbyHold` and `worn`, works out the choice with `holdByDefault`, and keeps it where
`openLanguage` reads it, and a build with no `.android` files answers `{ hold: true }`. So sync
never reads a disguise. `NearbyRoom` takes `{ idleLimitMs, waitLimitMs, runLimitMs?: number,
stopWhenLevel: boolean, radios: (caps: NearbyCapabilities) => Radios }`, `Radios` being `arrange`'s
`radios`. `useNearby` passes 600000 and true only when `worn`, and a `radios` that says
`joinHotspot: caps.joinHotspot && !worn`.

**Choosing a partner.** `packages/sync/src/nearbyPartners.ts`, pure, and `NearbyRoom`
calls it after each scan burst and after each session.

```ts
function choosePartner(me: { tag: string; summary: string }, inRange: {
  tag: string; key: string | null; summary: string; position: number | null; // in nearbyPeers, oldest first
  finished: { mine: string; theirs: string } | null; // both final summaries from nearbyPeers
  hasWhatIWant: boolean; // from holdings; an unknown key counts as true
  wantsWhatIHave: boolean;
  echoed: boolean; // it has echoed this phone's salt; true for a phone that cannot advertise
  older: boolean; // heard under a generation below this phone's newest, so it cannot hear this phone
  listed: boolean; // its key is on the revocation list
  dueAnyway: boolean; // from the room's own timer, so this stays pure
}[]): { partner: string; connect: boolean } | null;
```

It drops a listed key's tag, and a phone whose `finished` equals both summaries now. A
`bye` with `not-member` or `identity` records `finished` too, so a refused newcomer does
not keep picking the same teammate, and a session that cut backups records none, so the
pair can go on later. It drops one with an equal summary and nothing to swap either way,
unless `dueAnyway` says the two have not exchanged for a set time, which overrides only
this rule, because it rests on what others claim. That gives each pair at most one extra
session, so five phones need 10 pairings at worst, not 6, and only after the wait. It
prefers one never met, then the lowest `position`, then the lowest tag. `connect` is
`echoed && (older || me.tag < partner)`, and the other side waits with a time-out from
JavaScript, then calls it again with connecting allowed. A phone that answers `busy`, or gives no
answer to an opening, is tried again later. The room says "Up to date" when this returns
null.

**Session keys.** Each side makes an X25519 key `eph` for this channel and a 32-byte
`nonce`, with randomness from `expo-crypto`. Role `i` is the GATT client or the QR joiner,
and role `r` the other. Nothing readable goes out until the other side proves it holds
`kSess`, because anyone can connect to a pipe, and a readable first message in a public
format would be a certain yes that a phone runs this app, with no key needed. So the
opening is exactly 80 raw bytes, with no JSON, no type and no version:

```
kOpen = HKDF-SHA256(ikm = kSess, salt = '', info = 'lq-nearby-open-v1', 32 bytes)
i sends nonce_i || masked_i || HMAC-SHA256(kOpen, 'i' || salt || nonce_i || masked_i)[0..16]
        masked_i = eph_i XOR HMAC-SHA256(kOpen, 'eph-i' || salt || nonce_i)
r sends nonce_r || masked_r || HMAC-SHA256(kOpen, 'r' || salt || i's whole opening || nonce_r || masked_r)[0..16]
        masked_r = eph_r XOR HMAC-SHA256(kOpen, 'eph-r' || salt || nonce_i || nonce_r)
```

`salt` is the responder's current advert salt, which the initiator has from `openPipe` and
native hands up with `onPipe`, and on a QR link it is the fixed bytes `qr`. The salt stops
a frame recorded from one phone opening on another, or after a rotation. The role labels
stop reflection, and binding `i`'s opening stops reuse of a recorded reply. The mask makes
a raw X25519 key, whose top bit is always clear, look random. A responder keeps each
`nonce_i` seen under the current salt in memory and treats a repeat as a stranger. It
checks the HMAC first, and runs X25519 only after that passes. JavaScript does all of this
with `@noble/hashes` and `@noble/curves`, so native still never sees `kSess`, and the size
is checked before anything is allocated. `memoryNearbyPair` mirrors the opening, so the
fleet runs it too.

A stranger gets silence. Wrong bytes, a repeat and no bytes at all get the same thing:
nothing, then a close at a short random deadline set from JavaScript. Such a connection
holds nothing: it does not count as an open pipe, hold off rotation, stop scanning or make
the phone busy. A busy phone replies with its opening and then sends `bye` `busy`, sealed.
For the initiator, no reply by a deadline counts as `busy` in `NearbyRoom`, and the QR
screen says to ask for a new code. Both sides count these locally in the diagnostics
allowlist (open refused, no answer), because a phone silent to its peer must not be silent
to `npm run diag`.

The opening's form is frozen for the life of the app, because a phone that cannot open it
never reaches Hello's "get a newer app". A later form gets a new `info`, a responder tries
every form it knows, and an initiator sends the oldest form any supported build speaks.
Everything else is negotiated in Hello. Which discovery key to use follows from the
advert, since each phone advertises under one key: the initiator uses the generation it
matched and the responder its own newest. So neither the opening nor Hello carries a `gen`.
Only `discovery-key`, `join-grant` and the certificate answer do, beside the key itself.

```
th  = SHA-256(utf8('lq-nearby-th-v1\n') || eph_i || eph_r || nonce_i || nonce_r)
ss  = X25519(my ephemeral private, their ephemeral public)    // refuse an all-zero result
okm = HKDF-SHA256(ikm = ss || kSess, salt = th, info = 'lq-nearby-keys-v1', 128 bytes)

first channel:  i to r = okm[0..32],  r to i = okm[32..64]
Wi-Fi keys:     i to r = okm[64..96], r to i = okm[96..128]

Wi-Fi link of attempt n (its place in the arranged plan, from 0):
  ok  = HKDF-SHA256(ikm = Wi-Fi i to r || Wi-Fi r to i, salt = '', info = 'lq-nearby-attempt-v1\n' || decimal n, 64 bytes)
  i to r = ok[0..32], r to i = ok[32..64]
```

Each attempt's link has keys of its own, because every link starts its nonces at counter 0:
a link secured for an attempt that was then abandoned, and the goodbye it seals as it closes,
would otherwise reuse the winning link's nonces under the same key. A hotspot hands up every
connection under one attempt's keys, so within an attempt only the proven link may seal: the
joiner sends `ready` first, the host seals nothing on a candidate until the joiner's `ready`
has opened, and native sends no goodbye on a link whose other side has not proven the keys. The host's `host` message
names its `attempt`, since two attempts can be of one kind (Wi-Fi Direct at 5 GHz, then any
band), and the joiner refuses one the plan it worked out does not hold, with `bye`
`protocol`. `ATTEMPT_KEYS` in core's vectors is the golden vector.

`hello.proof` is the install key's signature over the session proof text. The receiver
checks it against the `installKey` of `hello.chain`'s holder, and that holder's `deviceId`
against `hello.deviceId`. So a relay in the middle cannot pass, and a stranger with no
discovery key never reaches Hello. A Wi-Fi link takes its attempt's keys from the same
exchange and does not run Hello again, since `ready` proves the peer holds them. A new session is a new
exchange and new keys. Keys are never reused, logged or sent in events.

On a QR start, `kSess = HKDF-SHA256(ikm = the QR's secret, salt = '', info =
'lq-nearby-qr-v1', 32 bytes)`, the newcomer refuses any opening that does not match the
QR's pin (section 14.1), and Hello from both sides has an empty `chain`, an empty `proof`
and an empty `deviceId`, on a QR link only and only until the grant. It keeps the protocol
range, `can`, reducer and lines versions and `wallMs`, so the version and clock checks
still run before the tap. The newcomer proves their new key in `join-ask` and the inviter
proves theirs in `join-grant`, over the same proof text. From then on the session takes
the peer's key and device from `join-ask` on the inviter's side, and from the grant
chain's first link on the newcomer's.

**Documents a language uses.** `packages/core/src/libraryInUse.ts`, in phase 6. It settles what
answer 6 means by "the library documents this language uses": what a language's own events name
and what is chosen for it, not what it could reach.

```ts
export const STARTING_COPY_FORMATS = ['template@1', 'template@2', 'flow@1', 'material@1', 'versification@1', 'names@1'] as const;
export function mayGoInStartingCopy(doc: LibraryDoc): boolean;
type OrgLibrary = Pick<OrgState, 'library' | 'recommendations'>;
export function docsThisLanguageNames(org: OrgLibrary, state: LanguageState): string[];
export function docsThisLanguageUses(org: OrgLibrary, state: LanguageState, get: (hash: string) => LibraryDoc | null): string[];
```

`mayGoInStartingCopy` is true when `doc.format` is on the list and, for `material@1`, the document
has neither `source` nor `pattern`. A format added later is false.

`docsThisLanguageNames` gives these, sorted, with no repeats, and only what `isHash` passes:

1. `state.template?.value.docHash`, and every key of `state.templateHistory`, because
   `useEarlierSections` reads them.
2. `state.flow?.value.docHash`. A `custom` flow has none.
3. `state.bookNamesFrom?.value.docHash`.
4. Each item id from `recommendedFor(org.recommendations, state)`, and each with a true
   register anywhere in `state.passageLinks`: `libraryItemView(org.library, id).current`, unless
   the view is null or archived, as `offeredGuideSources` and `useKeyWordLists` do.
5. Each `item:<id>` with a true register anywhere in `state.checkHelps`: the same view's
   `current`, archived or not, as `useCheckHelpRows` does.

In 4 and 5 an item of kind `material` counts only if its view's `source` is `own`, so one followed
or copied from another organization stays out, because that is how a publisher's material arrives.

`docsThisLanguageUses` walks from those. A hash `get` cannot answer stays on the list, with nothing
to walk. A document `mayGoInStartingCopy` refuses leaves the list and is not walked. Any other
stays, and each of its `referencedDocs` goes by the same rule, which brings a template's or a
material's numbering. The result is sorted.

`NearbySession` takes a port, `docs: { read(hash): Promise<LibraryDoc | null>; text(hash):
Promise<string | null>; keep(hash, text): Promise<boolean> }`, which `src/nearby/` builds over
`docStore.ts`, since sync has no file store.

- **The sender's check.** It works the list out once a session, for the language in the checked
  chain, calling `docsThisLanguageUses` with what `read` has returned so far until the list stops
  growing. For `copy-ask` with `part: 'doc'`, a `hash` not on the list gets `copy-no` `not-allowed`,
  and one on the list that this phone lacks gets `not-here`. Otherwise it answers `copy-part` with a
  slice of the canonical text, `after` and `next` being character offsets in decimal. So no other
  document leaves a phone, whatever hash is asked for: not another language's template, and not a
  publisher's document this phone holds.
- **The newcomer's check.** It works out the same list from the adopted state, asks for each hash
  it lacks, and asks another teammate after `not-here`. `keep` takes the joined text only if its
  SHA-256 is the name, `validateDoc` passes and `mayGoInStartingCopy` holds, and writes no outbox
  row, because this phone did not make it. It is a new `docStore.ts` function beside `keepNewDoc`.

**Where the readers disagreed, and what was decided.**

- **Vector.** Carl chose a batch counter, so `since()`, global clock order and the
  `events_stream_hlc` index go. Pages are batches, which needs one signature check per
  page and no index over everyone's log. The security review then keyed it by the signer's
  install key and counted only whole batches, for the reasons in section 5.3.
- **Restamps.** No epoch in the node id, since clock code stays as it is, so the door
  keeps its `nodeId === deviceId` check.
- **Flag carrier.** `get_user_state`, not `my_organizations` and not a daily call:
  `useGlobalViewer` already reads it on every `OrgWork` mount and token refresh.
- **Chain shape.** `checkChain` with an injected `Verify`, over a list of checks for the
  caller to run, since a synchronous verify wraps into an async one, with kinds `worker@1`
  and `invite@1`. The domain prefixes come from the other design.
- **Who connects.** The lower device tag, over install ids, which a scanner cannot see, or
  salts, which rotate. A time-out covers phones that can only scan.
- **Summary contents.** Counters, not a hash of every file name, for the reason above.
- **Hashing on a phone.** `@noble/hashes`, over `digestStringAsync`, because a batch would
  cross the bridge 200 times. Its speed under Hermes is unmeasured, and `sha256` is an
  argument, so it can change.
- **Sealing on the pipe.** Native `secure` on every link, over sealing in JavaScript on
  the pipe, so there is one wire format and no bulk crypto in JavaScript.
- **The room's loop.** `packages/sync`, over the fleet or a hook, so the fleet runs the
  app's code.
- **Platform stubs.** A plain stub with `.android` files, over `.web`, which would ship on
  iPhones.
- **Join route.** A Worker route shared with the relay, over the Edge Function, which
  cannot import core and stays as it is for store builds. `sessionSafeFetch` needs no
  exemption.
- **Upload bar.** It counts teammates' recordings, over leaving them out, because section
  12 already settled it. Carl sees it when it ships.
- **The module's off switch.** There is none. Keeping it out of `app.json` does nothing,
  because autolinking finds it.

**What building phase 1 found in this contract** (2026-11-07). Nothing above is changed by
these; they say where the code differs from the text or what the text left out.

- `choosePartner` takes a third argument, `{ waited }`: the time-out that lets the higher tag
  connect after waiting, which the text describes as "calls it again with connecting allowed".
- `NearbyRoom` takes more than the list under Find gives: `radio`, `crypto`, `keys()` (the
  newest generation and its `floor`), `facts` (the summary after signing, peers, known keys,
  what each side lacks, the revocation list), `openSession`, `find` (`FindTunables`),
  `tunables` and `report`, besides `idleLimitMs`, `waitLimitMs`, `runLimitMs`,
  `stopWhenLevel` and `radios`.
- `NearbyRadio` has no way to take down a group hosted for an abandoned attempt, no way to
  stop scanning while it keeps advertising during a session, and no signal that an opening
  passed, which rotation needs so that it holds the salt while a session opens. Phase 3's
  native work must add all three.
- The manifests a signer has stored have a budget of their own,
  `NEARBY_BUDGET.maxManifestBytes`, 50 MB, beside Carl's rows and bytes, which are unchanged
  (decision 208).
- A nearby undo of an unbound target holds its slot until delivery settles it.
  Section 5.7's prose says "the sweep or delivery"; the table there stands as written.

**What building phase 3's steps 1 and 2 found** (2026-11-07).

- A holdings entry carries a signed `hold`, the owner's row, and its text is version 2 with a
  new prefix. Without it the tie-break made a phone with the row off and the lowest key keep every
  file, even those teammates with the row on hold. The wire was free to change, since no store
  build has signed version 1.
- The marks, level 2, shedding, the wanted list and the third worker sit behind the nearby
  entries (`nearbyMarks.ts`, `nearbyFiles.ts`, `nearbyHoldings.ts`), not in `fileLedger.ts` and
  `blobs.ts`, because the web bundle had no room: every client carries only `LanguageSession`'s
  options, the own-file counts and `holding`, and the multi-list `reclaim`.
- The third worker is per language session. `NearbySession` hands its file step to it through
  `NearbyFileMoves.take` when given one, and fetches one by one itself otherwise (the fleet).
- `mayUpload` leaves only teammates' files off the upload list. Leaving a person's own off as
  well would bring their sign-out count to zero while their recordings sat unsent.
- A choice not known yet asks as the row off would, five passages of review, and sheds nothing.
  A phone that cannot read holdings counts no copies and sheds only what the server has.

## 6. The delivery phase

A phone that reaches the internet sends its signed nearby events to the server on their
authors' behalf, and uploads every file it holds that the server lacks. One trip to town by a
phone with "Hold teammates' recordings" on sends the whole team's work, and a lost phone's work
survives on teammates' phones, its recordings on those with that row on or holding the last known
copy (section 5.6). This is a requirement,
so partners get the first release only with this phase (section 7).

- **Route.** `POST /api/relay` on the Worker checks the caller's token, that the caller
  may read that language (`can_read_stream`), and each batch's chain, signature and event
  digests (section 5.12), with expiry skipped. If the caller may not, the batch is refused
  with a reason the phone keeps and shows, and the signed events stay for a later try. It
  does not check `org_features`, because the flag gates only the way in (section 5.10). It
  makes one call per author and signer's key, at most 500 events each, because `append_events`
  requires `actorId` to equal the caller and raises above 500, and `relay_append_events` takes one
  key, so a request mixing authors gets
  separate transactions and partial success. It answers per event `{ id, accepted,
  serverSeq, reason }` with `append_events`' own reason strings, so `rejectCodeOf` reads
  them. A missing secret or a database behind the Worker (`PGRST202`) answers 503, which
  the phone takes as "not yet", since Supabase, Cloudflare and EAS each deploy on their
  own.
- **A lost phone.** One service-role function, `revoke_install_keys(p_profile, p_by)`, sets
  `revoked_at` and `revoked_by` on that person's unrevoked `install_keys` rows and adds them
  to the revocation list (section 5.12), in one transaction, and ends every session of the
  person's, so a taken phone still signed in cannot answer `{ revoked: true }` with a new key.
  Each caller signs the person in again afterwards on the phone they hold. It is idempotent,
  and three things call it, beside `suspend_account`, which revokes a suspended person's keys
  through the same body (`_revoke_install_keys`):
  - `take_sign_in_code_v2`, when a code with `lost` is taken, for a looked-after account, and
    `take_sign_in_code`, an older build's password branch, the same way.
    `issue_sign_in_code_v2` only stores a flag on a code, and nothing happens until that
    code is used. Looked-after accounts hold join passes (Carl's answer 18), so this is how an
    inviter who has no email stops a taken phone's pass. It is the flow a helper already has,
    acting at that person's own sign-in, and adds nothing to any screen.
  - Forgot password's New password step (decision 200, flow G), through a new choice, "A
    phone of mine was lost or taken". `password-reset`'s `choose` takes an optional `lost`,
    which old builds never send, and calls the function before setting the password, so a
    failure can retry. Setting a password already ends the account's other sessions. The
    authority here is the mailbox, not a session, so a taken phone cannot use it against its
    owner's new phone. More settings gets a row, for email accounts, that only sends that
    link. If the mail app on the taken phone is signed in, no design here helps. The choice
    is opt-in, because revoking on every forgotten password would refuse newcomers that
    person let in, and the warning beside it says so (section 14.3).
  - A staff command that lists and revokes a person's keys, beside `org-feature`, which also
    ends their sessions as `global_viewer_revoke` does, for someone who cannot reach their
    email. It lists each row's counts against the cap below, and has `raise` for its limits.

  No admin can revoke a member's phone on this branch: New password and staff only (Carl's
  answer 23), with no admin action and no new screen for it. So a detained person, who cannot
  take a code or read their email, depends on staff.

  The phone that did this makes a new key at its next certificate call (section 5.12).
  Only the named person is revoked (Carl's answer 20). A lost mark names a person, not a phone,
  and revoking every row with that key would refuse an innocent person on a shared phone still
  in use. So the list holds `(key, person)` pairs, and on a shared phone that was taken, the
  rows of the others stay good although the private key is gone for all of them. There is no
  third helper question in the first release, and section 13 has the follow-up. Phones never
  learn of a revocation directly from the server, so a team that has met nobody who has been
  online stays exposed.
- **Earlier work is accepted** (Carl's answer, 2026-11-06). Events dated before
  `revoked_at` are accepted and later ones refused, per event, in `relay_append_events`,
  using the wall part of `hlc`. Refusing everything would fail purpose 2 in the most
  common case, a phone that was simply lost.
- **What that rule does not do.** Setting a phone's date back is enough to date new work
  before `revoked_at`, because `HlcClock.next()` keeps the last wall when the clock is
  behind, and whoever made a key dates events as they like. The author's daily allowance
  does not bound this: `_append_allowance_refusal` counts per event day, with the day held
  between the account's creation and today, so a key holder gets 20,000 events and 100 MB
  for every past day of the account's age, about 7.3 million events a year, the same bound
  decision 169 accepts for any account. All they need is some reader's token. A redaction
  is one event per target and adds to the same log, so it is no practical remedy at that
  scale, and what stops a flood is removing or suspending the author. So the date rule
  protects a lost phone's earlier work and does not stop whoever took it. Hello's refusal,
  on phones holding the list, is what stops a taker (section 5.5). Keys that are never
  revoked, such as an email account's with nobody using the new choice, and other people
  on a shared phone, stay at decision 169's rate.
- **A cap on a revoked key** (Carl's answer 16). So that 7.3 million backdated events cannot
  take 2 GB phones out of service for a language, a revoked `install_keys` row may add 50,000
  events and 100 MB through the relay. A month at the 99th percentile day is 34,500 events, and
  50,000 redactions take an admin three days. There is no closing date, because a date would
  override answer 4's wording and add nothing to the volume limit. Work under a key that a stolen
  token registered is accepted up to this cap too, since refusing all of it would narrow answer
  4. The check runs in `relay_append_events`, for a row with `revoked_at` set, last before
  `set_config`:
  1. Lock the row (`for update`), only when `revoked_at` is set, so ordinary delivery takes no
     lock. Each call has one key, and takes it before the stream's lock, so calls cannot deadlock.
  2. Walk the events still standing, in order. An id already on the server passes uncounted, so
     several carriers count once. Otherwise an event costs 1 event and
     `octet_length((ev->'payload')::text)`, the same size the daily allowance counts.
  3. Add to `after_revoked_events` and `after_revoked_bytes` only what `append_events` took: answers
     `accepted`, with no reason `duplicate`, so an event it refuses never uses up room for a later
     one in the same call. When everything standing fits even if all of it is taken, one call
     takes it. Otherwise `append_events` is called once per event, and an event that would pass
     either limit of what has been taken so far is refused alone with `may not emit <type>: this
     revoked key has reached its limit`, which `rejectCodeOf` reads as `NOT_ALLOWED`.

  A refused row is listed on the Sync screen with Try again. A thief who goes first can use up
  the cap and get the real work refused, so staff can raise that one row's limit with
  `install_key_limit_raise`, and Try again then delivers it. That is the remedy, and until
  someone notices, real work waits as `rejected` on the phones that carry it.
- **Append as the author, not as the service role.** `append_events` skips its per-account
  checks (size, reserved ids, allowance, what someone may grant) when it has no caller, so
  a relay through it directly would bypass them. A thin new function,
  `relay_append_events(p_author, p_key, p_events, p_client_version)`, does this in order:
  it raises 42501 if `caller_id()` is not null, before anything else; it answers a refusal
  for every event if the `(p_key, p_author)` row is missing or if
  `auth.users.banned_until` is in the future, since a ban lives only there and Auth
  enforces it when issuing a token; it applies the revocation rule above; it refuses
  `v1.Redacted` and far-ahead stamps per event (below); it refuses `_org` and `_person`
  streams; it applies the cap above; it calls `set_config('request.jwt.claims', ..., true)`,
  local to the transaction, with the author; and it returns `append_events`' result, with the
  refusal of an undo whose departure the server lacks rewritten to `departure not here yet`,
  after counting what was taken against the cap. It does not restate those
  230 lines, and `append_events` itself changes only for the `by:` rule (section 5.4), so old
  builds keep their results (decision 152). `v1.ExternalValueSet` is refused because the
  caller is then not null. The function must be revoked from every role but the service
  role, because new functions default open to every API role. It counts against the
  author's daily allowance (decision 169).
- **No redaction by relay.** `append_events` allows a redaction on a language stream to
  anyone holding `manage_structure`, which includes every Coordinator, and a redaction
  cannot itself be redacted. So someone holding a Coordinator's copied key could sign
  batches of `v1.Redacted`, post them with any member's token, and take the team's work
  off every phone for good. A stolen key's other events can still be redacted, but these
  could not be undone. The relay refuses `v1.Redacted` by name, per event and before
  `set_config`, with `invalid payload: a redaction is not relayed`, which reads as
  `INVALID`, so no Try again retries it for ever. No honest batch holds one, because the
  door, the sender and `shouldClaim` refuse it. Redactions still take effect from
  `remove_content` and an author's own push.
- **A stamp too far ahead.** `CLOCK_AHEAD` alone would never settle an event stamped 2035:
  the server neither accepts nor refuses it, the sweep keeps it because it is signed, and
  every phone stays on the slow checkpoint path until that date. So the relay refuses a
  stamp more than a day past server time, with `stamped too far ahead: <date>`, a reason
  `rejectCodeOf` does not read as clock ahead. The limit sits beside
  `clock_ahead_tolerance_ms` in `server_config`, so it needs no app update. Only the relay
  does this. An author's own push still gets `CLOCK_AHEAD`, and restamps as today.
- **An undo that arrives first.** `may_emit` gives an undo of a departure the server lacks
  only the plain privilege, on the premise that it changes nothing. With nearby, a
  translator holding Carla's override from a batch could push an undo before the override
  lands, and it would then read as undone for good. A migration restates `may_emit`: an
  undo of an override, or of a departure the server does not have, needs
  `override_checkpoints`. Holders keep today's result. So an honest undo of a teammate's
  unsent set-aside is not lost, `pushNow` in new builds holds back a `v1.DepartureUndone`
  whose departure is on this phone and unconfirmed, and pushes those rows once more after
  delivery in the same `syncNow`. An old build on a shared phone can send one person's
  undo before another's set-aside, since `pushNow` filters by actor. That is now refused,
  and Try again recovers it. Decision 97's amendment says so.
- **Which version gate applies.** `p_client_version` is the delivering phone's
  `CLIENT_PROTOCOL_VERSION`, so `require_client_version` gates the caller, as in a push,
  and says nothing about who wrote the events. A below-gate build's signed work is
  accepted when a current phone delivers it, as it already is when its author updates,
  because offline teams and lost phones are why delivery exists. A bad but valid event is
  dealt with by redaction. LQ001 from the relay comes back as a whole-request answer that
  the phone reads as `ClientTooOldError`, leaving every row `nearby`, never `rejected`.
  Delivery joins `SENDS` in `syncGate.ts`, so a carrier below the store minimum can still
  deliver, which matches decision 154's reason. If a per-build stop is ever needed, it
  gets its own setting, not `min_client_version`.
- **Order in `syncNow`: push, deliver, pull, attest, sweep.** Delivery comes before the pull.
  While any nearby row exists `takeCheckpoint` stays on the slow path, where `shed` and
  `compactGuard` do not run, so a month-long catch-up pull in town would hold everything
  in memory on a 2 GB phone, which is what decision 143 exists to stop. It also means
  events go first.
- **Per author, oldest clock first.** `deliverNearby` takes `nearby_batches` per author,
  by `first_hlc`, and events in clock order within a batch, as `pendingPage` does. Paging
  by id could get a withdrawal refused because its target is not on the server yet
  (`may_emit`), and that refusal is final on a phone carrying a lost author's work. Each
  batch's verdicts are saved before the next is sent, and any verdict that marks a row
  `rejected` refolds. A row held only by a claim is never delivered. At the start of each
  `deliverNearby`, rows refused as too far ahead whose stamp is now within a day of `max(wall,
  last hlc)` go back to `nearby`, so the server takes them when their date comes.
- **Files.** Events go first, because they are small, so a slow link still gets the record
  up. Files then go as they do today (`uploadWorkOf`). So that any phone can carry,
  someone who only views may upload a file by naming an accepted event: the `x-named-by:
  <event id>` header on the PUT asks `blob_named_by(p_name, p_profile, p_event)`, which is
  true when the person holds any privilege there, the language is listed, the event with
  that primary key is in that stream, is not server-only and is not redacted, and its type
  names the file under exactly that name. `v1.BlobStored` records only hash and size, so a
  recording's bytes PUT as `H.wav` when phones ask for `H.m4a` would count as safe on the
  server, and level 1 would free it from phones with no object to fetch back.
  - **What names a file.** Not a search of the payload's text. A SQL `_event_files(type,
    payload)`, held to a core `filesNamedBy(event)` by `scripts/record-parity-sql.ts`,
    returns `(hash, format)` for events that make a reference and no others:
    `v1.RecordingAdded` cards (`format`, default wav), `v1.ReviewRecorded` artifacts
    (`format`, default wav), `v1.CardCleanUpSet`'s `cleanedHash` (`cleanedFormat`), and
    the voice note fields of `VOICE_NOTE_FIELD`, with their format from the
    `audioformat:<hash>` row, otherwise m4a. Nothing else names a file: not
    `v1.TakeComposed`'s `cardHashes`, not `v1.CardVerseSet`, and not free text. A phone
    picks the event to name with the same helper, a live one that makes the reference, and
    a pruned row is gone.
  - **What it costs.** A primary-key read of the event, one `events_entity_idx` read for
    `audioformat:<hash>`, and one `events_type_idx` read for a redaction, as `_content_events`
    does. Neither scans the stream. A removed version's parts stay named by its unredacted
    `v1.RecordingAdded`, so this stops redacted voice notes and artifacts and not a removed
    version's audio, which is unchanged from today (decision 16 as amended).
  - **Repair, for writers too.** A writer passes `blob_access` and names no event, and a
    supported build's PUT has no header, so `blob_named_by` cannot hold them. So
    `reconcileBlobs` compares each object's format with `referencedBlobs(state)`'s, and on a
    mismatch with no object at the right key, copies the bytes across (idempotent, since the
    `BlobStored` id is hash plus size), and `missingHashes` compares the full name, so a run
    reports `partial` until it is repaired. The bytes never leave R2, so the worst case is a
    day of failed downloads.

  It also covers a viewer who pulled the event and got the file from a teammate. The
  server has no idea which files an event names without this, since references are worked
  out by folding. It bypasses `cachedBlobAccess`, which remembers per person and stream,
  so one allowed file would open the whole stream for 60 seconds. Global Viewers hold no
  privilege, so they are not let in.
- **Attribution holds.** The event keeps its author, device and id. When the author's
  phone pushes later, the server answers `duplicate`.
- **Authors with no account yet.** A newcomer's batch carries their chain (section 14).
  The relay treats it as the join route would, through the same `accountFromChain`: if the
  pass still allows it, it makes the account with that id and applies the events as the
  author. If not, it makes no account, and each event gets `NOT_MEMBER` rather than a
  missing key row's refusal, so a teammate's copy keeps its Try again for when the author
  is let in. The manifest's signature is the proof of key. Only the phone holding the key
  can sign in to that account later, until that key's first session (section 14.1).

A verdict has to say which refusals are final, or a lost phone's work is dropped for a
passing reason. The signature covers `hlc`, so a relaying phone cannot restamp.

| Verdict | What the delivering phone does |
| --- | --- |
| Accepted | Writes the row `confirmed` with its `serverSeq`, as `pushNow` does. |
| Accepted, reason `duplicate` | Leaves the row nearby, and the pull or sweep settles it. The duplicate branch of `append_events` compares only organization, stream, actor and type, so this copy's clock may differ from the server's, and confirming it would leave the fold wrong. For the same reason the pull's comparison (section 5.4) also runs on a phone that has ever restamped: its own restamped push can come back `duplicate` once a teammate has delivered the older copy. Delivery keeps the ids so answered, by batch, and sends them no more: on a carrier whose pull is behind, the server's copy is past its cursor, so the sweep cannot settle it until the pull gets there, and sent again each sync those batches would use up its 25 and keep later ones, perhaps a lost phone's work only it holds, from going at all. A batch left with nothing to send is not counted. |
| `CLOCK_AHEAD` | Leaves it nearby, and tries again later. The server's check passes once real time reaches the stamp. Only a stamp within a day gets here. |
| `stamped too far ahead` | Marks it `rejected`, keeping its `via`, with a reason naming the date, and refolds. So it leaves every register, `unconfirmedCount` falls and memory sheds again. A pull still overwrites, so an honest author's restamp arrives under the same id, and the row goes back to `nearby` on its own once its date comes. Until then a refused row's file is not wanted by other phones and is freed first under space pressure, so a lost phone with a far-ahead date can lose that audio. The decision entry says so. |
| `departure not here yet` | Marks it `rejected`, keeping its `via`, as push does for `NOT_LISTED`, so it leaves the fold and does not hold the slow path. Sent again once this phone holds that departure as delivered or pulled, including at the end of the same delivery. A departure that never lands costs one read per sync. |
| `NOT_LISTED` | Leaves it nearby, and tries again later. |
| `NOT_MEMBER`, `NOT_ALLOWED` | Marks it `rejected`, keeping its `via`. It is listed on the Sync screen, whose Try again moves it back to `nearby`, for when the author's membership has changed, or staff have raised a revoked key's limit. |
| Anything else | Marks it `rejected`, keeping its `via`, with the reason. |

This closes the gap in section 5.7 for any phone that reaches the server.

This amends decision 11 and PLAN.md section 9: an event comes from its author, or from a
phone holding the author's valid signature, unless it is a redaction.

## 7. Phases

**Everything merges once, at the end** (Carl's answer, 2026-11-06). Phases 1, 2, 3, 4 and
6 are built in that order on this branch. There is no phase 0 first. One real-phone test
of the whole branch takes its place as the gate, and then there is one merge. Nothing is
merged by an agent.

Each phase is committed on the branch and pushed to a draft pull request at its end, so CI
runs what this machine cannot: SQL, the web tests and the Kotlin. It ends green on `npm
run guardrails` here and on the `gate` job in CI. Only a person merges, and only after the
gate.

**Before any phase.**

1. Run `security-review` on sections 5.5 and 5.12 (the list is in 5.5).
2. Land the contract as one small commit: `NearbyLink`, the opening, the wire messages, the
   manifest, chain link kinds, the vector's meaning, the Find payload, the generation hash, and
   golden vectors.
   Sub-agents start after it. Those touching `syncClient.ts` or `types.ts` go one at a
   time.
3. Sub-agents share one small machine: whole-repo runs (typecheck, coverage, guardrails)
   go behind one lock, targeted test runs use 2 workers, `TMPDIR` is on the real disk, and
   no worktree goes under `/tmp`, which is a RAM disk.

**CI.** `guardrails.yml` has no Android step today, so `build_android` is the first
compile, after a merge, and a failure stalls every Android merge. A new required job,
`android-native`, runs when `apps/mobile/modules/nearby-link/**`, `apps/mobile/package.json` or
the root `package-lock.json` changes (Carl's answers 3 and 22): `expo prebuild -p android
--no-install`, then `./gradlew :nearby-link:compileReleaseKotlin
:nearby-link:testDebugUnitTest :nearby-link:lintDebug`. It goes in `gate.needs`, and in
`JOBS` in `scripts/ci-scope.mjs`, with an `android-native=` output. Two rules and the fallback
for unmatched files say `JOBS` today to mean every job, so they get a new constant, `SHARED`,
holding the three they run now, or a change to core or a script would compile Kotlin.

The first rule that matches a file still decides alone, and nothing adds two rules' jobs
together. So each new rule lists all its files need, and both go directly before today's
dependency rule, which matches any `package.json` and would otherwise take them first:

| Pattern | Jobs | Why |
| --- | --- | --- |
| `/^apps\/mobile\/modules\/nearby-link\//` | `[...APP, 'android-native']` | Its files keep the browser jobs they would get from the `apps/mobile` rule, and a `package.json` of its own runs the job too. |
| `/^apps\/mobile\/package\.json$\|^package-lock\.json$/` | `[...SHARED, 'android-native']` | They keep the three jobs the dependency rule gives them today. |

Another package's `package.json` still falls to the dependency rule and compiles no Kotlin. The
root lockfile moves with any dependency anywhere, so the job runs on those changes, on purpose,
because they can move `expo-modules-core`, which the module compiles against. A nightly run, a
manual run and a scope error run every name in `JOBS`, so something else that breaks the Kotlin,
such as `app.json` or the job's own workflow, shows by the next night. This amends decision
150's list. That GitHub's runner has a suitable SDK is unconfirmed until the first run.

**Phase 1: the model, no radios.**

1. Fix the two existing bugs, each from a failing test and in its own commit:
   `KeptLanguage.split` on the slow path, and the malformed clock at the pull (section
   5.4). They depend on nothing nearby.
2. Core leaves, none depending on sync (section 5.12), `nearbyGenerations` among them. Negative
   paths tested as they land, because core's coverage thresholds apply to the whole folder.
   `nearbySigning` lands now with fake sign and verify, because `NearbySession`'s pages contain
   signatures.
3. Status and store, on both stores: `nearby`, `via`, `nearby_batches`, `nearby_attests`,
   the `WriteBatch` fields and the required reads, with contract tests.
4. `SyncClient`, with the two checkpoint gates first, so no test can ever write a nearby
   row into a checkpoint. Then bound ids (`newCommandId`, `idAuthor` and the lint rule), the
   `requeue` exclusion, `signUnsigned`, `receiveNearby` with its budget, the vector and
   manifest in one commit, the pull's comparison and refold, the inspect count.
5. The sweep with `Transport.knownEvents` optional, on `FakeServer`, `shapeTransport` and
   `SimDevice.observed` together, because a missed list silently disables it.
   `known_events` itself comes in phase 2.
6. `NearbySession`, with `you-first` and the hand-on, `NearbyRoom` with its stop options,
   `choosePartner`, `memoryNearbyPair`, `fakeSigner` and a fake attester, in the `./nearby` entry.
7. Fleet scenarios: a village month, a wrong date, five in a room, a lost phone asserting
   survivors only, one phone back with a newer generation. `nearbyConverges` as an async
   property. Parity in `keptLanguage.test.ts`. Read load and fold times on the village scenario before going
   further. Decision entries, amend 60 and 104, and `status` values in PLAN.md section 7.

No user-visible change. The door's privileges come from `privilegesOfFixedRole` in the
fleet, which has no organization stream.

**Phase 2: identity and the flag.** JavaScript and server only. It does not ship by update
on its own, since everything merges once, but it needs no native code, so CI can run all
of it with no phone.

1. `checkChain` in core with a fake verify, including two-link checks and `orgSeq`,
   because the Worker imports it. `peopleWithChains` with its one-link rule, because a newer
   certificate decides from this phase on (section 5.5).
2. One migration, in one commit with the `SupabaseTransport` call: `org_features` with
   staff functions (`feature in ('nearby', 'nearby_join')`), `install_keys` with the cap's
   columns, `install_key_revocations`, the discovery chain and its generations with
   `_discovery_generation` and a golden vector against core, certificate facts, `known_events`,
   the `get_user_state` fields, and the `by:` rule in `append_events` with `test:old-sync`
   green. Smokes, the `SMOKES` list and `surfaceSmoke` loops, and the delete-account
   check. This SQL first runs in CI, so keep it close to `org_importers` and
   `pull_events`.
3. The Worker routes for certificates and attestations, with injected deps, answering 503
   with no secret and on `PGRST202`. Real Ed25519 tests on Node, plus one sign and verify
   under workerd, since the root of trust depends on it and nothing here has run it there.
   `scripts/org-feature.ts`, the key script, `secrets.mjs`, wrangler vars in both places,
   public keys in env files.
4. The app last: `src/server/nearby.ts`, Android-only key making and storage, the flag
   read beside `useGlobalViewer`, `useNearbyIdentity` after an organization pull, writing the
   generation entries, the door's lookup with real sign and verify. `@noble/curves` and its
   facts. Decision entries, amend 53, 152 and 168, and the Device IDs answer.

`Ed25519` speed under Hermes is unknown. Manifests keep it to one check per batch, and the
first real number comes from the branch APK.

**Phase 3: the link and the screen, experimental.**

1. The space pipeline, with no native code (section 5.6): the hold choice in `wantedFilesOf`,
   `nearbyShedOf`, and a backup going when the server confirms it. PLAN section 14 and decision
   60 amended.
2. The third worker on `fetchFile`, the nearby `.part` name, own-file counts in `unsent`
   and `pendingUp`, `holding` in the status store.
3. The `android-native` job first, with its two `RULES` entries and `SHARED`, so the Kotlin is
   compiled from its first commit. Then `wire.ts` and test vectors, pure Kotlin classes with
   JUnit, radio classes with `scanKeys` and `onFormSalt`, the module manifest with `uses-feature`,
   `requireOptionalNativeModule`, text guards over the Kotlin, `playDeclarations.test.ts` extended
   for module manifests. Every tunable is an argument from JavaScript.
4. The app: the `.android` adapter, the permissions model, `useNearby` with the
   `radiosMayRun` gate, `useAppCovered`, `NearbyCoverNotes` and the idle stop, the disguised
   phone's limits, warning and words in `src/disguise/i18n`, the hold row and `holdChoice` from
   `useNearbyIdentity`, the screen, flow edges,
   the parity and flow lists, 16 catalogs, help, the PLAN section 13 row, demo-parity, the
   History line. The `carried` profile in `eas.json` goes in here (section 14.4). Run
   `guardrails --web` and `expo export -p android`, which needs no SDK and proves Metro
   resolves the sync subpath for the first time.
5. Diagnostics: the migration restated with the schema, the facts, the privacy page,
   `diagSignals`, the smoke. Decision entries, amend 92, 150, 165, 166 and 171. Say which
   Play answers change.

**Phase 4: delivery.** Section 6. No native or pipeline work.

1. SQL: `relay_append_events` with its guard before `set_config`, per-event revocation, the
   cap, its refusals of `v1.Redacted` and far-ahead stamps, `banned_until`, `may_emit` restated,
   `blob_named_by` and `_event_files`, `revoke_install_keys`, `install_key_limit_raise` and
   `take_sign_in_code_v2`. Run
   every `grantsSmoke` refusal through it, and every type the door refuses by name. Add a
   smoke for an event holding NUL, which is believed to fail a whole call in `jsonb`; nothing
   has run this.
2. The Worker's `/api/relay` with its literal route in source, `x-named-by` on PUT, the
   `reconcileBlobs` repair, `password-reset`'s `lost` and the staff command.
3. Sync: `deliverNearby` between push and pull, `pushNow` holding back an undo, and lifting
   `mayUpload` for named files. The same three by-hand lists for the fake.
4. Scenarios: carry, town, and a lost phone asserting the server has everything. The phase
   4 clause in `nearbyConverges`. Decision entries, amend 11, 97, 152, 154 and 200, and PLAN
   section 9.

**Phase 5: iPhones.** Not on this branch. iPhones join an Android phone's group, and
iPhone to iPhone goes over Network framework, or Wi-Fi Aware if it has matured. The
protocol is unchanged, and `NearbyLink` gains implementations.

**Phase 6: joining offline.** Section 14: carried builds, join passes, the screen that
lets someone in, the starting copy, the local person and the join route. Someone with
`PLAY_REVIEW_KEY` must try `GET generatedApks` before the pipeline work starts.
Publishers' documents stay out of the copy until Carl confirms the terms, which holds up
nothing.

1. Core: the `invite@1` issuing side, `peopleWithChains`' two-link rule,
   `withChainMembership`, `newcomerOrgState`, `libraryInUse.ts`, and the two pictures from `th`,
   with a golden vector.
2. Sync: `adoptStartingCopy` with its marker, in one change with the `pullNow` gate, the
   no-snapshot drop and the `loadUnits` skip, because any one alone keeps a forged copy
   for good. Then the row source for `KeptFill`, which throws `OfflineError` and never
   answers null, the sender with its `docs` port and check, and the organization stream through
   a temporary client. The `nearbyNewcomer` scenario before any screen.
3. Server: passes in the certificate facts, with `passId` and `expiresAt` worked out by the
   Worker, `redeem_pass_for`, `_redeem_invite_row`,
   `pass_refusal`, `accountFromChain`, `deleted_profile_ids`, `take_sign_in_code_v2` closing a key's
   first session, the join route with its limiter, the relay's no-account branch, smokes for chain
   joins.
4. The app, in this order because each stands on the last: local person store, identity in
   `App.tsx`, the membership overlay at `Workspace`, the fetch gate, `signedIn` and
   `serverSession` split, `parseKey` and its two consumers, Let someone in, the progress
   screen, local-person branches on Me and Sign In, first contact. Finish a copy before
   setting the person, because `Shell` remounts on the actor id.
5. Pipeline: `scripts/carried-build.mjs`, workflow jobs independent of the store build so
   a failure there cannot stall `publish_android_update`, `store-build-guard`,
   `server-calls` for both profiles, the APK route. It first runs in EAS after the merge,
   so it must fail closed. `docs/invites-and-accounts.md` gets the new flow, PLAN section 13
   its rows, decision entries, amend 59, 75, 155 and 157, and the Play answers.

**The gate: one real-phone test of the whole branch.** This takes phase 0's place. The
real code needs a certificate and a discovery key from a Worker, and no preview stack is
deployed: `preview` builds talk to a stack that does not exist. So it runs on someone's
own stack: a branch-only `eas.json` profile, not merged, that makes an APK pointed at
their Supabase and Worker, with a local signing pair, and the features granted there
(section 13 asks whose). A local stack the phones reach over Wi-Fi is enough, with that
Wi-Fi standing in for the trip to town.

- **The phones.** Two cheap 2 GB Androids, one mid-range one, one factory-fresh phone that
  has never been online, and China-market phones with no Play services. Up to five
  together, for section 5.11.
- **What it runs.** The Phones row in section 8, in airplane mode with Bluetooth and Wi-Fi
  on.
- **What it records.** The answers to section 11, written into this document with their
  numbers.
- **If it fails.** Nothing merges. The link is fixed or rethought on the branch, and the
  test runs again. A finding about joining offline need not hold up the rest:
  `nearby_join` stays off until it is fixed.
- **The security review runs again** on the code before the merge.

**The merge.** A person merges, with this done first, in this order:

1. Generate the signing key (`scripts/nearby-signing-key.sh`). Agents may not read
   `.env.keys` or print decrypted values.
2. `npm run secrets -- production`, and `npm run env:eas -- push production`. This must
   happen before the first update with this code, or the update ships with no trusted key
   and every chain is refused.
3. Create the R2 bucket and apply its credential (section 14.4).

`runtimeVersion` is a fingerprint, so an update cannot deliver the native module. One
merge costs one Android store build and one iPhone review, even with no iPhone change,
because the `carried` profile moves `eas.json`, which both fingerprints hash. The store
build goes public once approved, with no staged rollout (decision 157), and `app.json`
stays unchanged. After the merge, names are frozen: `known_events`, `/api/relay` and
`/api/nearby/*` cannot be renamed while a supported build calls them (decision 151). While
the new store build is in review, a later merge touching these files is copied to
`release/android`, where they do not exist, and conflicts (decision 155), so hold such
merges until it is public. Then `npm run org-feature -- grant <test organization> nearby
--hosted`.

**Only a person can do these:** the key steps above, the `org-feature` grants, raising a
revoked key's limit, every Play Console answer (section 9), the read-only `generatedApks` call,
the R2 bucket and its credential, and the real-phone runs. A Linear issue for commit messages,
decision 53's follow-up issue and the lost shared phone's (section 13) do not exist yet. An
uncommitted change to `package-lock.json` (78 `libc` lines removed) is not this work's and must
not be committed, so stage files by name.

**What stays untested until when.**

| Until | What |
| --- | --- |
| CI on the draft pull request | Every migration and SQL smoke, `test:old-sync`, the record parity SQL, Edge Functions, browsers, the web smoke, Kotlin compile, JUnit and lint. This machine has no Docker, no `psql` and no Android tools. `integration.test.ts` skips itself when the stack is unreachable, so a green run here says nothing about the database. |
| The real-phone test | Bluetooth LE, GATT, Wi-Fi Direct, the hotspot, native encryption at speed, Ed25519 under Hermes, every number in section 4, and all of section 11. No JVM harness can show Android radio behaviour. |
| After the merge | A Play-signed universal APK and its install, Play updates after that install, the carried build job (it first runs in EAS after merge), and the store review. |
| In the field | Real team sizes, time to level (the fleet's is relative until there are link speeds), and phones reaching the server from China. |

**Later, if asked for:** section 10.

## 8. Tests

Screen states are tested through a model (`src/nearby/nearbyModel.ts`), not a rendered
screen, because the web has no Share nearby, the automated UI suite runs only on the web
export, and Maestro cannot run radios. New tests go where `docs/testing.md` says.

| Layer | What |
| --- | --- |
| Property (`packages/core`, `packages/sync`) | Any split of events among phones, any sequence of pairwise exchanges with drops, then any order of reaching the server: every phone ends equal to the server's fold. In `nearbyConverges.test.ts`, an async property, with fresh stores and `FakeServer` each run. Until phase 4, a lost phone's scenarios assert only that survivors hold the work and agree, since only the author can push. From phase 4: after a full round of exchanges, any one phone with "Hold teammates' recordings" on, alone reaching the server, leaves the server with every event and file, for authors within their budget. Runs also generate phones with the row off: any phone reaching the server still leaves it with every event, a file reaches the server once any phone holding it does, and no two phones with the row off shed the last copy between them. Merging holdings is commutative, associative and idempotent, and hostile keys do not change it. A vector entry never counts a batch this phone neither holds whole nor could get from the server, against a hostile sender too: a hostile `have`, an empty or subset replay of a real manifest, a certificate naming someone else's device and a signer with a huge `n` change no other signer's entry, and an honest phone relaying part of a batch closes it for nobody. |
| Unit | Every trap in section 5.4. The door against hostile input over mangled fixtures: `__proto__` names, reserved ids, oversized payloads, depth, NUL, lone surrogates, server-only types, `v1.Redacted`, `v1.ExternalValueSet`, a bad clock, the wrong stream. It returns a refusal or null and never throws. Batches: forged, tampered, a subset still checks, the wrong key or author, a manifest with no events counts only when every id is already here. A number stays open while any id is missing, a digest mismatch never closes an id, a floor moves only its signer's mark, and ranges past their cap record nothing new. A restamp clears `via` and signs again in a later batch. A retry refusal leaves the number open. A manifest goes once no row needs it, and each signer's newest stays. Bound ids: another author's `by:` id or entity id is refused, an old unbound id behaves as today, every `Commands` method's result can be signed, and a pull cannot replace a pending bound row with another actor's event. Claims: one with no attestation or a digest not in it is refused, a door refusal at steps 9 to 11 cannot happen, and a row already here stays. Budget: a claim flood naming Sam does not stop Sam's batches, unknown types count, a `REDUCER_VERSION` re-run refuses no counted row, and the number stays open over budget and closes after settling. Revocation: a listed pair is refused at Hello, its earlier events pass and later ones are refused one by one, a newer list marks rows already taken, and another person on that key is not refused. The opening: golden vectors for both sides, no byte position constant across sessions, and random bytes, a wrong key, a replay, a reflection and a silent connection all drawing zero bytes and the same close, with rotation not held off. Find: a fake radio fails if a mask repeats under one salt, equal summaries compare equal under two salts, a recording draws no connection and no row on screen, and the slot changes at the same rate with or without a replay. Generations: a golden vector for the hash, a chain made from its far end agrees with core at any `g`, and a phone scans from its newest down to `floor` and no further than 16. A phone ahead hears a phone behind, is echoed through a salt no key matched, connects whatever the tags say, and sends `you-first`. A lure with no valid chain gets no name from it, and a chain this phone's fold has seen removed draws `bye`. The hand-on goes only from a `direct` entry whose `orgSeqHere` has reached the certificate's `orgSeq`, only after the other's `arrange`, and never from a key got by hand-on. `handedKeyHolds` refuses a wrong key, a lower `gen`, a jump over 1,000 and the wrong length, and a refusal ends nothing. A hand-on leaves `floor` alone, and a certificate answer moves it. Radios: a disguised phone opening the screen starts nothing and asks nothing, and a press starts it; a lock clears the press, a typed code is still refused, and a new press is allowed; a resume, focus and the continuation after a prompt all ask the gate; it stops at `runLimitMs` even during a session, and at "Up to date" with no bursts, and both latch; the warning comes before any prompt; `arrange` says `joinHotspot: false` and it may still host, and two such phones stay on Bluetooth with audio waiting. An undisguised phone resumes, a waiter outlasts a long swap, a stranger's connection does not extend the idle clock, waking does not restart the radios, and a latecomer is found after Look again. Golden vectors for each signing text. Store contract for `nearby` on both stores: excluded from pending queries, included in the fold, never pruned, `receive` never overwrites, `dropNearby` removes only nearby rows, a confirm clears `via`, the same id on another stream. Freeing space (section 5.6): an unmarked file is never deleted, a backup goes only once level 1 cannot free enough, a file open for review goes after every backup, the 2 GB cap alone deletes no nearby file, one pass does not over-delete, a confirmed backup goes at once with the row on or off, a confirmed file open for review falls to level 1, a confirmed needed file stays, a marked file no reference names goes first. The list and `upNextOf` agree on what is open for review. Hold teammates' recordings (section 5.6): with nothing written the row is on, and off when `worn`, and a pressed choice stays whatever the disguise does. Off, only needed files and the window are wanted, the window follows `upNextOf`'s order and holds to its size, and no backup is asked for. `nearbyShedOf` sheds a file the server has, or one held by another person with a lower key, and keeps a last known copy; another install of the signed-in person does not count; two phones with the row off cannot both shed one file; an unmarked file never goes, and neither does a file in the wanted set. Ready to carry says so. Teams (section 5.11): with the row on, every unconfirmed file is wanted and a confirmed one is not, level 1 gives way for a nearby file, the fewest copies are fetched first and the most copies deleted first, the time limit cuts only backups, only one of two phones connects, and two phones that finished unchanged do not reconnect. Holdings: a forged entry, a wrong key and an unknown chain are dropped alone, a counter near the top of the safe range pins nothing, and 50 chains from one person add one copy. A `not-member` bye does not make a phone pick the same teammate again. Chains (section 5.5): one link and two links are accepted, and an unknown link kind, an unknown `kid`, an expired pass, a wrong organization, a role the inviter could not grant, a role with a manage privilege, an id that does not derive from the key and a self-link are refused; `now: null` skips expiry. A removed entry refuses a two-link chain, a live one answers from the fold, a removed or demoted inviter or a retired role refuses at or above `orgSeq` and not below, and on a starting copy the fold beats an older one-link chain. A person in two organizations: no `hello`, `batch` or `join-grant` for one holds the other's id. Hello picks the newest protocol both speak. |
| Joining (phase 6) | Any starting copy, any exchanges, then first contact with the server: the phone ends equal to the server's fold, with every pending event pushed under the newcomer's id. A forged starting copy does not survive first contact, whether or not the server has a snapshot. `docsThisLanguageUses`: a language's template, its template history, its flow and its book names are on the list, and a template's numbering follows. A recommended, linked or helping `material@1` of this organization's own is on it. FIA's key words (`source` and `pattern`), a followed or copied `material@1`, `study@1`, `study@2`, `collection@1`, `source@1`, `sourceBook@1`, `timing@1`, `labels@1` and a format made up for the test are not. An item the language hid, or an archived recommendation, is not on it, and an archived help is. The rest of the organization's library and another language's template are not. A sender answers `not-allowed` to any hash off the list, `not-here` to one it lacks, and serves the rest in parts. A newcomer's `keep` refuses a text that does not hash to its name, a failed `validateDoc` and a document the allowlist refuses, even from a teammate who sent it. A pass: every answer in a window gives the same `passId`, a new key or window gives a new one, `expiresAt` is the window's end, a golden vector holds it, and a first use's row holds the fields section 14.1 lists. A looked-after account holds a pass, and a helper's code with `lost` then stops it at the join route and the relay. The join route is safe to repeat, and refuses a pass past expiry or uses, one from an inviter who lost Invite or that role, a retired role, a role raised to a manage privilege, a revoked inviter's key, an organization turned off, and a key that does not match, and a refused join leaves no `auth.users` row unless one existed before the call. A chain naming an imported person's id, a v2 id not yet imported, another newcomer's id, a shared phone's other person or an upper-case id is refused, and none makes an account. A role widened with no manage privilege still redeems. A repeat by someone already in still answers the organization after the uses run out, the flag goes off or the key is revoked, a retry after `createUser` with no key row recovers, and a refused first use leaves no `v1.InviteIssued`. Key sign-in stops at the key's first session: a certified key on an ordinary account gets no session, no redemption and no `v1.MemberAdded`, nor does another person on a shared key; a revoked row gets no session; a lost reply retried hours later succeeds; sign-in is refused after the certificate call and after a helper's code on another phone; and a chain person's old batch still passes after their first session. A pass cannot be reached by a token: `redeem_invite_v2` and `preview_invite` refuse tokens built from a pass's fields, `issue_invite_v3` refuses a `pass:` hash, and neither new function is callable by an API role. A second newcomer with another role gets that role. A QR holder who is refused, or never tapped, ends with no pass, chain, discovery key, inviter device id, copy part or event, and nothing sent before the tap holds any of them. A second phone is refused and the inviter told. A copy from a sender in two organizations with organization-level Invite and a pending join request holds only this organization's live members, and only this language. A starting copy moves only between phones on the same reducer and lines versions, and a mismatch names the file needed. A merge that changes those versions, the protocol range or the Android fingerprint makes a carried build, and `play-review.mjs` never promotes one. |
| Parity | Nearby events through `keptLanguage.test.ts`: a kept phone agrees with a memory phone, across checkpoints, restarts and a reducer bump. The `phone()` helper needs a materializer option first. The door against SQL's rules, and `isServerEventId` against `_server_event_id`, in `scripts/record-parity-sql.ts`'s style. |
| Flag | Organization off: no Share nearby, no radios, no key, no prompt and no new server call, and the Worker's certificate answer holds no chain, key or pass for it. Turned off after use: nearby events still settle and nearby files still upload, except a newcomer's with no account yet. A certificate that does not name the language's organization is refused at Hello. With `nearby_join` off, no pass is issued, and the join route refuses, and likewise with `nearby` off and `nearby_join` on. No file an iPhone or the web bundles imports `modules/nearby-link`. |
| Fleet | New scenarios: a village team with no server for a month, one phone with a wrong date, one phone lost (`Fleet.lose`), five phones in one room (pairings and time to level, with chosen partners against plain rotation, and again with one phone behind after a trip to town), a batch stamped ten years ahead whose author never returns, where a phone reaching the server ends equal to the server's fold with `unconfirmedCount` at 0, an honest restamp arrives by pull and a lost author's row is delivered once its date passes, a phone 45 days behind that still folds its teammates' work, one phone back from town with a newer generation that moves the room in one trip while a removed member's phone stays on the old key and draws nothing, a room with the row off on two phones, (phase 4) one phone carrying everyone's work to the server and a trip to town, and (phase 6) a newcomer joining with no server. The village scenario also reports load and fold times, and again with one member at the budget. Fleet phones run with the row on unless a scenario turns it off. |
| Server | `known_events`, certificates, attestations (no route signs a digest it was sent), generations (the first key call makes a chain, a key is due at 90 days, after a removal covering the language and after a revocation, not for a removal in another language, at most one a day, and two calls at once make one; a row under `floor` is never returned, and no event append makes one), (phase 4) every `grantsSmoke` refusal through the relay, the cap (events and bytes counted one by one as `append_events` took them, a duplicate uncounted across two carriers, the event past either limit refused alone and read as `NOT_ALLOWED`, an unrevoked key taking no lock, a raise then Try again delivering it, the raise never lowering a limit and not callable by an API role), every type the door refuses by name through the relay, a relay then an author's push answering duplicate, a coordinator's signed redaction refused with its target kept, even by a revoked key with a backdated clock, while their own push and `remove_content` still work, a revoked key per event, an email account's key revoked through a reset with `lost` and its pass then refused at the join route and the relay, a reset without `lost` leaving keys alone, a suspended author, a far-ahead stamp refused while a near one answers `CLOCK_AHEAD`, a translator's undo of an unknown departure refused and an override holder's kept, a below-gate caller answered as a whole request, a file from someone who only views, by each event type, and refused under the wrong extension, by an event that names no file, or by a redacted event, (phase 6) chain joins, in SQL smokes and the integration test. Worker routes with real Ed25519 and injected deps, including one under workerd. `install_keys` and a person's revocation rows go with the account. Every supported store build still passes (decision 152). |
| Native | JUnit in `android-native` over the pure classes: golden vectors from `wire.ts`, matching an advert against several `scanKeys` with the right `scan` given back, a form match handing up a salt and nothing else, tamper and truncation, oversize `len`, nonce order, the framer at MTU 23 and 517, `PartWriter`'s limits, and a real `LinkSession` pair on a loopback socket moving 50 MB with encryption and a mid-transfer drop. `apps/mobile/test/nearbyNative.test.ts`, text guards over the Kotlin: module functions equal the TypeScript class, API 29 symbols only behind `SDK_INT`, no manifest components, no `ACCESS_LOCAL_NETWORK`, and a guard that fails when `targetSdk` reaches 37. |
| Phones | The gate (section 7). Real phones, including China-market ones with no Play services: airplane mode with Bluetooth and Wi-Fi on, record on one, review on the other (asked, and not asked), then reach the server. One phone carries the team's work. One phone with a wrong date. One phone back from a server with a newer generation, which meets the others with no tap and moves them on. A disguised phone: open Share nearby, and a second phone sees nothing and no prompt comes. Press "Start sharing": the warning, then the prompts, each naming the application as the warning says, then the code and a new press, and it finds the teammate. Press Home, then reopen, and with the calculator up a second phone sees nothing and the screen sleeps, after the code still nothing, and after a press it runs. It stops at ten minutes, and at "Up to date", and a second phone then sees nothing. Two disguised phones with Wi-Fi Direct failing stay on Bluetooth with audio waiting. Each Android version in the field, including one below 10, for the disabled row. A factory-fresh phone: install, join, record, then first contact. The QR scanner on a phone with no Play services, since `expo-camera`'s analyzer has not been run on one. Maestro cannot run radios, and any flow there is tagged `android-only`. |

## 9. Store declarations

Each phase updates `docs/play-store-declarations.md` in the same change. The Play Console
answers change when the branch merges, and a person changes them. Phase 2 puts install
keys and certificates on the server, and adds `@noble/curves`, so the Device or other IDs
answer and `mobileDependencies` in the facts block change with it. The rest changes in
phase 3.

The permissions come from Android's pages for Wi-Fi Direct, the local-only hotspot and
Bluetooth. The real-phone test confirms the list. They go in the module's own
`AndroidManifest.xml`, not `app.json`: `app.json` cannot express these attributes, and any
edit there moves the iPhone fingerprint.

| Permission | Attributes | Android API |
| --- | --- | --- |
| `BLUETOOTH`, `BLUETOOTH_ADMIN` | `maxSdkVersion=30` | up to 30 |
| `BLUETOOTH_SCAN` | `usesPermissionFlags=neverForLocation`, or a scan needs fine location past 32 | 31 and up |
| `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT` | | 31 and up |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | `maxSdkVersion=32`. Both, or Android 12 may ignore the request. | up to 32 |
| `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`, `CHANGE_NETWORK_STATE`, `ACCESS_NETWORK_STATE` | | all |
| `NEARBY_WIFI_DEVICES` | `usesPermissionFlags=neverForLocation` | 33 and up |

- **Not `ACCESS_LOCAL_NETWORK`.** It follows the app's target SDK, not the phone's Android
  version, and at target 36 Android says not to add it. A guard fails when `targetSdk`
  reaches 37.
- **Not `FOREGROUND_SERVICE` or `REQUEST_INSTALL_PACKAGES`.**
- **`uses-feature required=false`** for `android.hardware.bluetooth`, `bluetooth_le` and
  `wifi.direct`. The Bluetooth permissions imply the feature, and Play would filter phones
  without it from the listing, for everyone, flag or no flag.
- **What a phone asks at run time**, by `Platform.Version`, only when Share nearby opens,
  or on a disguised phone only after a press and the warning (section 5.8): on 29 and 30, fine and coarse; on 31 and 32, the three Bluetooth ones plus fine and
  coarse, which is two prompts; on 33 and up, the three plus `NEARBY_WIFI_DEVICES`, which
  is one. On 31 and 32, "Approximate" grants only coarse, and Wi-Fi Direct needs fine
  there, so the screen asks again and says why.

The flag does not reduce this list: the permissions are in the build for everyone who gets
it (decision 157), and only the prompts wait until someone opens Share nearby.

`scripts/playDeclarations.test.ts` reads `app.json`, not module manifests, so these
permissions would pass it unnoticed. Phase 3 extends `actual()` to parse them, with
`modulePermissions` and `moduleFeatures` in its facts block. AGENTS.md forbids updating
that block without checking the Play Console answers it stands for. Expected answers to
review in the Play Console:

- **App access:** the reviewer's test account must be in an organization that has it on,
  or the reviewer cannot reach the feature behind the new permissions.
- **App content, permissions:** the new permissions. Android 10 to 12L phones will see a
  location prompt although nothing about location is collected. People will question that
  prompt, so the screen has to explain it first.
- **Data safety, Location:** stays "not collected". No new Google SDK is added, since the
  link uses Android's own APIs.
- **Data safety, Device or other IDs (phase 2):** the install key and certificate are new
  identifiers kept on the server. They are made for everyone in an organization that has
  it on, so the answer cannot say each user chooses. Account deletion (decision 46) must
  remove them, which a cascade on `install_keys` and `install_key_revocations` does.
  `deleted_profile_ids` keeps only a bare id, which names nobody once the account is gone
  (phase 6). Revocation lists carry an organization's install keys and profile ids between
  its members' phones, and phone-to-phone certificates carry them already. Discovery-key
  generations are about a language and no person, and the cap's counters sit on
  `install_keys`, so neither changes this answer.
- **Data safety, Data shared:** audio and events now also go phone to phone, to the same
  team members who could already read them. "Hold teammates' recordings" changes how much a
  phone keeps and not who may read it, so it changes no answer.
- **The disguise note (phase 3):** a disguised phone can now share nearby, after a press, so
  Android's prompts will name the app in front of whoever is there. No Play Console answer
  changes and no permission is added, but the disguise section of
  `docs/play-store-declarations.md` gets a line saying so, because it says what the disguise does.
- **Data safety, Encrypted in transit, and the US export question (phase 3):** the app now
  has its own encrypted protocol between phones. `docs/play-store-declarations.md:27`
  ("standard HTTPS encryption only") and `:86` (HTTPS services only) become untrue.

Phase 5 adds iOS strings (`NSBluetoothAlwaysUsageDescription`,
`NSLocalNetworkUsageDescription`, `NSBonjourServices`), and needs a fresh look at
`ITSAppUsesNonExemptEncryption`, which is `false` today.

Phase 6 needs a fresh look too:

- **Data safety, Data shared:** a newcomer's name, and a language with that organization's
  member names and the library documents it uses, go phone to phone before the server has
  approved the person.
- **Account deletion:** someone with no account yet can only erase the phone, through
  "Remove me from this phone" (section 14.1), and the answers have to allow for that.
- **Distribution:** the app is also offered as an APK on next.langquest.org, and carried
  builds use a Play track of their own. `docs/play-store-declarations.md:29` ("Internal
  testing only") is stale since decision 157 and must also name it.
- **Permissions:** `REQUEST_INSTALL_PACKAGES` stays out of the app. Google restricts it to
  apps whose core purpose is installing packages, and the app never installs itself.

Diagnostics (phase 3): a new value such as `transfer.t.src: 'nearby'` needs the
`diag.schema()` migration and enters the user-issue watch by itself. A new `nearby` kind
or field needs that migration and the facts block too, and the watch does not see it
unless its filter is restated. Only transfers go to the watch for now: a file failing its
hash check is worth an issue, and exchange records are for reading a field report. Neither
records the other person's id (`docs/diagnostics.md`), and
`apps/mobile/public/privacy.html` gets the same change.

## 10. Not in the first release

Each of these is a separate decision, and none is blocked by this design. Phase 6 needs
the first two, in the forms section 14 describes.

- **A language this phone never opened.** It needs a whole state from a teammate's phone,
  which this phone cannot check. A new teammate with an account still gets it from the
  server first. A newcomer gets a starting copy, which the server replaces.
- **The organization stream.** Roles and memberships come only from the server, since they
  decide what a phone will accept. A language created offline therefore does not spread
  until someone is online. An admin's unsent organization changes therefore wait for that
  admin's phone, so "the whole team's work" in section 1 means each language's work. They
  could travel sealed and unfolded later, if admins' changes turn out to matter. In phase
  6 a newcomer's starting copy includes the part of the organization this language needs,
  and this rule stays for everyone else.
- **Source Bible audio and guide media.** One phone downloading in town and sharing with
  the team would be very useful, but publishers' terms need checking first
  (`docs/source-bible-audio.md`, `docs/licensing.md`). They are not in a starting copy
  either (Carl's answer, 2026-11-06), so a newcomer may not be able to do much that needs
  them.
- **A file bundle by share sheet or SD card**, for phones whose radios cannot do this.
- **Sharing in the background.** Turned down in section 2.
- **Reviewing a passage a phone has not filled in.** A follow-up after phase 6, since the
  row path will exist by then.
- **The author's phone telling teammates what the server refused** (section 5.7).
- **Resuming a dropped file part-way, L2CAP channels, and one phone hosting several at
  once.** Each waits on numbers from the real-phone test.

## 11. What the real-phone test must answer

There is no spike now. Every question here stays open until the test at the end of the
branch (section 7), and its answers and numbers get written in here.

| Question | Why it matters |
| --- | --- |
| Real throughput and discovery time on 2 GB Androids, in a hut and across a room | Everything in section 4 is reported, not measured here. |
| Does the link hold up on China-market phones with no Play services: Xiaomi, OPPO, vivo, Honor, older Huawei? | The deciding factor (section 4). Nothing has been tested there, and their systems may kill or block what stock Android allows. Whether they deliver unfiltered scan results is unknown; one empty `ScanFilter`, the usual workaround, is an option from JavaScript. |
| Which Android versions and phone makers does the field use? Query `diag.installs` (`npm run diag`) | The docs say "partner phones are 2 GB Androids", but nothing here has counted them. Phones below Android 10 get a disabled row, so this says how many people that leaves out. |
| Can a phone in China reach next.langquest.org, Supabase, R2 and EAS Update? | Carrying the team's work means nothing if the server cannot be reached from there. Not tested. |
| How often does the band end up 5 GHz, and what does each band really deliver? | Reports range from 4 to 53 MB/s, and every phone now has to receive everything. |
| Does a Bluetooth broadcast with a rotating id and no fixed service id work between phone makers, and on iPhones later? Does `neverForLocation` pass a rotating UUID, given it filters some beacons? | It is what keeps a phone from being marked as running this app (decision 171). |
| Using an outside scanner, by Android version and controller type (`isLeExtendedAdvertisingSupported`, `isMultipleAdvertisementSupported`), with the maker named: does a restart give a new address, is the address ever the public one, and over an hour against a phone under Find, does one address appear under two salts, or one salt under two addresses outside a held pipe? | Where a restart keeps the address, rotation does not stop a continuous scanner, and the decision entry must say so. On a legacy-only controller AOSP says there is no way to use a different address. A phone advertising its public address breaks "nothing fixed" (section 12). |
| Scanning a market's worth of ordinary phones: how many match this form of broadcast, and how many change UUIDs? Record counts only, not addresses. | Section 5.5 says a determined scanner may tell a phone is probably running this. This says how far that goes, what the warning on a disguised phone should say (section 5.8), and how many salts no key matches a phone would echo there (section 5.12, Generations). |
| With a sniffer, by Android version and maker, for host and joiner: what does 0x2A00 return with discoverable on and off, which services can a stranger list, what do beacons and probe responses carry, what does a stock group's name look like, and do the BSSID, device address and name repeat across groups, Wi-Fi restarts and reboots with no persistent group saved? | Decides what the notice on Share nearby names (section 5.8), and whether `'after-hearing'` is worth using. |
| With `connectable` at `'always'` and `'after-hearing'` on Android 10 to 13: discovery time and failed meetings. | `'after-hearing'` is used only where it costs no meetings (section 5.12, Find). |
| How often does a pair hear only one way, how long does a mutual echo take with five phones, does every maker report a changed scan response under an unchanged advert, and does refreshing it every 2 seconds hold up? | The echo decides when phones connect, and the tap covers what it misses. |
| How many phones cannot advertise (`capabilities().advertise`)? | They cannot be echoed, and two such phones cannot meet. It also says how many phones a new generation leaves unable to meet a newer one until they sync (section 5.5). |
| What do Android's permission prompts and the hotspot's join dialog name on a disguised phone, by Android version and maker? | The warning says the app's real name will show, from memory of AOSP (section 5.8). If they name the launcher alias, the warning changes. |
| How long does a phone ahead wait to be echoed by one a generation behind, in a room of five and in a crowded place? | That echo is a salt no key matched, and it decides whether one trip to town moves a team without taps (section 5.12, Generations). |
| Is five minutes the right idle limit, and what does an hour under Find cost in battery on a 2 GB phone? | A field phone may have little power. A latecomer pays one tap. |
| Does a phone restored from a backup have a new install key? | Closes the batch counter's known weakness if so (section 5.3). |
| Ed25519 and `@noble/hashes` speed under Hermes on the slowest phone, and native encryption at Wi-Fi speed | Decides whether signing and hashing go native. A dev-only self-test could loop a 50 MB encrypted file over `127.0.0.1` on any phone. |
| Pairs against one phone hosting several, with five phones, including how long Wi-Fi takes to come up | Time for a whole team to converge, now that every phone takes everything. Moving between pairs is only worthwhile if reconnecting is fast. |
| Can members of a group reach each other, or only the host? | Decides whether a host has to pass everything on. |
| Can two pairs run at once in one room, and how much do they slow each other? | Nothing found says. It decides how long a team of five takes. |
| Can a phone keep scanning during a session, and does the scan limit bite? | A session stops scanning for now, so it cannot notice a teammate who arrives after it began. The burst lengths in section 5.11 are from reports. |
| How long should backups run while a teammate waits? | Two minutes is a guess. |
| Bluetooth and Wi-Fi with recording, and with hotspot in use | What breaks in real use. |
| What does the merged manifest of a real build hold? | The manifest merger's result cannot be read on this machine, so check it once, including that no other entry widens `ACCESS_FINE_LOCATION` past 32. |
| Load and fold times with a month of a team's nearby rows on a 2 GB phone | Decision 143's bound assumes checkpoints shed, and these do not. |

For joining offline (section 14):

| Question | Why it matters |
| --- | --- |
| Does the link work on a factory-fresh phone that has never been online? | It should, since it uses only Android's own APIs, but nothing has tested it. |
| Does a universal APK file signed with the Play key install offline, sent by Quick Share and copied by SD card? | It is the main route. Answerable only after the merge, since only then is there a Play-signed build of this code. A person can try it on an older build first. |
| Can Quick Share through Files by Google send an installed app as a complete copy? | It would mean nobody has to prepare a file, but production builds are app bundles, so a phone holds split APKs, and Play's own "Share apps" is reported removed. |
| Does a phone installed that way take Play updates later? | It has to reach the normal update path when it first gets online. |
| Does Android developer verification get in the way of installing offline? | It expands globally in 2027, and Google's page does not cover this. |
| Does `GET generatedApks` give a universal APK on the `alpha` track without waiting for review, may `PLAY_REVIEW_KEY` read it, and how big is the file? | Section 14.4 depends on it. Someone with the key tries it first on an existing build (Carl's answer, 2026-11-06). The file holds four ABIs and the speech models, and carriers download it on town connections. |
| Does a QR code with this payload scan on 2 GB phones in poor light, and does the camera's scanner work with no Play services? | Section 14.1 keeps the payload small for this reason. |
| What do Files by Google, common makers' file managers and Chrome's download list show for this APK? | The neutral name only stops a casual look (section 14.4). |
| Can a phone read a starting copy from another reducer version? | The fallback if carried files often go out of date (section 14.3). |
| How long does a starting copy take for a big language on a 2 GB phone? | Koro Miyan has about 160,000 rows (decision 143). |

## 12. Decisions this touches

Entries are written in the same commit as the phase that makes them, with `By: Carl
Sauder`. The next free number when this was written is 205, and each is renumbered after
merging main.

- **New entries:** a nearby phone is not a server, `nearby`, the batch counter and signed
  manifests, whole batches and a signed floor, ids bound to their author, and a budget per
  signer (phase 1); install keys, one certificate per organization, certificates as chains,
  the per-organization flag, attested claims, the revocation list, and discovery-key
  generations with their one-hop hand-on and the limits that remain (phase 2); our own
  link on Android's own APIs, Android first, the sealed opening, the echo and echoing a salt no
  key matched, the three levels for freeing space, every phone taking everything and "Hold
  teammates' recordings", a backup going when the server confirms it, signed holdings, and what
  a phone keeps of who it met (phase 3); delivery, accepting a revoked key's earlier work and the
  cap on it, no redaction by relay, and the author's phone not telling teammates of a refusal
  (phase 4); carried builds and their R2 bucket, join passes with an id per window, looked-after
  accounts holding them, the starting copy, which documents a language uses and what it leaves
  out, a newcomer's id derived from their key, accounts made with a phone's own id, and the QR's
  contents (phase 6); leaving experimental, when that is decided.
- **Amends:**
  - **11** and PLAN.md section 9: an event comes from its author, or from a phone holding
    the author's valid signature (phase 4).
  - **53:** the app's first flag has no synced configuration document (section 5.10, phase
    2).
  - **59:** a join can come through a new Worker route taking a chain and a phone's own
    id. `supabase/functions/join` stays as it is for current builds (phase 6).
  - **60:** nearby events never go through the courier, a nearby file can be evicted
    before the server has it, and teammates' files are not in a hand-over's uploads
    (phases 1 and 3).
  - **75:** proof of a key can sign someone in to an account made from a chain, until that
    key's first session, recorded on `install_keys`. After that, a helper's code as for
    anyone (phase 6).
  - **92:** lost backups are not the person's own (phase 3).
  - **97:** taking back a departure the server does not have also needs Override
    checkpoints, because "it changes nothing" stopped being true, and an old build on a
    shared phone can get a refusal that Try again recovers (phase 4). Caleb should see this.
  - **104:** a `./nearby` entry in `packages/sync`, with a lint exception at
    `eslint.config.mjs:32` (phase 1).
  - **150:** a required `android-native` job, on the module's files, `apps/mobile/package.json`
    and the root `package-lock.json` (phase 3).
  - **152:** `append_events` is restated once, for the `by:` rule. Any other id behaves as
    today, so old builds keep their results (phase 2). `may_emit` is restated once too, which
    changes one result for an old build on a shared phone, as 97's amendment says (phase 4).
  - **154:** LQ001 takes nothing per caller, not per author, so a below-gate build's signed
    work goes up when a current phone delivers it, and delivery joins `SENDS` (phase 4). Caleb
    should see this, since 154 is his entry.
  - **155:** a phone with no Play Store gets a carried file after a native change, because
    `release/android` goes once the new build is public (phase 6).
  - **157:** carried builds never go to production review (phase 6).
  - **165 and 166:** a teammate's recordings count as waiting to upload here, on the icon,
    the bar and the Waiting list (phase 3).
  - **168:** the install key and certificates sit outside the seal, used only when someone
    signed in has opened Share nearby, and discovery keys stay inside it (phase 2). Caleb
    should see this.
  - **171:** a disguised phone is offered Share nearby, with limits. The radios never run behind
    the cover. Opening the screen does nothing, and a press starts it. Ten minutes or "Up to date"
    stops it, with no listening bursts, and going to the background stops it for good, so only a
    new press after the code restarts it. One warning comes before any permission prompt, because
    Android's prompts name the app whatever icon the phone shows. `radios.joinHotspot` is false.
    Its code goes through a `.android` seam and its
    words stay in `src/disguise/i18n`, as the amendment of 2026-11-05 asks. "Hold teammates'
    recordings" is off by default there. The broadcast has nothing fixed the app picks, but its
    form may tell a determined scanner, and the system's own names and address are not the app's
    to hide (phase 3). Caleb should see this, since 171 is his entry.
  - **200:** New password gains "A phone of mine was lost or taken", which revokes that
    person's keys (phase 4). Caleb should see this, since 200 is his entry.
  - **110,** only if a fallback in section 14.3 is needed.
  - **PLAN.md section 7** (`status` values, phase 1), **section 13** (a row for each new
    screen, phases 3 and 6) and **section 14** (the three levels, the row, and a backup going
    when the server confirms it, phase 3).
  - **`docs/invites-and-accounts.md` flow E:** a new person can come in offline, and a
    third kind of key (phase 6).
- **Kept:** 5 (our own sync); 15 (clocks are as they were, since the vector counts
  batches); 51 (no private key in a build system); 58 (no nearby sync on the web); 110
  (pruning stays, so phones cannot supply pruned events); 143 and 147 (nearby events take
  part of the pull's path); 151 (the new names and functions stay for supported builds);
  invariants 1 to 12. For a newcomer, 11 also stays true: their phone pushes only once the
  author is the caller. 67 stands: Invite goes by permissions alone, so looked-after accounts
  hold join passes (Carl's answer 18), and 54's "cannot invite" was superseded by it.

## 13. Open questions

Only what is still open. Everything else this section used to ask is now settled where it
belongs: section 2 for Carl's answers, and sections 5 to 14 for the rest.

| Question | Who | Draft answer |
| --- | --- | --- |
| Which phones, and whose stack, for the real-phone test? | Carl | Section 7 lists the kinds of phone. It needs someone's own Supabase and Worker. Nobody has been named. |
| Are the terms clear for publishers' documents to go in a starting copy? | Carl, whenever he can | They stay out until he confirms, and `study@2` with them, so a team's own guides also wait for first contact, and the allowlist fails closed (answer 19, section 14.1). If he confirms, widen `STARTING_COPY_FORMATS` and `mayGoInStartingCopy`. Nothing waits on this. |
| Is the amber upload bar right on a phone holding backups? | Carl, when it ships | It counts them, as true of this phone (section 5.8). He should be told, so he can object. |
| Is decision 168's amendment acceptable? | Caleb, and the security review | Carl's answer stands unless the review finds a reason (section 5.5). A copied key with a live pass can let in a new person with no manage privilege, and he should know that too. |
| Follow-up issue, "A lost shared phone: other people's keys stay good" (section 6). Should a helper's code say a shared phone is gone? | Carl raises it with Caleb, after the first release | Only the named person is revoked for now (answer 20), and the list holds pairs. A taken shared phone's private key is gone for all of its people, but the others' rows stay good. A third question in a new `issue_sign_in_code_v3`, "Was the shared phone lost too?", with v2 left as no, would revoke every row with that key. It changes the helper flow (decision 59), so it needs Caleb. The issue does not exist yet. |
| A pass fetched late in its 90-day window has little time left, so should an answer also hold the next window's pass in that window's last 30 days? | Carl | Answer 17 is built as worded, so a phone that last reached the server near a window's end can hold a pass with days left, and every pass ends on the same date. Holding the next window's too would keep a team leaving town able to let someone in, at the cost of up to 20 uses in that time. Not built unless he says so (section 14.1). |
| What ends the experiment? | Carl, later | A follow-up issue, as decision 53 asks. A suggested test: teams have used it offline for a month, the test's numbers hold in the field, and no work was lost or wrongly confirmed. |
| When admins get the toggle, may they turn it on without staff? | Later | Yes, once it is no longer experimental. Until then, staff choose who tries it. |
| Can an iPhone that already has the app join offline? | Later | In principle, after phase 5. Only the install is impossible. |
| Could an existing member use a starting copy for a language they never opened? | Later | By the same path. Newcomers come first. |

## 14. Joining offline

A new person with a new Android phone and no internet gets the app, the organization and
the language from a teammate's phone, and starts work on the team (Carl, 2026-11-06). It
is phase 6, behind its own flag, `nearby_join` (section 5.10). An iPhone cannot install an
app offline, so this is Android only. The requirement is decided; section 11 lists what
could still change this design.

Joining adds no event type. Membership enters the log through the server's redemption, as
it does today (decision 54).

### 14.1 How it works

1. **The pass, beforehand.** A person's certificate answer (section 5.10) also holds a
   *join pass* for each language they can invite to, when their organization has both
   `nearby` and `nearby_join` on. Looked-after accounts hold them as anyone does (Carl's answer
   18): decision 54's "cannot invite" was superseded by 67, Invite goes by permissions alone,
   and most field admins are looked-after. A pass is a signed document naming the organization,
   language, inviter and inviter's key, the roles allowed, 10 uses and an expiry (section 5.12).
   **One pass to a window** (Carl's answer 17). The Worker derives its `passId` from the
   organization, language, inviter, key and 90-day window, and it expires at the window's end,
   so the daily refresh makes no new uses. A pass fetched late in a window has little time left,
   and Let someone in says when this phone's pass has run out and that it needs the server again
   (section 13 asks about this).
   **Nothing is written at issue.** An invites row could not be refreshed this way,
   because `issue_invite_v3` appends `v1.InviteIssued` for each one, so one per inviter,
   language, role and sync would grow the immutable log without end. The first use at the
   server makes the row and the event. Nobody has to prepare it.
   - **Roles** (Carl's answer, 2026-11-06). Only roles with no privilege in core's
     `MANAGE_PRIVILEGES`, whose privileges the inviter holds: Translator, Reviewer, Viewer
     and custom roles like them. An admin can raise the role after first contact. So a
     local person never holds a role that makes other hooks write organization events
     (`useLibraryFollow`), which could not travel.
   - **How a pass stops: automatically only** (Carl's answer, 2026-11-06). Past expiry or
     uses, the inviter has lost Invite or that role, the role is retired or has gained a
     manage privilege, the inviter's key is revoked, or the inviter is suspended (which also
     revokes their key). An organization with either feature
     off refuses new joins. There is no withdraw button, and no withdrawn state exists on
     `invites`. Demoting an inviter is undone if the role comes back, so for a taken phone
     the key's revocation is the stop that holds. Every account can now reach it: one with an
     email through New password, a looked-after one through a helper's code with `lost`, and
     anyone through staff (section 6).
2. **The app.** A coordinator or teammate carries a universal APK file in one piece, built
   from the team's latest JavaScript (Carl's choice, 2026-11-06, section 14.4), and sends
   it by Quick Share or copies it by SD card or USB. The newcomer has to allow installing
   from outside the Play Store, a system prompt they will need guidance through. The app
   never installs itself (section 9). Sending the app already installed on a teammate's
   phone would be easier, because nobody has to prepare anything, so the real-phone test
   tries that too.
3. **Letting them in.** The inviter opens a new Let someone in screen, from Share nearby
   or from Invite someone, and chooses a role. It is hidden for a local person, who holds
   no pass. The inviter's phone makes its opening for this link, hosts a Wi-Fi Direct group
   and shows a QR code holding only how to connect, a one-time secret and a pin on that
   opening: `langquestnext://join?v=1&t=<kind>&s=<network name>&p=<passphrase>&h=<port>&k=<16
   random bytes>&c=<first 16 bytes of SHA-256(eph_r || nonce_r)>`, about 120 characters. The
   newcomer refuses any opening that does not match the pin, so a rogue group cannot pose as
   the inviter. The pass, its chain and the discovery key travel over the link only after the
   inviter's tap, because a photo of the QR gives anyone all they need to get that far, and
   the key cannot be taken back once it is out.
   - The newcomer scans it with the scanner already on Sign In and types their name.
     `parseKey` in `inviteCode.ts` gains a third kind of key, `langquestnext://join?...`
     only, because the `https` form would need app.json `intentFilters`. `ScanQr.read` and
     `useIncoming.receive` both branch on it before `invite.scan`, since the scan screen
     refuses a new person offline today.
   - **Only on a phone with nobody on it:** no saved session, lock, hand-over, local person or
     unsent row. Otherwise the screen says this phone already holds someone's work, because a
     local person makes Sign In unreachable, which would lock out everyone signed out here
     (decision 168). A family sharing one phone cannot add someone offline.
   - Their phone joins the group, and both run Open and Hello with `kSess` from the QR's
     secret (section 5.12). The first opening takes the link: from then on the inviter's
     phone refuses new connections and tells the inviter. Hello on this link has an empty
     chain, proof and device id from both sides, which only this screen accepts, so a QR
     holder learns nothing about the inviter. The two clocks must agree within 5 minutes,
     because a new phone's date is often wrong.
   - When the inviter's Hello lists `let-in`, the newcomer's phone makes a new install key,
     replacing any leftover, and a 16-byte `idSalt`, derives its profile id from them (section
     5.12, Chains), keeps them with the join's progress, so a dropped link or another inviter
     gets the same id, and sends `join-ask` with its name and proof of key. Until the grant,
     neither side acts on anything but `join-ask`, `join-grant` or `bye`, and `copy-ask` gets
     `copy-no` with `not-allowed`.
   - The inviter gets one tap, "Let Nyibol in?", because this gives a person the
     language's content and member names. Beside it are two of decision 168's sixteen
     pictures, worked out from `th`, and the newcomer's phone shows the same two, so a QR
     holder who connected first and typed the expected name is caught. The list's order
     becomes part of the wire contract. The inviter's phone then signs the second link,
     naming the chosen role, and sends `join-grant` with its proof, its newest discovery key
     and that key's generation and `floor`. The newcomer runs `checkChain`, checks the proof
     against the first link's key and that the invite link names the key, profile, device and name it asked
     with, and only then stores the key.
   - **How long.** A QR nobody has used dies at two minutes, and "New code" is one tap
     that keeps the chosen role and makes a new secret, group and opening. So does a No.
     After the first opening a longer deadline covers the ask and the tap. After the grant
     the link stays up until the session ends, because the starting copy runs over it. A
     drop before the grant needs a new code. A drop after it resumes through ordinary
     Find, because the newcomer now holds the chain and key.
4. **The starting copy** (Carl's answer, 2026-11-06). The inviter's phone, or any
   teammate's whose read gate passes the chain as Hello's does and that runs the same
   reducer and lines versions as the newcomer, sends the following. It takes the language
   from the checked chain, never from `copy-ask`, and answers `copy-no` with `not-allowed`
   for any other stream.
   - **State:** the part of the organization this language needs and the language
     checkpoint, and the part rows, verdicts and lines, by the same `(unit, kind, id)`
     order as the server's first download (decision 147, `keptFill.ts`), through
     `copy-ask` and `copy-part`, so a dropped link resumes. A phone has no `snapshotRows`,
     so the sender reads `store.keptUnits`, `keptByUnit(PART_KINDS)` and `keptAll`. It
     skips audio and filled rows, and refuses passages it has not filled. Checkpoint and
     part rows hold only confirmed work. Line rows do not, because `KeptLines` works them
     out from live state, and verdict rows have `unitId` '' where the server's cut files
     them under a passage. Both are accepted, since the copy is replaced later. A language
     kept on disk writes its first checkpoint only at `checkpointEvery` (2,000) confirmed
     events, and one the server has no snapshot of pulls every event, so a young language
     has none: asked for a copy, the sender takes one then, which holds only confirmed work
     and prunes as any checkpoint does. Without it every copy of such a language stopped
     after the organization (found on two emulators, 2026-11-09). The
     organization part is `newcomerOrgState(state, languageId)`, a pure function in core
     that starts empty and copies an allowlist: the organization, `roles`, `license`,
     `library`, `recommendations`, this language, and live members at organization scope
     or at this language. `invites`, `joinDecisions`, `clusters`, redactions and other
     languages stay out, and so does any field added later. It costs nothing later,
     because the first pull from 0 replaces it. It is idempotent, since a teammate who is
     still local may pass on a copy they were given.
   - **Member names:** what `profile-directory:<id>` holds, which seeds the newcomer's, or
     every teammate shows as "someone", filtered by the sender to the `members` of that
     cut. That key caches `my_directory`, which holds the people of every organization the
     caller belongs to and, for someone with Invite, everyone with a pending join request,
     so unfiltered it would give a stranger the inviter's other team. A name the fold has
     not caught up with shows as "someone" until first contact. The chain's name is merged
     in on teammates' phones.
   - **Library documents this language uses,** checked by hash: a document's name is the
     SHA-256 of its canonical text (`library/docStore.ts`). `library_get_documents` is
     signed-in only, so without these a screen such as `map_home` has nothing to read.
     - **What "uses" means.** Core's `docsThisLanguageUses` (section 5.12, Documents a language
       uses) says: what this language's own events name, which is its template and every
       template it has used, its flow and its book names; the current version of each library
       item chosen for it, by being recommended and not hidden, linked to a passage, or a help
       on a check; and what those refer to, such as a template's numbering. What it could reach
       does not count: the rest of the organization's library, and what other organizations
       share. The sender and the newcomer work out the same list.
     - **What may go.** Only formats on an allowlist in core: `template@1`, `template@2`,
       `flow@1`, `material@1`, `versification@1` and `names@1`. An allowlist fails closed if a
       new format appears. A `material@1` goes only if it says neither `source` nor `pattern`
       and its item is this organization's own, not followed or copied, because FIA's key words
       are a `material@1` (`scripts/fia-terms.ts`), and a copy keeps those fields
       (`libraryMaterialDoc`).
     - **What stays out** (Carl's answer 19). Publishers' imports make `study@1` and
       `collection@1` too, and sources make `source@1`, `sourceBook@1` and `timing@1`, so all of
       those wait until Carl confirms the terms. `study@2` stays out too: the guide editor makes
       it for an organization's own guide and also for a publisher's copied to adapt, so its
       format cannot say which, and a team's own guides wait for first contact with it.
       `labels@1` is not on the allowlist either, because no language names a set: the app finds
       them through `library_shared_items`, which needs the server, so a followed item shows the
       name it was published with until first contact.
     - **The check.** A sender answers `copy-no` to any hash off that list, so a chain holder
       cannot read another language's template or a publisher's document this phone holds, and
       the newcomer keeps a text only if it hashes to its name and the allowlist takes it.
   - **No source audio or guide media.**

   `adoptStartingCopy` writes it in one commit with the cursor at 0, a marker,
   `startingCopy:<org>/<stream>` (section 5.1), and `nearbyClaimed` set to the copy's
   `serverSeq`, so claims resume above what the copy already holds. The ordinary exchange
   then brings everything newer as `nearby`, and audio follows section 5.6. Only a newcomer takes an
   organization state from a phone; everyone else still gets it only from the server. A
   link's row source throws `OfflineError` on a drop and never answers null, or `KeptFill`
   reads it as a gone cut and drops the language. A sender that gives no organization or
   language (`copyServed.stateRefused`: its own download still running, or nothing from the
   server yet) still lets the person in, and its screen says so (`copy-short`): they are in,
   and any teammate with Share nearby open can finish the copy. Once the copy has committed, the progress
   screen says one line, to everyone: "This phone no longer needs the install file. You can
   delete it, unless you will pass it on."
5. **Working.** The app runs with a *local person*: an actor id and no server session, in
   `secureStorage` (`src/server/localPerson.ts`). Only one per install, because a local
   person cannot sign out and Sign In is unreachable for them.
   - **Identity.** `App.tsx` reads them beside `savedSignIn`. `signedIn` splits into
     `signedIn` for routing and a new `serverSession`, at about 6 call sites. Finish the
     copy before setting the person, because `Shell` remounts on the actor id. Until then,
     a progress screen, which `GUEST_SCREENS` lists, keeps progress so a dropped link
     resumes.
   - **Membership.** An overlay of the chain's membership (`withChainMembership`) on
     `org.state` at `Workspace` means nothing below it changes, and `privilegesFor` gives
     real answers. It gives the link's signed privileges, not the fold's role of that id,
     because any teammate may send the starting copy, and a role raised since would otherwise
     hand a local person manage privileges. It writes nothing to the log.
   - **Requests.** Without a session a request gets a refusal, not a network failure, and
     sync shows `refused`. So `hasSavedSession` also answers true for a local person, and
     `sessionSafeFetch` turns as-no-one requests into offline failures. Their transport
     throws `OfflineError` until first contact, because `pushNow` marks anything the
     server answers as rejected. Events stay `pending`.
   - **Teammates.** Their events are `pending` here and reach teammates as `nearby`, shown
     under the name in their chain: the session reports it (`peer.name`, from a two-link
     chain only), so does the inviter's tap, and the app keeps it under
     `chain-names:<actorId>`, laid under the directory, which a read from the server
     replaces whole, so the server's name wins once it has one (`chainNamesModel.ts`).
     Teammates see them by name only until first contact,
     and cannot ask them for work yet. Account changes wait in the account outbox
     (`durableOutbox.ts`), which already gives a retryable error with no session.
   - **Me.** No Sign out, no notification switch, no Switch or new organization. "Remove
     me from this phone" under More settings, with a warning about unsent work, takes the
     place of Sign out and Delete account, and deletes the install key, with the chains,
     passes, discovery keys and `nearbyPeers:` rows it leaves behind, the record last. `useHeldInvite`,
     `useOnboarding`, `useInbox` and `useIncoming` take `serverSession`. App icon stays under
     More settings, so a newcomer can choose another look.
6. **First time online.** `useFirstContact`, above the organization, calls `POST
   /api/nearby/join` on the Worker when the server answers, with the chain, proof of key,
   the profile id and a request id. It is a Worker route, shared with the relay as
   `accountFromChain`, so one implementation can be tested here with fakes.
   `supabase/functions/join` stays untouched for current builds, and Edge Functions cannot
   import core.
   - **The account.** `accountFromChain` takes a two-link chain only, and `checkChain` has
     already recomputed the id from the key, so it cannot name an existing member, an
     imported v2 person who has not signed in yet, or anyone else (section 5.12, Chains).
     An imported person has live memberships and no `auth.users` row until `v2-sign-in`,
     and `org_memberships` is plain text with no foreign key, so without this a chain
     could claim their id and inherit every role, and `v2-sign-in` would then lock the
     real person out. It runs in this order, in one function both routes share:
     1. An id that already exists is accepted only if its `app_metadata.chain_key` equals
        this key, and a missing `install_keys` row is then added again, so a failure
        between the two calls recovers on retry. Anything else is refused.
     2. A deleted id is refused, from `deleted_profile_ids`, a small table `_delete_account`
        writes, because `accountdeleted:` events are written only for live memberships.
     3. `pass_refusal(pass, role)` is asked before any Auth call, unless this person has
        already redeemed this pass. It is read-only and shares its checks with
        `redeem_pass_for`, so a dead pass makes no account at all, and `createUser` is not
        an unlimited factory.
     4. `createUser` with the phone's own id and `app_metadata: { managed: true, chain_key }`,
        which is atomic with the account and only the service role can write. Today's retry on
        "already" errors is wrong with a fixed id, so it does not copy that.
     5. The `install_keys` row, then `redeem_pass_for`.

     A repeat with the same request id is safe. The route never deletes an account this
     request did not make, because a relay-made one may already hold events. If redemption
     is refused after a create, in a race for a pass's last use, the account stays: it
     holds nothing, and only this key can reach it. A database error or `PGRST202` answers
     503, never a refusal. `JOIN_RATE_LIMIT`, a binding of its own at about 20 a minute
     per address, runs before any signature check, and `useFirstContact` reads a 429 as
     not yet, because a town's phones can share one address.
   - **`redeem_pass_for`,** in this order. A token derived from a pass would let anyone
     who has seen one redeem it through `redeem_invite_v2`, `preview_invite` or
     `supabase/functions/join`, past every stop here, because `redeem_invite_for` finds a
     row only by hashing a plain token. So no token exists:
     1. If this person has already redeemed this pass, return the organization id, before
        any stop, so a repeat still answers after the uses run out, the flag goes off or
        the key is revoked.
     2. Refuse unless both `nearby` and `nearby_join` are on (`_org_joins_on`, which
        `nearby_certificate_facts` also uses to issue passes).
     3. Refuse an inviter's key that is revoked, or live privileges of the role this link
        chose that overlap `_manage_privileges()`, a SQL copy held to core's
        `MANAGE_PRIVILEGES` by the parity script. A role widened with no manage privilege
        still redeems, because `_invite_still_granted` caps it at what the inviter holds,
        and automatic upgrades such as `useTranslatorReview` must not refuse people months
        into their work.
     4. On a first use, insert the invites row, on conflict on `token_hash` do nothing, holding:
        `id = gen_random_uuid()::text`, `org_id` from the pass, `token_hash = 'pass:' || passId`,
        `role_id` the role this first use chose, `scope` `{ "level": "language", "languageId":
        <the pass's> }`, `expires_at` the pass's `expiresAt`, `issued_by` the pass's `inviter`,
        and `max_uses = pass.maxUses`, with no label or email. Append `v1.InviteIssued` only if
        the insert happened, under reserved ids `invitemember:` and `inviteredeem:`. No SHA-256
        hex can equal that hash, so no token can reach the row, and `issue_invite_v3` refuses
        anything else as a hash, so nobody can squat it.
     5. Call `_redeem_invite_row(actor, invite id, role)`, the body of `redeem_invite_for`
        split out, with the chosen role in place of the row's, which already holds used,
        expired, retired and no longer granted. `redeem_invite_for` stays as a wrapper,
        with its null-actor 42501 first, so store builds see no change (decision 152). An
        invite id is no secret and new functions default open, so both new functions are
        revoked from every API role, and a smoke proves it.
   - **The session.** Proof of the key signs the person in only with a matching
     `chain_key`, `first_session_at` null, `revoked_at` null and a looked-after account
     (Carl's answer, 2026-11-06), so an ordinary account's certified key gets nothing,
     however it got its row. After that, a helper's code as for anyone. This amends
     decision 75. The route never writes `first_session_at`. `nearby_certificate_facts`
     does, on all of that person's rows, because it holds a bearer token, and
     `useFirstContact` calls the certificate route straight after adopting the session,
     whatever the flag says, and retries until it succeeds. `take_sign_in_code_v2` closes
     the same rows, so a helper's code on another phone ends it too. So a lost reply can
     be retried whenever the phone next gets a signal, and a repeat has no more power than
     a first try. A refusal returns no session, so nobody holds a session with no
     membership, the transport stays offline and the work stays `pending`.
   - **The starting copy goes.** With the cursor at 0 and the marker set, `pullNow` takes
     the first-download route, not only when there is no checkpoint, which would keep
     anything forged for good. The server's first download replaces the copy, by the path
     that already replaces a language (decision 143), and the marker clears in the same
     commit, with `nearbyClaimed` moved to the new cursor, since the copy's seq was only a
     teammate's word. Where the server has no snapshot, the copy is dropped first, and the stream
     pulled from 0. The organization stream never has one, so it pulls into a temporary
     client on a `MemoryStore`, as `reports.ts` does, and writes the result in one commit,
     so the person keeps a working organization on a poor link. `loadUnits` takes no
     checkpoint while the marker is set. The log's pending and nearby events fold on top.
     Push then works as always, so the author is the caller and decision 11 holds.
   - **After.** The overlay goes when `org.members[actorId]` has any entry, live or
     removed, not at the join, or the person falls to "What brings you here?" during the
     first download. A refusal keeps the person and the work, and says so on Me and Sync.
     Someone with Invite can let that same id in with an ordinary invite. Sign In is
     unreachable for a local person, so the refused state on Me and Sync offers the
     scanner, and the phone posts that token to the join route with its chain and proof of
     key. The token is the permission (decision 59), so the route calls `preview_invite`
     before `createUser`, requires the invite's organization to equal the chain's, and
     still requires the chain, so a token holder cannot pick someone else's id. The work
     then goes up.

From then on it is a phone like any other, so `nearby`, the door, freeing space and
section 5.11 need nothing more. This is medium-sized by a reader's estimate: about 30
files and 500 to 700 lines of app code, leaving out the starting copy, the join route,
chain checking and carried builds. Nothing measured that.

### 14.2 What the earlier phases do for it

None of this shows to anyone until `nearby_join` is on. These parts would be costly or too
late to change afterwards, so they go in with the earlier phases:

| Phase | What it does | Why it cannot wait |
| --- | --- | --- |
| 1 | Hello gives a range of protocol versions, what the phone can do and its reducer versions (section 5.3). | "Update the app" is a dead end for someone with no internet. |
| 1 | The door asks one lookup what a person may do (section 5.4). | A newcomer is not in anyone's organization fold yet. |
| 1 | `NearbyLink` assumes nothing about any one radio, and the Open step takes `kSess` from any source (section 5.12). | A QR code has to be able to start a link that discovery did not. |
| 2 | Certificates are chains, and phones make their own keys (section 5.5). | Phones must be able to accept a newcomer. |
| 3 | The `carried` profile goes in `eas.json` (section 14.4). | Adding it later costs a second Android store build and an iPhone review. |
| 4 | The relay checks each batch's own chain and answers per event, so phase 6 can add authors with no account yet (section 6). | Otherwise a newcomer's lost phone loses their work. |

### 14.3 What could stop it

- **The app's version, the biggest risk.** A phone cannot read a checkpoint from another
  reducer version (decision 110), and `REDUCER_VERSION` reached 21 in about eight weeks. A
  store build holds only the JavaScript from when it was built, and later JavaScript comes
  by over-the-air update, which a phone that has never been online cannot get. So a
  newcomer would often run a different reducer from the team. The plan's answer is the
  carried build (section 14.4), which still fails when a file goes out of date.
  - **If that proves too common:** a phone could read a starting copy from another reducer
    version, which is only safe if older code tolerates newer state, or phones that may
    let someone in could keep their pruned events, so a newcomer can fold them itself.
    That is decision 110's own condition for reversing, and it costs storage.
  - **Turned down:** passing on a phone's running JavaScript update. Expo's only supported
    way to load an update from another address needs `disableAntiBrickingMeasures`, which
    Expo says not to enable in production, because it removes the built-in update and any
    rollback. Writing into `.expo-internal` would depend on a library's private format.
    Updates are also not code-signed today (`app.json`), so a newcomer could not check
    what a teammate's phone gave them, and signing needs a private key that decision 51
    keeps out of build systems.
- **A factory-fresh phone.** The link needs no Play services, which removes the old worry
  about their version, but this is untested, and the phone's date is often wrong.
- **Installing offline.** Play Console offers a signed universal APK for each store build,
  which Google says uses the Play signing key and may be distributed elsewhere. Someone
  still has to save the file while online and replace it when it goes out of date, and
  whether a phone installed that way takes Play updates later is untested. Sending the
  installed app instead is less certain: reports say Play's own "Share apps" feature has
  been removed, and production builds are app bundles, so a phone holds split APKs, and it
  is not known how Quick Share through Files by Google handles them. Android developer
  verification expands globally in 2027, and Google's page does not cover a phone that is
  offline at install.
- **Refused work.** If a pass stops before the newcomer reaches the server (section 14.1),
  the join route refuses, and their work has no account to go under until someone with
  Invite lets that same id in. Phones that have seen the inviter's loss or the inviter's
  revoked key also stop exchanging with that newcomer until then, so their new work stays on
  their own phone and on phones that have not synced. That matches what the server would do,
  since a phone cannot tell an honest early signature from a backdated one, but it narrows
  purpose 2 for that person, and the screen says their work is safe here. A phone marked lost
  strands newcomers let in on it the same way.
- **One newcomer to a phone with nobody on it.** A family sharing one phone cannot add someone
  offline (section 14.1).
- **Source audio and guides.** They are not in a starting copy (section 14.1). Without
  them, a translator may not be able to do much. Without publishers' documents and `study@2`,
  no study guide will open until first contact, not even a team's own, and an FIA key-word
  list will not show.
- **Trust and privacy.** A newcomer cannot verify an APK or a starting copy offline. A
  forged copy is replaced at first contact, but anything they did until then rested on it.
  A language and this organization's member names also go to someone the server has not
  approved, so only someone holding `invite_members` can let them in, after one tap and a
  comparison of pictures, for a role with no manage privilege, and other phones send a
  starting copy only after their read gate passes the chain. Teammates cannot count a pass's
  uses offline; the server does that at the join. The typed name can copy a member's, though
  only under a new id and the pass's role. The security review covers all of this.

### 14.4 The carried build

The carried APK holds the team's JavaScript, so no update has to travel (Carl's choice,
2026-11-06).

- **Also for phones with no Play Store.** Phones in China cannot get the app from Play at
  all, so this file is how they get it, online or not. Until the first one exists, the
  real-phone test's APK serves on those phones.
- **When.** A merge into main that changes `REDUCER_VERSION`, `LINES_VERSION`, the
  protocol range or the Android fingerprint also makes a carried build, about twice a week
  at the reducer's pace so far. The first three decide whether a starting copy can be read
  and whether two phones can talk. The fingerprint is there because over-the-air updates
  after a native change reach the old runtime only through `release/android`, and decision
  155 deletes that branch once the new build is public, so a phone with no Play Store
  would get nothing for good until a newer file exists. Other merges do not need one.
- **The check.** `scripts/carried-build.mjs --check` asks for the file by name, and a 404
  means make one, because EAS clones only the latest commit, so it cannot diff. This also
  retries a failed publish by itself.
- **Never promoted.** `scripts/play-review.mjs` sends the newest build on the internal
  track to production review, so a carried build goes on the `alpha` track with release
  status `draft`, which that script does not read. EAS documents only production, beta,
  alpha and internal, so a named track is not on offer. It is an exception to decision
  157. It uses up a version code, so later store builds simply number higher.
  `store-build-guard` treats the profile as it does `production`, and `server-calls` holds
  its calls, since it is in the field too.
- **Its own profile.** `carried` extends `production` and keeps its channel, as an app
  bundle, because `get_android_build` matches on profile and fingerprint: with the
  `production` profile, a carried build could satisfy that check when the store build
  failed, and the next merge would publish an update for a runtime no store build runs.
  Adding it moves `eas.json`, so it goes in the one merge (section 7). Its workflow jobs
  stand apart from the store build's, so a failure cannot stall `publish_android_update`.
- **Getting the file.** A job fetches the build's signed universal APK (Android Publisher
  `generatedapks`, `GET generatedApks/{versionCode}`, then its download) and puts it in a
  new R2 bucket, with a token limited to that bucket (Carl's answer, 2026-11-06), served
  by the Worker at `https://next.langquest.org/apk/*`, under a name holding only its
  versions, such as `r21-l1-p1-<first 8 of the fingerprint>.apk`, with the same name in
  `Content-Disposition`. A carrier holds this file in Downloads or on an SD card, where no
  disguise applies, so the name says nothing about the app. One function computes the name
  for the script, the route and the screen. That stops a casual look and does not hide the
  app: the `.apk` extension stays, the install prompt names the app, and the browser's
  download list and history keep `next.langquest.org` (from memory, section 11 checks). It
  is apart from teams' recordings and their auth, and public by design. It cannot be a
  static asset, since Cloudflare's per-file limit is reported as 25 MiB. `/apk/*` goes in
  `run_worker_first`. A person creates the bucket and applies the credential. Someone with
  `PLAY_REVIEW_KEY` tries `GET generatedApks` on an existing build first, and that key's
  reads must stay read-only. A carrier downloads the file with their browser while online.
  The app does not download it, which keeps clear of Play's rules on apps downloading
  APKs, which are not confirmed. Whether China can reach this is untested (section 11).
- **Checking before leaving town** (decision 240, amended three times 2026-11-09). Getting the
  file is done online before a trip, and letting someone in is done in the field, so each
  has a screen of its own (Carl's choice). Get the install file (`get_install_file`) names
  the file this phone needs by those versions alone, and says the file in Downloads must
  have exactly this name: any other name is the wrong version. Share nearby opens it from
  a row above Let someone in, on the same terms (a pass held, joining on, Android), with a
  line saying it is for before going offline; Let someone in opens it from a line at its
  top saying the new phone needs LangQuest installed first; and Sync's Ready for offline
  card opens it from its reminder line (below). Let someone in keeps only the
  field: the role, Show the code, the code, the pictures, the one tap and the words of a
  version refusal.
  - *Getting it.* While online, Get the install file, that screen's one main button, opens `<Worker>/apk/<name>` in the
    phone's browser (`Linking.openURL`; the address is built in `src/server/carriedApk.ts`),
    which downloads it. A line says to download it before going offline, that the new phone
    must allow installing apps from other sources, and to send it by Quick Share (which needs
    Google Play services on both phones), SD card or USB. Offline the button is disabled,
    with a line saying it needs the internet. The app requests nothing there itself.
  - *Too old.* The press keeps the name in one phone-wide meta row, `carriedApkOpened`,
    which holds no person, organization or time. While the name this phone needs differs
    from it, Get the install file says the file got before is for an older version and to
    get the new one before going offline, and Share nearby says the same as a line while
    online, under A new person, above its Get the install file row. The words go when the two match again; the
    row stays, so the next version is caught too.
  - *Reminded while online* (Carl's choice, 2026-11-09). Sync reminds a carrier before they
    leave, on Share nearby's terms for A new person (`joinRows`), only while online (the
    server just reached and the file can be got, `apkGet`), and only while this phone has
    not got the file it needs now: never got (no `carriedApkOpened`) or got for an older
    version (`apkStale`); nothing shows before the meta row is read. Its Ready for offline
    card gets a line, "Install file for a new person: not got yet" or "Install file for a
    new person: for an older version", with a Get it link to Get the install file
    (`sync_status → get_install_file`), and the Share nearby row a small amber line, "Get the
    install file before you go offline" (5.8). Both go once the right file is got, by
    pressing Get the install file or a right file under Check my file. The rule is
    `apkReminder` in `carriedApkModel.ts`; what reads nearby state is in `.android` files
    (`InstallFileReminder`, `NearbyRow`) with plain stubs elsewhere.
  - *Check my file.* Opens Android's system file picker (`expo-document-picker`, which needs
    no permission; the file is not copied) and compares only the chosen file's name with the
    one needed: "This is the right file", which is then remembered as got, or "This file is
    for a different version: you need <name>". `expo-file-system`'s picker was not enough: it
    gives the picked file's address, not its name.
  - A help line says: "When everyone you came for is in, delete this file. You need internet
    to get it again." It gives no reason, and does not mention a disguise (decision 171's
    amendment of 2026-10-29). A carrier whose own phone wears a disguise sees two more lines,
    only on their screen, through an `.android` stub: on Let someone in, that the new phone
    will show LangQuest until they choose another look under More settings, and on Get the
    install file, that the browser's history and download list show where the file came from. Nothing crosses the link about a disguise.
- **When they still differ.** A starting copy moves only between phones on the same
  reducer and lines versions. Hello compares them (`versionsDiffer` in the session report;
  the wire is unchanged), and both screens say so: the inviter's that their app is a
  different version and that they need this phone's file, by name; the newcomer's that its
  app is a different version from the teammate's, and to get the install file from them,
  install it and scan a new code. Teammates on other versions still exchange events as usual
  once the newcomer has a starting copy.
- **After install.** A carried build uses the `production` channel, so when the phone gets
  online it takes over-the-air updates like any other.

## 15. Sources

- [Nearby Connections overview](https://developers.google.com/nearby/connections/overview), [strategies](https://developers.google.com/nearby/connections/strategies), [permissions](https://developers.google.com/nearby/connections/android/get-started), [payloads](https://developers.google.com/nearby/connections/android/exchange-data) and [authentication](https://developers.google.com/nearby/connections/android/manage-connections)
- [Nearby Connections: BLE between Android and iOS](https://github.com/google/nearby/issues/2465)
- [Apple TN3213: moving from Multipeer Connectivity to Network framework](https://developer.apple.com/documentation/technotes/tn3213-moving-from-multipeer-connectivity-to-network-framework.md)
- [Wi-Fi Aware between iOS 26 and Android](https://developer.apple.com/forums/thread/790195), [MacRumors on iOS 26](https://www.macrumors.com/2025/06/21/ios-26-adding-two-new-wi-fi-features/) and [heise on the EU requirement](https://heise.de/-10446649)
- BLE throughput reports: [Ditto](https://www.ditto.com/blog/introducing-v1-0-3-for-ios-now-faster), [Apple forums](https://developer.apple.com/forums/thread/770717), [Nordic DevZone](https://devzone.nordicsemi.com/f/nordic-q-a/61028/confusion-to-use-l2cap-vs-gatt-for-max-throughput-with-ios) and [Memfault](https://interrupt.memfault.com/blog/ble-throughput-primer)
- [NEHotspotConfiguration](https://developer.apple.com/documentation/networkextension/wi-fi-configuration.md)
- Installing offline: [`REQUEST_INSTALL_PACKAGES` policy](https://support.google.com/googleplay/android-developer/answer/12085295?hl=en), [Android Central](https://www.androidcentral.com/apps-software/google-ditches-share-apps-nearby-share-play-store) and [PhoneArena](https://www.phonearena.com/news/google-app-sharing-feature-play-store_id168341) on Play's "Share apps", [Quick Share help](https://support.google.com/googleplay/answer/9283534), [Android developer verification](https://support.google.com/android-developer-console/answer/16561738?hl=en) and [Android Authority on its timeline](https://www.androidauthority.com/android-sideloading-changes-timeline-3679204/)
- Working without Play services: [Android Wi-Fi Direct](https://developer.android.com/develop/connectivity/wifi/wifip2p), [`WifiP2pConfig.Builder`](https://developer.android.com/reference/android/net/wifi/p2p/WifiP2pConfig.Builder), [local-only hotspot](https://developer.android.com/develop/connectivity/wifi/localonlyhotspot), [Wi-Fi Aware](https://source.android.com/docs/core/connect/wifi-aware), [apps in China](https://appinchina.co/blog/google-play-store-in-china-everything-you-need-to-know/), [google/nearby](https://github.com/google/nearby), [HMS Core devices](https://consumer.huawei.com/en/support/content/en-us15841699/), [HarmonyOS NEXT and Android apps](https://m.gsmarena.com/huaweis_harmonyos_next_beta_launches_officially-news-63397.php), [Bridgefy pricing](https://bridgefy.notion.site/Bridgefy-SDK-Pricing-22cf443f5ef680039882cd88cedac706) and [its iPhone usage notes](https://docs.bridgefy.me/sdk/ios/usage)
- Reports on the same approach: [nativephp-wifi-direct](https://github.com/protendai/nativephp-wifi-direct) (Android hosts and joins, iPhone joining), [medXfer's notes](https://github.com/Medboy224/medXfer/pull/225) (speeds by band, iPhone approval), [the Mutual Transmission Alliance](https://www.slashgear.com/xiaomi-oppo-and-vivo-form-alliance-for-easy-wireless-file-transfer-02605050) and [SCMP on its growth](https://www.scmp.com/tech/article/3085428/chinas-airdrop-android-now-works-oneplus-and-more)
- Carried APK and updates: [Play's signed universal APK](https://support.google.com/googleplay/android-developer/answer/9006925), [Android Publisher `generatedapks`](https://developers.google.com/android-publisher/api-ref/rest/v3/generatedapks), [Expo on overriding the update address](https://docs.expo.dev/eas-update/override/), [Expo code signing](https://docs.expo.dev/eas-update/code-signing/) and [`eas.json` tracks](https://docs.expo.dev/eas/json/)
- Android permissions and scanning: [local network permission](https://developer.android.com/privacy-and-security/local-network-permission), [location at run time](https://developer.android.com/develop/sensors-and-location/location/permissions/runtime), [`uses-feature`](https://developer.android.com/guide/topics/manifest/uses-feature-element), [Punch Through](https://punchthrough.com/android-ble-scan-errors/) and [ProAndroidDev](https://proandroiddev.com/to-find-a-beacon-without-losing-it-my-journey-into-a-realm-of-bluetooth-low-energy-on-android-aa3e2c2923aa) on scan limits, and [Apple on advertising from an iPhone](https://developer.apple.com/library/content/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/BestPracticesForSettingUpYourIOSDeviceAsAPeripheral/BestPracticesForSettingUpYourIOSDeviceAsAPeripheral.html)
