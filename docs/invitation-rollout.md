# Invitation and account flow rollout

Status: implemented and validated locally on 2026-09-17. Hosted deployment
and physical-device acceptance remain pending.

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
3. Run `npm run worker:build`. Deploy `project-projections` and `send-invite`.
   Both validate authorization inside their handlers. Their function config
   disables the gateway's legacy JWT verification.
4. Set a random `PROJECTION_WORKER_SECRET` as an Edge Function secret.
   Store the same value in Vault as `langquest_projection_worker_secret`.
   Store the hosted project URL in Vault as `langquest_project_url`.
5. Enable `pg_cron` and `pg_net`, then run
   `server/schedule-projections.sql`. This installs one job every five minutes.
   Avoid overlapping manual projection runs. Check function logs and
   `net._http_response` after the first scheduled request.
6. Configure `INVITE_RESEND_API_KEY` and `INVITE_EMAIL_FROM` after selecting
   a verified sender. No email credentials belong in the mobile build.
7. Build a new native app with the Expo notifications plugin and configured
   push credentials. A JavaScript update alone cannot add the native module.

Automatic approval review rejected a hosted migration preflight because it
runs live database definitions, grants, and test writes. No hosted changes
were made by this task. Obtain explicit hosted deployment approval first.

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
