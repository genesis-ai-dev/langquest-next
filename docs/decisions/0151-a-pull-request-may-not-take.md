# 151. A pull request may not take away a server call that a supported store build makes

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: people keep a store build for a long time, and the server and the
app's Worker change on every merge into main (decisions 42, 43), days before
a new build passes store review. Android build 24, built by hand on
2026-10-20 from code of 2026-10-01, called `issue_invite`, which the server
had not had since 2026-10-06. `npm run server-calls` (`scripts/server-calls.mjs`)
now runs in the guardrails `checks` job and in `npm run guardrails`. It reads
the server calls that phones may make: the database functions
(`.rpc('name')`), tables and views (`.from('name')`), Edge Functions
(`functions.invoke('name')`) and the Worker's routes (`/api/<name>`) named in
`apps/mobile/src` and `packages/sync/src`, in each supported store build's
own commit and on every line added on main since the oldest of them. Every
merge into main that changes the app reaches phones as an OTA update or a new
build, so a call named on main since then is a call that some phone may
make. It then checks that each call is still on the server after the pull
request: the migrations, read in order, still create the function, table or
view and do not drop or rename it; the Edge Function's folder is still in
`supabase/functions`; and `apps/web/worker` still names the route. A failure
names the build and the call, for example "Build 25 (Android) still uses the
database function preview_invite". It reads files and git history only, and
takes about 3 seconds for 21 builds. To change a call, add a new one next to
it (a new function name, such as `issue_sign_in_code_v2`) and leave the old
one in place for as long as a supported build uses it. An old call may be
removed once every build that uses it is below the minimum app version,
which the pipeline raises every three weeks to the newest build that has
been public on both stores for at least three weeks (the release pipeline's
"Please update the app" change); a phone below the minimum stops syncing,
so it no longer makes the call.

The store builds and their commits come from EAS, which records the commit of
every build, when the repository secret `EXPO_TOKEN` is set (a token for a
robot user with the Viewer role). Until then they come from
`apps/mobile/store-builds.json`, which lists every finished production build
as EAS had it on 2026-10-22. That file also says which builds are supported:
Android from build 13 and iPhone from build 33, without Android build 24 and
iPhone build 41. The older builds and those two hand builds already fail
against today's server, and newer builds replaced all of them: Android 8
and iPhone 29 and older call functions or tables that the server no longer
has (`issue_invite`, `redeem_invite`, `accept_join_request`,
`org_member_emails`, `set_project_visibility`, `project_visibility` and
`public_projects`), and the sync test of Android 9 to 12 and iPhone 30 to 32
(built 2026-10-06 and 07) finds that today's server refuses their
`v1.MemberAdded` and their recording uploads to Supabase Storage, which
moved to the Worker afterwards. The minimum app version will take the
place of these two numbers.

The check does not see a changed argument, column or response shape; the sync
test from each store build's commit (change 4) runs against the new database
for that. Two more things follow from the gap between the server and phones
on an older build. The server must keep accepting what those phones send, so
validation for an event that a supported build sends never becomes stricter;
a new event version is added instead. And a phone on an older build skips an
event type that its reducer does not know, so it keeps working but cannot
show that work until it gets the reducer change, by a new build or an OTA
update.
Reverse if: the check stops a change often enough that keeping old calls
costs more than asking people to update (then raise the minimum app version
sooner), or a call that phones make is missed because it is built at run
time (then name it in a list that the check reads).

Amended (2026-11-05, Caleb Koster): a release branch (decision 155) deploys
no server, so on a release branch, or on a copy onto one, the check reads
main's server (from git) instead of the branch's own, and also checks the
calls in the branch's own code. The first iPhone catch-up (PR 344) failed
because the release branch's server, from 2026-10-28, did not have the
password-reset Edge Function or the /api/source-audio route that main's
OTA updates use. Each copy takes this check from main (decision 155's
`MACHINERY`).
