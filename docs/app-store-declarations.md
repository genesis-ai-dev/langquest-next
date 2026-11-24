# What we tell Apple's App Store

Kind: reference

The answers given in App Store Connect for LangQuest Next, bundle ID
`com.frontierrnd.langquestnext`, that Share nearby on iPhones touches
(`docs/nearby-sync-plan.md` section 7, phase 5; decisions.md 256). Google
Play's answers are in `docs/play-store-declarations.md`; this file is its
counterpart for Apple, and so far it records only what phase 5 changes. The
rest of App Store Connect (age rating, the listing, the other App Privacy
answers) is not recorded here yet: add each one as it is next looked at, from
what App Store Connect shows, never from memory.

**When the iPhone app changes what it collects, sends, asks permission for or
shows, update this file and the matching App Store Connect answer in the same
change**, as AGENTS.md asks for Play. A merge into main sends the iPhone build
to App Review by itself (decisions.md 157), so an answer a change needs goes
in App Store Connect before that change merges.

First filled in: 2026-11-16, Carl Sauder, with Claude.

## Permissions the app asks for

The words iOS shows in each prompt are `ios.infoPlist` in `apps/mobile/app.json`.

| Key | Since | Why |
| --- | --- | --- |
| `NSMicrophoneUsageDescription` | the first build | Recording passages. |
| `NSBluetoothAlwaysUsageDescription` | phase 5 | Share nearby finds teammates' phones over Bluetooth while its screen is open, and, from phase 10 where the organization has `nearby_open`, while LangQuest is open and offline (`docs/nearby-sync-plan.md` 15.6). Asked once, after Share nearby's line saying why (`askPermission`); sharing while LangQuest is open never asks and runs only once it was allowed. |
| `NSLocalNetworkUsageDescription` | phase 5 | Share nearby moves work over Wi-Fi to the teammate's phone. iOS asks at the first such connection; the app cannot ask ahead. |
| `NSBonjourServices`: `_nlink._tcp` | phase 5 | Two iPhones meet over Apple's own direct Wi-Fi as a Bonjour service of this type, under a one-time name, only while a link comes up. |

No background modes: the radios run only while LangQuest is open and in
front, on Share nearby or, from phase 10, quietly while offline where staff
turned `nearby_open` on and the person has not turned "Share while LangQuest
is open" off (`docs/nearby-sync-plan.md` 15.6). Quietly, an iPhone joins no
Wi-Fi and moves only the team's changes over Bluetooth, so neither the local
network prompt nor the hotspot join comes up, and no App Store Connect answer
changes.

## Capabilities

| Capability | Since | Why |
| --- | --- | --- |
| Hotspot Configuration (`com.apple.developer.networking.HotspotConfiguration`) | phase 5 | An iPhone joins an Android teammate's Wi-Fi network by name and passphrase, with a system prompt each time. |

The App ID must have the capability on, and the App Store provisioning
profile EAS keeps must include it, before a build with the entitlement runs.
Store builds come only from the EAS workflow on main (decisions.md 156),
which signs with the profile EAS already holds and has no Apple sign-in, so
it cannot turn a capability on or make a new profile. The first build after
phase 5 merged failed this way (2026-11-17: the profile "doesn't include the
Hotspot capability"). So a person, signed in to the Apple developer team,
does it once for every new capability, before the change that adds it
merges:

1. Apple Developer > Certificates, Identifiers & Profiles > Identifiers >
   `com.frontierrnd.langquestnext`: tick the capability (here **Hotspot**)
   and Save. Apple marks the existing profiles invalid.
2. In `apps/mobile`, `npx eas credentials -p ios`, profile `production`,
   then Build Credentials > All: set up all the required credentials, and
   sign in to Apple when asked. EAS makes a new App Store profile. If it
   says the profile is valid, delete the provisioning profile from the same
   menu and run All again.
3. Run the failed `build_ios` job again from the workflow run on expo.dev,
   or let the next merge into main build it.

## App Privacy

Share nearby sends the team's work straight to teammates' phones, and a phone
that reaches the internet uploads teammates' unsent work for them (delivery,
phase 4), as the work the app already sends to our server. What phase 5 adds
for Apple is what phase 2 added for Google: each install makes a signing key,
and the server keeps its public half with the person's account and device
(decisions.md 217). Play declares it under "Device or other IDs". The
matching App Privacy answer is **Identifiers → Device ID: collected, linked
to the user, used for App Functionality, not for tracking**. Add it before
the first iPhone build with Share nearby goes to review. Nothing else in App
Privacy changes: no location is read on an iPhone, and Bluetooth and Wi-Fi
only carry the team's own work.

## Encryption (export compliance)

`apps/mobile/app.json` says `ITSAppUsesNonExemptEncryption: false`, which was
true while iPhones carried only HTTPS and the sign-out lock. From phase 5 an
iPhone also has Share nearby's protocol between phones, as Android has had
since phase 3: X25519 key agreement, HKDF and HMAC with SHA-256 and Ed25519
signatures in JavaScript (`@noble/curves`, `@noble/hashes`), and AES-256-GCM
for every frame and file in the module (Apple's CryptoKit), all published
standard algorithms protecting the team's own data. Play's "Encryption"
section names the classification the developer must confirm (mass-market,
5D992.c). **Before the first iPhone build with phase 5 goes to review, the
developer decides Apple's export compliance answers from that
classification and sets `ITSAppUsesNonExemptEncryption` to match**; until
then it is left as it was, because the value is a declaration only the
developer can make.

## App Review notes

Share nearby appears only for an organization LangQuest staff have turned
nearby sync on for, so "LangQuest Sample" must have it on before a build
with it goes to review (`npm run org-feature -- grant <its organization id>
nearby --hosted`). The notes add: "Share nearby (Sync → Share nearby) passes
the team's work between phones with no internet, iPhone to iPhone or iPhone
to Android. Sign in as the test account on two phones, open the same
language on both, and open Share nearby on both. On an iPhone, iOS asks for
Bluetooth first, and for the local network when the phones first connect
over Wi-Fi; between two iPhones, tap 'A teammate may be nearby' once." A
reviewer has one device, so attach a short video of two phones sharing.
Joining offline (Let someone in) is not on iPhones and is not described.
Sharing while LangQuest is open (phase 10, `nearby_open`) stays off for
"LangQuest Sample" unless staff grant it, and is then not described: it asks
for nothing and shows nothing a reviewer must reach.
