# Translation, audio, and account tools

Optional written work now sits beside the oral translation workflow. Formal
review remains the approval mechanism. Public project browsing is removed;
people join through invitations and QR codes. Language catalog expansion
remains deferred.

## Written translation and AI assistance

The neutral text button on standard and OBT passage screens opens written
translation as a slide run, like the reference and key-term runs: source text,
then the draft, then saved versions. Each slide has one yellow action (next,
save, done); transcription, AI drafts, branching and starting over are outline
icon buttons. A suggestion replaces the slide until it is used or discarded.
It opens on saved versions when some exist. Saving creates an immutable version. Choosing an earlier version
creates a child, preserving the original and its source text. These drafts
supplement recorded takes; they do not independently mark a passage approved.

Source recordings and attached reference audio can request transcription after
upload confirmation. The user reviews the result before using it as source
text or a draft. An AI draft request requires source text and the lane's target
language. Suggestions never save themselves or enter formal review automatically.
The isolated back translation workspace cannot use source assistance.

`translation-assist` authenticates each request, checks project translation
permission and lane existence, and retrieves audio using the caller's storage
permissions. It accepts no arbitrary audio URL. Audio is capped at 24 MB,
source/output text at 50,000 characters, and requests at 30 per actor per hour.
Incomplete provider responses are rejected. Written work remains usable offline;
AI assistance requires connectivity and provider configuration.

The server uses `OPENAI_API_KEY`. Optional `OPENAI_DRAFT_MODEL` and
`OPENAI_TRANSCRIPTION_MODEL` override the defaults `gpt-4.1-mini` and
`gpt-4o-mini-transcribe`. Secrets belong in Edge Function configuration, never
`EXPO_PUBLIC_*`. Live provider calls are not part of the automated checks.

## Recording editing and delivery

Long press or the ellipsis opens an advanced view on recognized recording cards.
Authorized passage recording controls open the editor; other cards show
recording details and sharing. The editor supports trimming, insertion,
replacement, new recorded parts, ordering, merge, bulk deletion, rename,
undo/redo, and verse milestones or ranges. Audio changes clear verse offsets,
so add milestones after arranging the audio.

Saving renders a new WAV recording and composes a child take. The original
recordings remain in the event log. Metadata belongs to the new take and
includes its display name and verse offsets. Existing submitted takes keep
their review history. Verse controls play the saved bounded ranges.

Share exports a real mono WAV and opens the native share sheet. Book status
assembles approved descendant passages in their existing order. Unapproved
passages are omitted. All included audio must be downloaded first. Shared
Android files remain cached for recipient access and expire through opportunistic
cleanup after 24 hours.

## Accounts and device privacy

Sign-in provides password recovery. Recovery links use
`langquestnext://auth/recovery`; cold and warm app launches handle recovery.
Password changes support Supabase's reauthentication challenge. Hosted Auth
must allow that redirect and have a working email delivery configuration.
The existing Cloudflare invitation-email service does not automatically replace
Supabase Auth's recovery-email transport.

Deletion requires password confirmation and guards pending local work. The
server suspends access immediately, revokes refresh sessions, and allows restore
for 30 days. Daily `pg_cron` erasure removes personal account records and Auth
identity. Shared organization contributions remain attributed to the opaque
actor ID. Storage ownership is detached so shared recordings survive erasure.
A tombstone keeps previously issued JWTs blocked. Restore requires a fresh
sign-in after restoring access.

Appearance supports system, light, and dark themes. UI language preferences
cover common navigation and account labels in English, Spanish, and French.
Untranslated long-form copy falls back to English; project content is unchanged.

The device PIN uses OS-protected SecureStore, a salted verifier, and persisted
retry delays. It locks on background and hides audio, FIA, and text dialogs.
Forgotten PINs can be removed by signing in online as the account that set them.
This gate does not encrypt the existing project database or audio files.

Disguise switches the launcher icon to a neutral Notes icon. Android also
changes the launcher label. iPhone retains the application name and uses its
alternate-icon behavior. This does not conceal the app from system settings.

## FIA

See [FIA guided study](fia-guided-study.md). Managers can select existing FIA
pericopes, install six-stage templates, and supply authorized study text/audio.
The app supplies workflow templates, not licensed FIA lesson content. Personal
progress stays writable independently of locked guidance. The server prevents
participants from altering another participant's progress.

## Release steps

1. Build Android and iOS binaries with the new local audio/privacy modules,
   SecureStore, Sharing, and the privacy icon config plugin. An OTA-only update
   cannot add these native capabilities.
2. Apply pending migrations in timestamp order. Account erasure requires
   `pg_cron`. Deploy new event validators before enabling their UI. Older
   clients keep syncing; never require an upgrade for append/pull. See AGENTS.md.
3. Rebuild/deploy the projection worker and deploy `translation-assist` with the
   server-only provider key. The generated worker is rebuilt in this change.
4. Add the recovery redirect to hosted Supabase Auth and confirm recovery email
   delivery. Local `supabase/config.toml` already includes the redirect.
5. Verify microphone permissions, recovery links, launcher icons, PIN overlays,
   share recipients, and audio playback on physical iPhone and Android devices.

## Verification

- Core/client and mobile TypeScript checks pass.
- The complete Vitest suite passes, including written versions, FIA scope,
  audio edit history, milestones, and recovery URL parsing.
- `server/translationToolsSmoke.sql` tests append authorization, immutable
  versions, locked FIA guidance, personal progress, and the provider quota.
- `server/accountPrivacySmoke.sql` tests suspension, restoration, expiry,
  permanent erasure, and preservation of shared storage objects.
- SQL checks run with all pending migrations inside rollback-only transactions;
  they do not deploy changes or reset the existing local database.
- `scripts/check-native-audio.sh` exercises real WAV/AAC rendering on macOS.
  The Android renderer compiles against Android SDK 36. Physical device checks
  remain necessary; no Android device was connected during implementation.

The privacy icon plugin also passes isolated Android and iOS prebuild checks,
including launcher/deep-link coexistence and iPhone/iPad alternate-icon resources.
A full Android native build still needs NDK `27.0.12077973`, which is unavailable
in the current protected SDK installation. JavaScript bundle exports succeed
for both platforms; they do not replace physical-device verification.
