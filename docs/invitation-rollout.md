# Invitation and account flow rollout

Status on 2026-09-17: hosted migrations and mobile RPC contracts verified.
Cloudflare Email Sending is enabled and the invitation email Worker is
deployed. The hosted Supabase `send-invite` endpoint is deployed and its
relay URL and credential are configured and verified against Cloudflare.
Notification worker deployment and physical-device acceptance remain pending.

## Confirmed problem

The hosted `issue_invite` expects email and TTL arguments. The app supplies
an invitation ID, token hash, scope, and expiry. Hosted migration history
matches the earlier files, but the actual API differs. The hosted database
also lacks the app's join-request RPCs. Migration history alone cannot
detect this; `npm run db:check` now checks live function signatures.

The role picker also appeared on both invitation screens. It now appears
only before the QR screen. The QR screen confirms the chosen role.

## Deployment sequence

1. Review and apply these forward migrations to the linked hosted project:
   - `20260917125750_invitation_contract_repair.sql`
   - `20260917130211_account_discovery_notifications.sql`
   The repair preserves the legacy invitation overload. The new app uses
   `redeem_invite_v2`, leaving the old return shape available to old clients.
2. Run `npm run db:check`. Every required API contract must exist.
3. Run `npm run worker:build` and commit the bundle. Merging to `main` deploys `project-projections` and `send-invite` (Supabase's GitHub integration, `server/README.md`).
   Both validate authorization inside their handlers. Their function config
   disables the gateway's legacy JWT verification.
4. Set a random `PROJECTION_WORKER_SECRET` in the root `.env.<environment>`
   (`npm run env:update -- <environment> PROJECTION_WORKER_SECRET "$(openssl rand -hex 32)"`).
5. Run `npm run secrets -- <environment>`. It sets that secret as an
   Edge Function secret and in Vault as `langquest_projection_worker_secret`,
   stores the project URL in Vault as `langquest_project_url`, and runs
   `server/schedule-projections.sql` (one job every five minutes; `pg_cron`
   and `pg_net` come from a migration). Avoid overlapping manual projection
   runs. Check function logs and `net._http_response` after the first
   scheduled request.
6. Merging an `apps/invite-email` change to `main` deploys the Cloudflare email Worker (Workers Builds, `docs/cloudflare.md`). `npm run email:deploy` still deploys it by hand.
   Its configuration restricts sending to `invites@frontierrnd.com`.
   Set a random `INVITE_RELAY_SECRET` in the root `.env.<environment>` and
   run `npm run secrets -- <environment>`, which gives the same value to the
   Worker and to `send-invite`, with `INVITE_RELAY_URL` pointing at the
   Worker's `/send-invite` endpoint (`docs/environments.md`). No email credentials
   belong in the mobile build. Resend is no longer used.
7. Build a new native app with the Expo notifications plugin and configured
   push credentials. A JavaScript update alone cannot add the native module.

The user applied the database migrations and explicitly approved the hosted
email connection. `INVITE_RELAY_URL` and `INVITE_RELAY_SECRET` are set on
project `xymxnebdwtbkfxlbylch`, and `send-invite` is deployed. Both hosted
value digests match the Cloudflare configuration. Temporary credential files
are removed after verification.

## Cloudflare email deployment

- Sender: `LangQuest <invites@frontierrnd.com>`.
- Worker: `langquest-invite-email` in the Frontier R&D account.
- Endpoint: `https://langquest-invite-email.blue-darkness-7674.workers.dev/send-invite`.
- Wrangler profile for a deploy from a laptop: `langquest-email`. Workers Builds uses its own token and does not use the profile.
- Sending DNS: Cloudflare manages `cf-bounce.frontierrnd.com` and DKIM.
  Public DNS resolves these records. Existing Google inbound MX and DMARC
  policy remain intact. No incoming routing rule or catch-all was changed.
- Run `npm run email:typecheck` before deployment. Generated runtime types
  and local secrets are ignored by Git.
- Delivery receipts store a hash of the request and provider message ID.
  Receipts expire one day after the invitation expiry. Pending or uncertain
  sends are not automatically repeated; the user can share the same QR/link.
- Local runtime checks cover authorization, input size, concurrent requests,
  repeated delivery, and recipient binding using simulated email only.
  Live checks confirm the Supabase authentication gate, CORS preflight,
  and Cloudflare relay authentication without sending a message.
  A real recipient delivery check remains pending.

## Validation completed

- Core, client, and mobile TypeScript checks.
- Vitest coverage for invitation parsing, durable outbox restart/isolation,
  inbox eligibility, screen contracts, and model walks across reconnects.
- Account SQL smoke tests on local text IDs and an isolated schema clone
  with UUID invitation/request IDs, matching the hosted column types.
- SQL comparisons for 240 screen/role/event authorization cases.
- Notification cursor stability, removal delivery, account privacy, and
  exclusive push claims in the account smoke test.

## Device acceptance

1. Select a role once, create a QR, share the link, and join using another
   account. Retry redemption after a lost response. Verify the resulting
   organization and role, including project work visible to the invitee.
2. Scan with camera permission accepted and denied. Test a pasted code,
   malformed link, expired invite, and a link opened before sign-in.
3. Request access offline, restart, reconnect, accept it as an administrator,
   and verify that the retry does not create another request or membership.
4. Rename your profile offline and reconnect. Sign into a second device and
   verify completed onboarding persists without crossing account boundaries.
5. List a project publicly, verify its limited summary, then unlist it.
6. Submit work and review it from another account. Verify inbox changes,
   notification permission, delivery, tapping into inbox, and token removal
   when signing out. Validate email with an explicitly approved recipient.

## Remaining audit work

Profile photos, organization dashboard summaries, key terms as content,
and remaining audio capture surfaces remain separate work. Lane-only
memberships are not broadened into project-wide task grants. Full UI
automation and device acceptance remain necessary alongside model tests.
