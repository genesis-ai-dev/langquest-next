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
| Privacy policy | https://langquest.org/en/next/privacy (langquest-website repository, `src/app/[locale]/next/privacy`) |
| Account deletion | https://langquest.org/en/next/delete-account; in the app: Settings → Advanced → Delete account (decisions.md 46) |

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
| Encrypted in transit | Yes: Supabase and source audio over HTTPS; no cleartext allowed |
| Account creation | Username and password: an email and password, or, for someone joining by invite with no email, a sign-in name and password (docs/invites-and-accounts.md); no OAuth, no other authentication |
| Account deletion URL | https://langquest.org/en/next/delete-account |
| Delete some data without deleting the account | No. Account data is deleted with the account; an organization's work belongs to it, and requests about it go to its admins |

Data types. **Shared: No for every type.** Our processors (Supabase,
Expo, Cloudflare, Vercel) are service providers, not sharing in Play's terms.
Work an organization chooses to list publicly or release under an open
license is the organization's own action. **Processed ephemerally: No** for
every type.

| Category | Data type | Collected | Shared | Required or optional | Purposes |
| --- | --- | --- | --- | --- | --- |
| Personal info | Email address | Yes | No | Optional (someone joining by invite may have none) | App functionality, Account management |
| Personal info | User IDs (the sign-in name of an account made by invite) | Yes | No | Optional | App functionality, Account management |
| Personal info | Name | Yes | No | Required | App functionality, Account management |
| Personal info | Phone number (a guest reviewer's contact, typed in by a user) | Yes | No | Optional | App functionality |
| Messages | Other in-app messages (review comments, join request messages) | Yes | No | Optional | App functionality |
| Audio | Voice or sound recordings | Yes | No | Required | App functionality |
| App activity | Other user-generated content (reviews, notes, answers, reports of content or people, blocked people) | Yes | No | Required | App functionality |
| App info and performance | Crash logs | Yes | No | Optional (Settings switch) | App functionality, Analytics |
| App info and performance | Diagnostics | Yes | No | Optional (Settings switch) | App functionality, Analytics |
| Device or other IDs | Device or other IDs (random install ID, push token) | Yes | No | Required | App functionality |

Not collected: location, financial info, health, photos and videos, files,
calendar, contacts, web browsing, app interactions beyond diagnostics, other
personal info.

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
    "expo-audio {\"enableBackgroundPlayback\":false,\"microphonePermission\":\"LangQuest records your voice to translate passages.\"}",
    "expo-camera {\"cameraPermission\":\"LangQuest uses the camera to scan invite and project QR codes.\"}",
    "expo-notifications",
    "expo-sqlite"
  ],
  "mobileDependencies": [
    "@expo/metro-runtime", "@langquest-next/client", "@langquest-next/core",
    "@react-native-async-storage/async-storage", "@react-navigation/native",
    "@react-navigation/native-stack", "@supabase/supabase-js", "expo", "expo-audio",
    "expo-camera", "expo-crypto", "expo-dev-client", "expo-file-system",
    "expo-notifications", "expo-screen-orientation", "expo-sqlite", "expo-status-bar", "expo-updates",
    "lucide-react-native", "react", "react-dom", "react-native", "react-native-qrcode-svg",
    "react-native-safe-area-context", "react-native-screens", "react-native-svg",
    "react-native-url-polyfill", "react-native-web"
  ],
  "diagnostics": {
    "context": ["appVersion", "channel", "embedded", "installId", "model", "os", "osVersion", "protocolVersion", "reducerVersion", "runtimeVersion", "updateId"],
    "kinds": {
      "device": ["blobCacheMb", "blobsWanted", "freeDiskMb", "totalDiskMb"],
      "error": ["errorId", "fatal", "name", "where"],
      "load": ["events", "fromSnapshot", "ms"],
      "snapshot": ["bytes", "chunks", "ms", "outcome", "resumedChunks", "seq"],
      "sync": ["applyMs", "error", "ms", "offlineMs", "outcome", "pages", "pending", "pulled", "pullNetMs", "pushed", "pushNetMs", "rejected"],
      "transfer": ["bytes", "count", "dir", "failDisk", "failHash", "failHttp4xx", "failHttp5xx", "failOffline", "failOther", "fetchMs", "maxMs", "ms", "signMs", "verifyMs"]
    }
  }
}
```
