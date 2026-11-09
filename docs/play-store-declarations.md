# What we have told Google Play

The answers given in Play Console for LangQuest Next, Android package
`com.frontierrnd.langquestnext`, so the next person does not have to
reconstruct them, and so a change to the app that makes one of them untrue is
noticed (decisions.md 49).

**When the app changes what it collects, sends, asks permission for, shows or
who it is for, update this file and the matching Play Console answer in the
same change.** `scripts/playDeclarations.test.ts` fails when the Android
permissions, the Expo plugins, the mobile app's dependencies or the
diagnostics allowlist change and the facts block at the end of this file was
not updated with them. Agents tell the developer which Play Console answers to
revisit (AGENTS.md, "Store declarations").

First filled in: 2026-09-30, Caleb Koster, with Claude.

## App

| Field | Answer |
| --- | --- |
| App name | LangQuest Next |
| Package | `com.frontierrnd.langquestnext` (permanent) |
| Default language | English (United States), en-US |
| App or game | App |
| Free or paid | Free (cannot become paid later) |
| Declarations | Developer Program Policies; US export laws: the app complies. Besides HTTPS it has its own encryption, all standard algorithms: on Android, Share nearby's protocol between phones (AES-256-GCM under keys from an X25519 exchange, HKDF and HMAC with SHA-256, Ed25519 signatures; `docs/nearby-sync-plan.md` 5.12), and on any phone the sign-out lock (decisions.md 168). See "Encryption" below |
| Developer account | The organization account (D-U-N-S) that publishes LangQuest v2; not subject to the 12-tester rule for new personal accounts |
| Track | Production: every new build that a merge to `main` makes goes to production review and is public once approved, with no staged rollout (decisions.md 157, which replaced decision 45's internal testing only). Carried builds (decisions.md 240) go to the alpha track as drafts, are never released there or sent to review, and their Play-signed universal APK is offered at `https://next.langquest.org/apk/<name>` for phones with no Play Store or no internet (Distribution, below) |
| Managed publishing | Off |
| Category | Productivity (a work tool for translation teams) |
| Tags | Up to five that fit from Google's list (team collaboration, voice recorder, translation, Bible) |
| Store contact email | admin@frontierrnd.com (public) |
| Store contact phone | None |
| Website | https://langquest.org |
| External marketing | Off until the app is public |
| Upload key | EAS keeps it; Play App Signing holds the store's signing key |
| Upload robot | `play-console-service-account@langquest-458501.iam.gserviceaccount.com` (LangQuest v2's), key stored in EAS credentials |

## Policy addresses

| Field | Answer |
| --- | --- |
| Privacy policy | https://next.langquest.org/privacy (`apps/mobile/public/privacy.html`, served with the web app) |
| Account deletion | https://next.langquest.org/delete-account (`apps/mobile/public/delete-account.html`); in the app, on a phone or the web: Me → More settings → Delete account (decisions.md 46; Settings became Me, decision 71) |

## App access

All or some functionality is restricted. Instructions: a test account,
`playreview@frontierrnd.com` (password with Caleb Koster; never in this
repository), an **Organization Admin** of the sample organization
"LangQuest Sample" with the Dinka language. "Sign in details provide full
access to all features": **ticked** (Organization Admin; no paid content).

Share nearby (Android, labelled experimental) appears only for an
organization that LangQuest staff have turned nearby sync on for, so
"LangQuest Sample" must have it on before a build with it goes to review
(`npm run org-feature -- grant <its organization id> nearby --hosted`), and
the instructions add: "Share nearby (Sync → Share nearby) passes the team's
work between two Android phones with no internet. Sign in as the test
account on two Android 10 or later phones, open the same language on both,
and open Share nearby on both; Android asks for Nearby devices (or, on
Android 10 to 12, location) first." Without the flag the reviewer cannot
reach the feature behind the new permissions. `nearby_join` (joining
offline, phase 6) stays off for "LangQuest Sample" and is not described,
as before; it adds no permission. If the developer chooses to show it,
grant it too
(`npm run org-feature -- grant <its organization id> nearby_join --hosted`)
and add: "Let someone in (Share nearby → Let someone in) lets a new person
join from a second Android phone with no internet: open it on the test
account's phone, choose a role and Show the code; on the second phone, with
nobody signed in, tap Scan a code on Sign In and scan it."

## Ads, audience and other declarations

| Question | Answer |
| --- | --- |
| Contains ads | No |
| Target audience | 18 and over (Families policy avoided; add 13–17 here and in Play if teams include teenagers; never under 13) |
| News app | No |
| Health, financial features, government app | No |
| Uses advertising ID | No |

## Content rating questionnaire

| Question | Answer, and why |
| --- | --- |
| Category | All other app types |
| Primarily news or educational | No: a work tool for translation teams |
| Violence | Yes, mildest options: scripture narrates violence (Judges, the crucifixion), text and audio only, not graphic, no visual depiction |
| Sexual content | Nudity or explicit content: No. Sexual references: Yes, mild, text and audio only (Song of Songs, Genesis 19) |
| Users interact or exchange content | Yes (recordings, reviews and comments within an organization; on Android, Share nearby also passes them between the phones of members of the same organization, who could already see them, which changes no answer) |
| Reporting and blocking | In the app: anyone can report a version, review, note, join request or person, and block a person; moderators and LangQuest staff act on reports, and the Terms of Use forbid objectionable content (decisions.md 48) |
| Interactions limited to invited people | Yes: only members an organization's admin invited or approved. Anyone with an account can send an organization a join request with a short message, seen only by its admins |
| Online content not in the download | Yes: source Bible audio, library templates, flows and reference material, and each team's synced work. No AI-generated content, news, film, music or shopping |
| Everything else (drugs, gambling, crude language, purchases, location sharing) | No |

Expected rating: about Teen / 12+ with "Users Interact".

## Data safety

| Question | Answer |
| --- | --- |
| Collects or shares required data types | Yes |
| Encrypted in transit | Yes: Supabase, the app's Cloudflare Worker (reports, decisions.md 44; recordings and guide media, kept in Cloudflare R2, decisions.md 69), Bible text and audio (Bible Brain's CDN, OpenBible) over HTTPS; no cleartext allowed. Phone to phone (Share nearby, Android), every message and file is encrypted with the app's own protocol, AES-256-GCM under keys from an X25519 exchange that only phones holding the language's discovery key can open, over Bluetooth LE, Wi-Fi Direct or a local-only hotspot; nothing readable goes out before the other phone proves it holds that key |
| Account creation | Username, password and other authentication: an email and password (someone with a LangQuest v2 account signs in with that account's email and password, which our server checks with LangQuest v2, our own app, once; decisions.md 94); or, for someone joining by invite with no email, the invite itself (a one-time QR code) makes the account, and they get back in with a one-time code from someone who can invite them, or with their sign-in name and a password if they set one (docs/invites-and-accounts.md, decisions.md 59); or, on Android in an organization with joining offline on, for someone a teammate let in with no internet, an account made the first time their phone reaches our server, from the teammate's signed invitation, with an id that follows from a key their phone made, and signed in once by proof of that key, after which they get back in as other looked-after accounts do (decisions.md 237, 238); no OAuth. LangQuest's own Global Viewer accounts (support staff, decisions.md 158) also enter a code from an authenticator app; no user of the app is asked for one, and nothing new is collected from users |
| Account deletion URL | https://next.langquest.org/delete-account |
| Delete some data without deleting the account | No. Account data is deleted with the account; an organization's work belongs to it, and requests about it go to its admins |

Data types. **Shared: No for every type.** Our processors (Supabase,
Expo, Cloudflare, and Anthropic and Linear for the watch for user issues,
which read diagnostics and feedback, with its screenshots and pictures, to
find, track and suggest fixes for problems for us; decisions.md 202) are service providers, not sharing in Play's terms.
Work an organization chooses to list publicly or release under an open
license is the organization's own action. So is connecting another app or an
AI agent with an access token (docs/agent-api.md, decisions.md 72): a person
approves it on the connect page, it reads only what that person can read, and
Play does not count a transfer the user starts and expects as sharing.
Feedback that app sends back is a review in the organization's log, already
collected as other user-generated content. Review links (`/r/<code>`) are a
web page outside the Android app: a person shares one, and whoever answers
on it gives a name, a comment and perhaps a voice note, which reach the app
as reviews (name, messages, voice recordings: types already declared).
Share nearby (Android, from phase 3) sends events, recordings, names in
signed certificates, and install keys straight from one member's phone to
another's in the same organization, encrypted between the two phones, when
both people have opened Share nearby. Each recipient is a member who could
already read that work from our server, so it is the same data reaching the
same people another way: a transfer the users start and expect, not a third
party, so it is not sharing in Play's terms, and every type it carries is
already declared collected (the server gets it too). "Hold teammates'
recordings" changes how much a phone keeps, not who may read it, so it
changes no answer. **Processed ephemerally: No** for every type.

| Category | Data type | Collected | Shared | Required or optional | Purposes |
| --- | --- | --- | --- | --- | --- |
| Personal info | Email address (an account's; and the work address at its website that an organization's admin types to ask for a blue check, decisions.md 173) | Yes | No | Optional (someone joining by invite may have none) | App functionality, Account management |
| Personal info | User IDs (the sign-in name of an account made by invite) | Yes | No | Optional | App functionality, Account management |
| Personal info | Name | Yes | No | Required | App functionality, Account management |
| Personal info | Phone number (a guest reviewer's contact, typed in by a user) | Yes | No | Optional | App functionality |
| Messages | Other in-app messages (review comments, join request messages, feedback sent from help mode) | Yes | No | Optional | App functionality |
| Audio | Voice or sound recordings | Yes | No | Required | App functionality |
| App activity | Other user-generated content (reviews, notes, answers, reports of content or people, blocked people, which Bibles and guides were used for a version or review) | Yes | No | Required | App functionality |
| Photos and videos | Photos (pictures and maps an admin adds to a study guide; a screenshot of the app, or a picture of their own, someone chooses to add to feedback) | Yes | No | Optional | App functionality |
| Photos and videos | Videos (films an admin adds to a study guide) | Yes | No | Optional | App functionality |
| Audio | Other audio files (step and glossary audio an admin uploads to a study guide) | Yes | No | Optional | App functionality |
| App info and performance | Crash logs | Yes | No | Optional (Settings switch) | App functionality, Analytics |
| App info and performance | Diagnostics | Yes | No | Optional (Settings switch) | App functionality, Analytics |
| Device or other IDs | Device or other IDs (random install ID, push token; the nearby install key, a public key each install makes for nearby sync and the server keeps with the account) | Yes | No | Required | App functionality |

The Reports section's map and country names (`d3-geo`, `topojson-client`,
`world-atlas`, `i18n-iso-countries`) are code and data inside the app: they
make no network calls and collect nothing.

The app's own words come in the person's language (LAN-42, decisions.md 81,
`docs/localization.md`). `expo-localization` reads the phone's language list
on the phone to choose one; `i18next` and `react-i18next` are code inside the
app, and every language's words ship in the app. The language someone picks
stays on the device. Nothing is collected or sent, so no data type changes.

`expo-network` (LAN-47) tells the app when the phone's network comes back,
so it syncs then instead of polling every few minutes with no signal. It
reads the connection state on the phone; nothing is collected or sent, so
no data type changes. Its Android permission, `ACCESS_NETWORK_STATE`, was
already in the app's merged manifest (from `expo-updates`) and is a normal
permission the person is never asked for, so no Play Console answer
changes.

`expo-keep-awake` (decisions.md 106) keeps the screen on while the
microphone is recording, so a hands-free session is not ended by the
screen timeout. It sets a flag on the app's window; it needs no Android
permission and collects or sends nothing, so no Play Console answer changes.

`expo-secure-store` (decisions.md 60, amended 2026-10-15) keeps the
signed-in session, and sessions kept for a shared phone's hand-overs, in the
Keychain (iOS) and the Keystore (Android) instead of plain app storage. It is
the same data on the same device, now encrypted and left out of Android
backups (`configureAndroidBackup`); nothing new is collected or sent, it adds
no Android permission and no biometrics (`faceIDPermission` is off), so no
Play Console answer changes. "Encrypted in transit" and the data types are
unchanged.

Signing out of a phone locks the person's sign-in on it (decisions.md 168) so
they can sign back in with no connection: their session is encrypted on the
phone under their password or a pattern they draw, using `@noble/hashes` and
`@noble/ciphers` (code inside the app, no network), and kept in the Keychain
or Keystore with the session itself. The password and pattern are checked on
the phone and never stored or sent; an email or sign-in name is kept only as
a hash salted per phone. Nothing new leaves the phone, so no data type
changes, and account creation and sign-in methods are unchanged.

Recordings (decisions.md 106) are kept and uploaded as AAC (`.m4a`) on a
phone instead of WAV: the same voice recordings in a smaller file, so the
"Voice or sound recordings" answer is unchanged.

The speech model (decisions.md 135) tells speech from noise while
recording: Silero VAD, a 1.3 MB file in the app, run by ONNX Runtime on the
phone (`onnxruntime-android` and `onnxruntime-objc` from the microphone
module, `onnxruntime-web` on the web). It scores the sound as it is heard and
keeps nothing of its own; it reads no files, sends nothing and needs no
permission, so no Play Console answer changes. The phones' runtime is held
at 1.22.0 on purpose: from 1.29.0 ONNX Runtime starts Microsoft's telemetry
when the app launches (a content provider that reads the device's Android
ID, with the INTERNET and ACCESS_NETWORK_STATE permissions), which would
add "Device or other IDs", collected and shared with Microsoft. Check for it
before raising the version.

Clean up (decisions.md 179) takes background noise out of a part on the
phone, when the person asks for it: DeepFilterNet 3, an 8.6 MB file in the
app beside the speech model, run by the same ONNX Runtime (1.22.0, so the
telemetry above stays out). It removes noise from the person's own
recording; it makes no new content, so "No AI-generated content" above
still holds. The cleaned part is uploaded like any other part, as the same
kind of voice recording, so the "Voice or sound recordings" answer is
unchanged. It needs no permission and sends nothing of its own, so no Play
Console answer changes.

The noise warning (decisions.md 181) measures how loud a part is and how
loud the room is between its words, on the device that recorded or plays
it. The numbers stay on that device and are never sent, so no Play Console
answer changes.

Even loudness (decisions.md 182) plays each recording people make in the
app (parts, voice notes, spoken feedback) from a copy turned up or down to
one level, made on the device the first time it plays and kept in that
device's cache (on the web, in the page's memory). The recording itself is
never changed, the copy is never uploaded, and nothing new is sent or
collected, so no Play Console answer changes.

Bible text and audio (docs/reference-material.md, decisions.md 62) come
from Faith Comes By Hearing's Bible Brain through our Worker, which holds the
key and sends Bible Brain no user data; phones then download the audio from
Bible Brain's CDN or openbible.com by plain links, as a browser fetches a
file. That is content coming in, not data going out, so it adds no data
type and no sharing.

Feedback from help mode (decisions.md 145): while help is on, Send feedback
opens a sheet where someone types or says (a voice note) what is wrong or what
would help. It goes to
the LangQuest team only (`diag.feedback`, read by support), never to the
organization, and carries the random install ID diagnostics use. Two switches,
both off until the person turns them on, add a screenshot of the app's own
screen and their name and email (or sign-in name), which the server reads from
the account itself. On Android and the web, "Add a picture" sends one
picture they choose (a photo, or a screenshot of something else) through the
phone's own file picker, as a JPEG of at most 1 MB (iPhones do not offer it:
Apple's App Privacy answers would need Photos or Videos, decisions.md 145); the app sees only that file and asks for no permission
(no `READ_MEDIA_IMAGES`). These are types already declared: the words are "Other
in-app messages", the voice note "Voice or sound recordings", the screenshot
and the chosen picture "Photos", the name, email and install ID
their own rows, all optional and for app functionality; nothing is shared. If
the team ever emails someone back about their feedback, "Developer
communications" must be added to Email address's purposes first.
`react-native-view-shot` takes the screenshot on a phone: it draws the app's
own window, needs no permission, reads no other app or file and sends nothing
itself. On the web `html-to-image` draws the page instead, loaded only when
feedback is sent. No Play Console answer changes.

Telling people to update (decisions.md 154): `expo-application` reads the
app's own version on the phone, so the app can compare it with the newest
version in the store and the lowest version that may still sync, which it
reads from our server (`app_versions()`). The version is compared on the
phone and is not sent anywhere. `expo-application` was already in every
build (`expo-notifications` depends on it), so no native code changes. The
Update button opens the App Store or Google Play page as a link. The server
learns which version is live from Apple's public lookup and Google Play's
public app page, which send no user data. Nothing is collected or sent, and no Play Console answer
changes.

A phone's disguise (decisions.md 171): under Me → More settings → App icon,
someone may give the app one of ten icons, five calculators and five
notepads, and a code of 4 to 12 digits. From then on the app opens on a
working calculator or notepad, and the code typed there opens LangQuest.
`expo-alternate-app-icons` changes the icon: on Android it turns one of ten
`<activity-alias>` launcher entries on and the usual one off (made by
`./plugins/withAndroidAppIcons`, which runs only the package's Android steps,
labels each "Calculator" or "Notes" in the phone's language and copies the
app's link filters onto each; since 2026-11-05 it holds the icon list itself,
so the iPhone build's embedded settings carry none, and Android's manifest is
the same as before). It needs no permission,
and only the person changes it, from inside the app, and can change it back
there (Deceptive Behavior: changes to the home screen with the user's
knowledge and consent, easily reversed). The code is kept on the phone as a
salted hash in the Keystore (`expo-secure-store`, `expo-crypto`), the
notepad's text in app storage; neither is sent. Turning it on disconnects
the phone's notifications through the existing call, since each would say
LangQuest. Nothing new is collected or sent, so no Play Console answer
changes. On Android a disguised phone can also share nearby after a press
(decisions.md 171, amended 2026-11-07), so Android's permission prompts
would name the app in front of whoever is there; the app warns first, and
never joins a hotspot there, whose dialog names it too. iPhone builds have
none of it (decisions.md 171, amended
2026-11-03): Apple refused iPhone build 48 twice under App Review Guideline
2.5.19 for the icons, so the iPhone app has no App icon row, no other icons
and not the package's native module, and the App Review notes in App Store
Connect leave it out. The Android build is the same as before
(`expo prebuild` writes the same Android project), so no Play Console answer
changes.

Nearby sync, phase 2 (`docs/nearby-sync-plan.md` sections 5.5, 5.10 and 9;
decisions.md 211 to 217): on Android, the first time someone on a phone
belongs to an organization that LangQuest staff turned nearby sync on for,
the app makes one Ed25519 key for that install (`@noble/curves`, code inside
the app with no network, its randomness from `expo-crypto`) and keeps it in
the Keystore. Its public half goes to our Worker with the person's sign-in,
once a day or when their membership changes, and the server keeps it in
`install_keys` beside the account and the install ID diagnostics already
use; the Worker signs a certificate binding that key to the person and the
organization, and hands back each opened language's discovery key and the
organization's revocation list. That is a new identifier kept on the server,
so it sits under "Device or other IDs", which was already declared
collected, not shared, required and for app functionality. Required stays
true: everyone in an organization that has it on gets a key, so the answer
cannot say each user chooses. Someone in an organization that is off makes
no new call and gets no key. Deleting the account deletes the keys
(`install_keys` and `install_key_revocations` cascade from `auth.users`,
decisions.md 46). A certificate and a revocation list name install keys and
profile ids of the same organization's members, and from phase 3 they pass
between those members' phones, as the team's work does; nothing goes to
anyone else. Discovery-key generations are about a language, not a person,
and the counters on `install_keys` are about a key, so neither changes an
answer. No screen shows any of this until phase 3, and no permission or SDK
that collects data is added, so the other answers are unchanged.

Nearby sync, phase 3: the link and the screen (`docs/nearby-sync-plan.md` sections 4, 5.6,
5.8, 5.9 and 9; decisions.md 218 to 229). On Android, an organization that LangQuest staff
turned nearby on for sees Share nearby under Sync, labelled experimental. While someone has it
open, the phone finds teammates who also have it open on the same language and passes the
team's unsent work between the two phones, with no internet.

- **The link.** `apps/mobile/modules/nearby-link`, a local Expo module on Android's own
  Bluetooth LE, Wi-Fi Direct and local-only hotspot APIs, with no Google Play services and no
  new SDK (no new entry in `mobileDependencies`). It logs nothing and sends nothing to us or
  anyone else; it reads no location.
- **Permissions and features** (the facts block's `modulePermissions` and `moduleFeatures`,
  from the module's own `AndroidManifest.xml`, merged into every build whoever has the
  feature, decision 157):

  | Permission | Limit | Android | Asked at run time |
  | --- | --- | --- | --- |
  | `BLUETOOTH`, `BLUETOOTH_ADMIN` | `maxSdkVersion` 30 | 10 and 11 | No (normal) |
  | `BLUETOOTH_SCAN` | `neverForLocation` | 12 and later | Yes, "Nearby devices" |
  | `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT` | | 12 and later | Yes, "Nearby devices" |
  | `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | `maxSdkVersion` 32 | 10 to 12L, where Bluetooth scans and Wi-Fi Direct require them | Yes, "Location" |
  | `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`, `CHANGE_NETWORK_STATE`, `ACCESS_NETWORK_STATE` | | all | No (normal) |
  | `NEARBY_WIFI_DEVICES` | `neverForLocation` | 13 and later | Yes, "Nearby devices" |

  `android.hardware.bluetooth`, `bluetooth_le` and `wifi.direct` are features with
  `required="false"`, so no phone is hidden from the listing. No background location,
  `FOREGROUND_SERVICE`, `ACCESS_LOCAL_NETWORK` or `REQUEST_INSTALL_PACKAGES`. Nothing is
  asked until someone opens Share nearby, and the screen says why before Android's prompt,
  because on Android 10 to 12L the prompt names location although none is read or kept.
  None of these needs a Play Console declaration form (only background location does), but
  they show in the release's permission list.
- **What stays on the phone.** Teammates' events and recordings, until the server confirms
  them (a backup goes as soon as it does, on every phone), with "Hold teammates' recordings"
  deciding how many of the recordings a phone keeps; holdings, the batch vector, the names in
  certificates it checked, and the partners it last finished with, with no time, place or
  meeting record. None of it reaches our server or any third party: phones exchange it only
  with each other.
- **What goes to teammates.** The language's unsent events and recordings with their
  authors' names, signed batches, holdings, the revocation list, a newer discovery key, and
  each phone's certificate (install key, profile id, device id, organization and role
  privileges), only to members of the same organization whose certificate checks and who may
  read that language. Data safety, above: not sharing, no new type.
- **Data safety, Location** stays "not collected": the location permissions exist only because
  Android 10 to 12L require them to scan and use Wi-Fi Direct, and the scan is marked
  `neverForLocation` from Android 12.
- **Device or other IDs** is unchanged from phase 2: certificates and install keys now also
  pass between members' phones, which is neither collection by us nor sharing.
- **Diagnostics**: below.
- **A disguised phone** (decision 171) is offered Share nearby too, with limits: opening the
  screen does nothing until a press, it stops after ten minutes or at "Up to date", leaving
  the app stops it, it never joins a hotspot, and one warning comes first that Android's
  prompts will show the app's real name. No permission is added for it and no answer changes.
- **Content and audience** are unchanged: the same organization's work between the same
  members.

Nearby sync, phase 6: joining offline (`docs/nearby-sync-plan.md` sections 9, 14;
decisions.md 234 to 240). On Android, in an organization that LangQuest staff turned both
`nearby` and `nearby_join` on for, a member who may invite can let a new person in with no
internet, from Let someone in; the new phone scans a code, the person types their name, and the
member taps once after both compare two pictures.

- **What goes phone to phone before our server has approved the person.** From the new phone to
  the member's: the name typed, a new install key and proof of it. From the member's phone, or a
  teammate's, to the new phone: a signed invitation (the member's certificate and a link naming
  the new person, their key, role and organization), a discovery key, and a starting copy of the
  language: its work, this organization's member names, and the library documents the language
  uses, with no source audio or guide media and nothing of other languages. Only a member who
  holds Invite can start it, after the one tap, for a role with no manage privilege, so the new
  person is someone that member chose to bring into the organization, which already sees this
  work. It is the same data reaching the person a member invited, a transfer the users start and
  expect, and every type is already declared collected: **Data shared stays No.** The developer
  should confirm that reading in Play Console, since the new person has no account yet.
- **What the new phone sends us at first contact** (`POST /api/nearby/join`): the signed
  invitation, proof of the key, the id it derived from that key, the name, the install id and a
  request id. That makes an account (Account creation, above): Name, User IDs, and Device or other
  IDs (the install key), all already declared collected, required where they were, for app
  functionality and account management. Until then nothing about the new person is on our
  server, and their work reaches it only as theirs.
- **Account deletion.** Deleting an account now also keeps its bare random id
  (`deleted_profile_ids`), so no copy of a newcomer's invitation can bring the account back; the
  id names nobody once the account is gone, and nothing else is kept. Someone with no account yet
  has nothing on our server to delete: their data is only on phones. "Remove me from this
  phone", under More settings in place of Sign out and Delete account, erases them from it: the
  person, the install key, the chains and passes it signed, their discovery keys and who was
  nearby. Work they made stays in the phone's copy of the team's work, as anyone's does, and is
  never sent from it as them. Uninstalling the app or clearing its storage erases everything.
- **Distribution.** The app is also offered as an APK file at
  `https://next.langquest.org/apk/<name>`, the Play-signed universal APK of a carried build,
  which Play Console offers for each build and Google says may be distributed elsewhere, under a
  name that holds only version numbers. A carrier downloads it with a browser while online and
  passes it on by Quick Share, SD card or USB; the app never downloads or installs an APK, and
  `REQUEST_INSTALL_PACKAGES` stays out of it. Carried builds use the alpha track, as drafts.
- **Finding and checking the file** (decision 240, amended 2026-11-09). Let someone in opens
  that address in the phone's own browser (Get the install file); the app makes no request to
  it. It remembers the name of the file last opened, in one row on the phone holding only that
  name (no person, organization or time), to say when the file is for an older version. Check
  my file opens Android's system file picker through `expo-document-picker`, Expo's module for
  it, and reads only the chosen file's name: the file is not copied, opened or read, and nothing
  about it leaves the phone. The picker needs no permission (the module adds only a `<queries>`
  entry for the `OPEN_DOCUMENT` intent, which is not a permission) and has no config plugin; it
  is linked on Android only (`expo.autolinking.ios.exclude`). It collects nothing: Data safety
  "Files and docs" stays not collected, since nothing is sent off the phone.
- **Permissions, content and audience** are unchanged: no permission or diagnostic is added,
  only that SDK, which sends nothing, and the new person joins the same organization's work by
  invitation, as before.

Share nearby's diagnostics (`docs/diagnostics.md`, the `nearby` kind in the facts block):
on Android, a record when a room stops, when a session ends, when Find fails and when the
screen cannot run, with counts, durations and the nearby module's fixed codes. They name no
teammate's phone (no tag, salt, key, install key, profile or device id), say nothing of a
disguise, carry no content, and go only to our own database with the person's other
diagnostics, under the same Settings switch and 90 days. That is more of "App info and
performance → Diagnostics", already declared collected, optional, not shared, for app
functionality and analytics, so no Play Console answer changes.

Not used, on purpose: Google Play's In-App Updates library (Play Core). It
would tell an Android phone itself when a newer version is live, but Google's own
data safety section for it (developer.android.com/guide/playcore/in-app-updates,
"Data safety") says that it sends Google the device's metadata, the app's
version and its installed modules, whether diagnostics is on or off, and
leaves the Data safety answers to the developer. That may change the "App
info and performance" and "Device or other IDs" answers, so it waits for the
developer's decision.

Not collected: location, financial info, health, files, calendar, contacts,
web browsing, app interactions beyond diagnostics, other personal info.

## Encryption

Play Console's "US export laws" is a declaration that the app complies, not a
questionnaire, so its wording does not change; what it covers does. From
phase 3 the Android app has its own encrypted protocol between phones,
besides HTTPS: X25519 key agreement, HKDF and HMAC with SHA-256 and Ed25519
signatures (`@noble/curves`, `@noble/hashes`, code inside the app), and
AES-256-GCM for every frame and file (the module, on Android's own
`javax.crypto`), all published standard algorithms, used to protect the
team's own data. That
is mass-market encryption of the kind the US Export Administration
Regulations treat under 5D992.c; the developer must confirm that
classification, and whether a self-classification report is due, before the
build with it goes to review. iPhone builds carry none of the module, so
`ITSAppUsesNonExemptEncryption` stays `false` until phase 5 looks again.

## Store listing

- Short description: "Record, review and check oral Bible translations with
  your team, even offline."
- Full description: voice recording with voice detection; review and checks
  (community checks, back translations); passage status and per-language
  progress; offline with sync; invites by link or QR code; roles (translator,
  reviewer, coordinator).
- Icon and feature graphic: the app's own icon (white bars and check on
  black, `apps/mobile/assets/logo.svg`, decisions.md 52), on a black ground.
- Screenshots: six framed phone screens on black (record, study, chapters,
  next step, checks, reviews) from the test account, showing the app's own
  purple theme unaltered.

## Facts the check holds

The test compares this block with the code. When it fails, find the Play
Console answer the change affects (permissions → Data safety and content;
dependencies → Data safety, ads, advertising ID; diagnostics → Data safety,
"App info and performance"), update it and the tables above, then update
this block.

```json play-store-facts
{
  "package": "com.frontierrnd.langquestnext",
  "appName": "LangQuest Next",
  "androidPermissions": ["android.permission.MODIFY_AUDIO_SETTINGS", "android.permission.RECORD_AUDIO"],
  "blockedPermissions": [],
  "modulePermissions": [
    "android.permission.ACCESS_COARSE_LOCATION maxSdkVersion=32", "android.permission.ACCESS_FINE_LOCATION maxSdkVersion=32",
    "android.permission.ACCESS_NETWORK_STATE", "android.permission.ACCESS_WIFI_STATE",
    "android.permission.BLUETOOTH maxSdkVersion=30", "android.permission.BLUETOOTH_ADMIN maxSdkVersion=30",
    "android.permission.BLUETOOTH_ADVERTISE", "android.permission.BLUETOOTH_CONNECT",
    "android.permission.BLUETOOTH_SCAN usesPermissionFlags=neverForLocation", "android.permission.CHANGE_NETWORK_STATE",
    "android.permission.CHANGE_WIFI_STATE", "android.permission.NEARBY_WIFI_DEVICES usesPermissionFlags=neverForLocation"
  ],
  "moduleFeatures": ["android.hardware.bluetooth required=false", "android.hardware.bluetooth_le required=false", "android.hardware.wifi.direct required=false"],
  "plugins": [
    "./plugins/withSceneLifecycle",
    "./plugins/withAndroidAppIcons",
    "expo-audio {\"enableBackgroundPlayback\":false,\"microphonePermission\":\"LangQuest records your voice to translate passages.\"}",
    "expo-camera {\"cameraPermission\":\"LangQuest uses the camera to scan invite QR codes.\"}",
    "expo-localization {\"supportedLocales\":[\"en\",\"es\",\"pt-BR\",\"fr\",\"ar\",\"sw\",\"ha\",\"am\",\"hi\",\"bn\",\"ne\",\"id\",\"zh-Hans\",\"th\",\"my\",\"fil\"]}",
    "expo-notifications",
    "expo-secure-store {\"configureAndroidBackup\":true,\"faceIDPermission\":false}",
    "expo-sqlite"
  ],
  "mobileDependencies": [
    "@expo/metro-runtime", "@langquest-next/core", "@langquest-next/sync", "@noble/ciphers", "@noble/curves", "@noble/hashes",
    "@react-native-async-storage/async-storage", "@react-navigation/native",
    "@react-navigation/native-stack", "@supabase/supabase-js", "d3-geo", "expo", "expo-audio",
    "expo-alternate-app-icons", "expo-application", "expo-camera", "expo-crypto", "expo-dev-client", "expo-document-picker", "expo-file-system", "expo-keep-awake", "expo-localization", "expo-network",
    "expo-notifications", "expo-screen-orientation", "expo-secure-store", "expo-sqlite", "expo-status-bar", "expo-updates",
    "html-to-image", "i18n-iso-countries", "i18next", "lucide-react-native", "onnxruntime-web", "react", "react-dom", "react-i18next", "react-native", "react-native-qrcode-svg",
    "react-native-safe-area-context", "react-native-screens", "react-native-svg",
    "react-native-url-polyfill", "react-native-view-shot", "react-native-web", "topojson-client", "world-atlas"
  ],
  "diagnostics": {
    "context": ["appVersion", "channel", "embedded", "installId", "model", "os", "osVersion", "protocolVersion", "reducerVersion", "runtimeVersion", "updateId"],
    "kinds": {
      "audio": ["encodeFail", "interrupted", "maxWaitMs", "micRefused", "playFail", "playNotHere", "plays", "saveFail", "startFail", "stopFail", "streamFail", "takeMs", "takes", "tooShort", "waitMs", "waits", "wavKept"],
      "auth": ["accountLeft", "action", "ageH", "attempt", "code", "eventsLeft", "ms", "op", "outcome", "pending", "sinceOkMs", "status", "uploadsLeft"],
      "checkpoint": ["kb", "ms", "path", "pruned", "seq"],
      "device": ["blobCacheMb", "blobsWanted", "dbMb", "diagDropped", "diagQueued", "freeDiskMb", "journalFailed", "journalPending", "localEvents", "lostFiles", "lostRecordings", "oldestUnsentMin", "streams", "totalDiskMb", "uploadsWaiting", "wantedStuckMin"],
      "error": ["code", "errorId", "fatal", "name", "where"],
      "expected": ["code", "count", "name", "where"],
      "fill": ["event", "headKb", "ms", "msToMap", "passages", "reason", "rows", "why"],
      "nearby": ["adv", "busy", "bye", "clockOff", "code", "cutBackups", "direct", "done", "echoed", "end", "error", "event", "events", "fallbacks", "farAhead", "fileFails", "files", "heard", "hotspot", "keyRefused", "levelMs", "link", "maxUnmatched", "maybe", "ms", "newerApp", "noAnswer", "noRoom", "older", "overBudget", "pipeFails", "refused", "role", "sent", "served", "sessions", "stop", "strangers", "taps", "why"],
      "load": ["checkpoint", "events", "foldMs", "fromSnapshot", "ms", "readMs", "reason", "staleCheckpointSeq"],
      "open": ["cold", "loadMs", "ms", "pulled", "snapshotMs", "syncs"],
      "snapshot": ["bytes", "chunks", "ms", "outcome", "resumedChunks", "seq", "why"],
      "sync": ["applyMs", "code", "error", "more", "ms", "offlineMs", "outcome", "pages", "pending", "phase", "pullNetMs", "pulled", "pushNetMs", "pushed", "rejClockAhead", "rejInvalid", "rejNotAllowed", "rejNotListed", "rejNotMember", "rejOther", "rejected", "requeued"],
      "transfer": ["bytes", "count", "dir", "failAuth", "failBadDigest", "failDisk", "failGone", "failHash", "failHttp4xx", "failHttp5xx", "failNotFound", "failOffline", "failOther", "failTooLarge", "fetchMs", "maxMs", "ms", "signMs", "src", "verifyMs"]
    }
  }
}
```
