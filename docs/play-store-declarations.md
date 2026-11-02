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
| Declarations | Developer Program Policies; US export laws (standard HTTPS encryption only) |
| Developer account | The organization account (D-U-N-S) that publishes LangQuest v2; not subject to the 12-tester rule for new personal accounts |
| Track | Internal testing only; every merge to `main` uploads new native builds (decisions.md 45) |
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
| Users interact or exchange content | Yes (recordings, reviews and comments within an organization) |
| Reporting and blocking | In the app: anyone can report a version, review, note, join request or person, and block a person; moderators and LangQuest staff act on reports, and the Terms of Use forbid objectionable content (decisions.md 48) |
| Interactions limited to invited people | Yes: only members an organization's admin invited or approved. Anyone with an account can send an organization a join request with a short message, seen only by its admins |
| Online content not in the download | Yes: source Bible audio, library templates, flows and reference material, and each team's synced work. No AI-generated content, news, film, music or shopping |
| Everything else (drugs, gambling, crude language, purchases, location sharing) | No |

Expected rating: about Teen / 12+ with "Users Interact".

## Data safety

| Question | Answer |
| --- | --- |
| Collects or shares required data types | Yes |
| Encrypted in transit | Yes: Supabase, the app's Cloudflare Worker (reports, decisions.md 44; recordings and guide media, kept in Cloudflare R2, decisions.md 69), Bible text and audio (Bible Brain's CDN, OpenBible) over HTTPS; no cleartext allowed |
| Account creation | Username, password and other authentication: an email and password (someone with a LangQuest v2 account signs in with that account's email and password, which our server checks with LangQuest v2, our own app, once; decisions.md 94); or, for someone joining by invite with no email, the invite itself (a one-time QR code) makes the account, and they get back in with a one-time code from someone who can invite them, or with their sign-in name and a password if they set one (docs/invites-and-accounts.md, decisions.md 59); no OAuth. LangQuest's own Global Viewer accounts (support staff, decisions.md 158) also enter a code from an authenticator app; no user of the app is asked for one, and nothing new is collected from users |
| Account deletion URL | https://next.langquest.org/delete-account |
| Delete some data without deleting the account | No. Account data is deleted with the account; an organization's work belongs to it, and requests about it go to its admins |

Data types. **Shared: No for every type.** Our processors (Supabase,
Expo, Cloudflare) are service providers, not sharing in Play's terms.
Work an organization chooses to list publicly or release under an open
license is the organization's own action. So is connecting another app or an
AI agent with an access token (docs/agent-api.md, decisions.md 72): a person
approves it on the connect page, it reads only what that person can read, and
Play does not count a transfer the user starts and expects as sharing.
Feedback that app sends back is a review in the organization's log, already
collected as other user-generated content. Review links (`/r/<code>`) are a
web page outside the Android app: a person shares one, and whoever answers
on it gives a name, a comment and perhaps a voice note, which reach the app
as reviews (name, messages, voice recordings: types already declared). **Processed ephemerally: No** for
every type.

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
| Device or other IDs | Device or other IDs (random install ID, push token) | Yes | No | Required | App functionality |

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
`<activity-alias>` launcher entries on and the usual one off (labelled
"Calculator" or "Notes" in the phone's language by `./plugins/withDisguiseIcons`,
which also copies the app's link filters onto each). It needs no permission,
and only the person changes it, from inside the app, and can change it back
there (Deceptive Behavior: changes to the home screen with the user's
knowledge and consent, easily reversed). The code is kept on the phone as a
salted hash in the Keystore (`expo-secure-store`, `expo-crypto`), the
notepad's text in app storage; neither is sent. Turning it on disconnects
the phone's notifications through the existing call, since each would say
LangQuest. Nothing new is collected or sent, so no Play Console answer
changes. Apple forbids features that review is not told of (App Review
Guidelines 2.3.1(a) and 2.5.19), so the App Review notes in App Store Connect
say how to turn it on and off before an iPhone build with it goes to review.

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
  "plugins": [
    "./plugins/withDisguiseIcons",
    "./plugins/withSceneLifecycle",
    "expo-alternate-app-icons {\"0\":{\"name\":\"Calculator1\",\"ios\":\"./assets/disguise/calculator1/icon.png\",\"android\":{\"foregroundImage\":\"./assets/disguise/calculator1/adaptive.png\",\"backgroundColor\":\"#202226\"}},\"1\":{\"name\":\"Calculator2\",\"ios\":\"./assets/disguise/calculator2/icon.png\",\"android\":{\"foregroundImage\":\"./assets/disguise/calculator2/adaptive.png\",\"backgroundColor\":\"#DBEAFE\"}},\"2\":{\"name\":\"Calculator3\",\"ios\":\"./assets/disguise/calculator3/icon.png\",\"android\":{\"foregroundImage\":\"./assets/disguise/calculator3/adaptive.png\",\"backgroundColor\":\"#F97316\"}},\"3\":{\"name\":\"Calculator4\",\"ios\":\"./assets/disguise/calculator4/icon.png\",\"android\":{\"foregroundImage\":\"./assets/disguise/calculator4/adaptive.png\",\"backgroundColor\":\"#111111\"}},\"4\":{\"name\":\"Calculator5\",\"ios\":\"./assets/disguise/calculator5/icon.png\",\"android\":{\"foregroundImage\":\"./assets/disguise/calculator5/adaptive.png\",\"backgroundColor\":\"#16A34A\"}},\"5\":{\"name\":\"Notes1\",\"ios\":\"./assets/disguise/notes1/icon.png\",\"android\":{\"foregroundImage\":\"./assets/disguise/notes1/adaptive.png\",\"backgroundColor\":\"#FFFFFF\"}},\"6\":{\"name\":\"Notes2\",\"ios\":\"./assets/disguise/notes2/icon.png\",\"android\":{\"foregroundImage\":\"./assets/disguise/notes2/adaptive.png\",\"backgroundColor\":\"#2563EB\"}},\"7\":{\"name\":\"Notes3\",\"ios\":\"./assets/disguise/notes3/icon.png\",\"android\":{\"foregroundImage\":\"./assets/disguise/notes3/adaptive.png\",\"backgroundColor\":\"#FFFFFF\"}},\"8\":{\"name\":\"Notes4\",\"ios\":\"./assets/disguise/notes4/icon.png\",\"android\":{\"foregroundImage\":\"./assets/disguise/notes4/adaptive.png\",\"backgroundColor\":\"#1E293B\"}},\"9\":{\"name\":\"Notes5\",\"ios\":\"./assets/disguise/notes5/icon.png\",\"android\":{\"foregroundImage\":\"./assets/disguise/notes5/adaptive.png\",\"backgroundColor\":\"#E11D48\"}}}",
    "expo-audio {\"enableBackgroundPlayback\":false,\"microphonePermission\":\"LangQuest records your voice to translate passages.\"}",
    "expo-camera {\"cameraPermission\":\"LangQuest uses the camera to scan invite QR codes.\"}",
    "expo-localization {\"supportedLocales\":[\"en\",\"es\",\"pt-BR\",\"fr\",\"ar\",\"sw\",\"ha\",\"am\",\"hi\",\"bn\",\"ne\",\"id\",\"zh-Hans\",\"th\",\"my\"]}",
    "expo-notifications",
    "expo-secure-store {\"configureAndroidBackup\":true,\"faceIDPermission\":false}",
    "expo-sqlite"
  ],
  "mobileDependencies": [
    "@expo/metro-runtime", "@langquest-next/core", "@langquest-next/sync", "@noble/ciphers", "@noble/hashes",
    "@react-native-async-storage/async-storage", "@react-navigation/native",
    "@react-navigation/native-stack", "@supabase/supabase-js", "d3-geo", "expo", "expo-audio",
    "expo-alternate-app-icons", "expo-application", "expo-camera", "expo-crypto", "expo-dev-client", "expo-file-system", "expo-keep-awake", "expo-localization", "expo-network",
    "expo-notifications", "expo-screen-orientation", "expo-secure-store", "expo-sqlite", "expo-status-bar", "expo-updates",
    "html-to-image", "i18n-iso-countries", "i18next", "lucide-react-native", "onnxruntime-web", "react", "react-dom", "react-i18next", "react-native", "react-native-qrcode-svg",
    "react-native-safe-area-context", "react-native-screens", "react-native-svg",
    "react-native-url-polyfill", "react-native-view-shot", "react-native-web", "topojson-client", "world-atlas"
  ],
  "diagnostics": {
    "context": ["appVersion", "channel", "embedded", "installId", "model", "os", "osVersion", "protocolVersion", "reducerVersion", "runtimeVersion", "updateId"],
    "kinds": {
      "audio": ["encodeFail", "interrupted", "micRefused", "playFail", "playNotHere", "plays", "saveFail", "startFail", "stopFail", "streamFail", "takeMs", "takes", "tooShort", "wavKept"],
      "auth": ["accountLeft", "action", "ageH", "attempt", "code", "eventsLeft", "ms", "op", "outcome", "pending", "sinceOkMs", "status", "uploadsLeft"],
      "checkpoint": ["kb", "ms", "path", "pruned", "seq"],
      "device": ["blobCacheMb", "blobsWanted", "dbMb", "diagDropped", "diagQueued", "freeDiskMb", "journalFailed", "journalPending", "localEvents", "lostFiles", "lostRecordings", "oldestUnsentMin", "streams", "totalDiskMb", "uploadsWaiting", "wantedStuckMin"],
      "error": ["code", "errorId", "fatal", "name", "where"],
      "expected": ["code", "count", "name", "where"],
      "fill": ["event", "headKb", "ms", "msToMap", "passages", "reason", "rows", "why"],
      "load": ["checkpoint", "events", "foldMs", "fromSnapshot", "ms", "readMs", "reason", "staleCheckpointSeq"],
      "open": ["cold", "loadMs", "ms", "pulled", "snapshotMs", "syncs"],
      "snapshot": ["bytes", "chunks", "ms", "outcome", "resumedChunks", "seq", "why"],
      "sync": ["applyMs", "code", "error", "more", "ms", "offlineMs", "outcome", "pages", "pending", "phase", "pullNetMs", "pulled", "pushNetMs", "pushed", "rejClockAhead", "rejInvalid", "rejNotAllowed", "rejNotListed", "rejNotMember", "rejOther", "rejected", "requeued"],
      "transfer": ["bytes", "count", "dir", "failAuth", "failBadDigest", "failDisk", "failGone", "failHash", "failHttp4xx", "failHttp5xx", "failNotFound", "failOffline", "failOther", "failTooLarge", "fetchMs", "maxMs", "ms", "signMs", "src", "verifyMs"]
    }
  }
}
```
