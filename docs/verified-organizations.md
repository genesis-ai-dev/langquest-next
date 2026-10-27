# Verified organizations

A blue check after an organization's name tells people it is the real
organization: that an admin of it proved they have an email address at its
website, and LangQuest staff checked the website is theirs (decisions.md
172). It says who is sharing material, not that LangQuest reviewed it.

## Asking for one

An admin (an Organization Admin: `manage_roles` at the organization's own
level) opens Manage and taps **Ask for a blue check** under the
organization's name. The sheet asks for:

- the organization's website, which is turned into a domain
  (`https://www.unfoldingword.org/about` becomes `unfoldingword.org`);
- an email address at that domain or under it (`ana@unfoldingword.org`,
  `ana@mail.unfoldingword.org`). The admin's own sign-in address is
  suggested when it is at the domain.

Free email services (Gmail, Outlook, Yahoo, iCloud and the rest; the list is
in the migration and in `apps/mobile/src/verified/model.ts`, which a test
holds together) and looked-after accounts' `people.langquest.org` are
refused.

**Email me a code** calls the Edge Function `verify-org-email`. The function
checks the person's sign-in, asks the database for a code
(`org_verification_begin`, which only the service role may call, so a code
never reaches a phone except by email), and posts it to the invite-email
Worker's `/send-code`, which sends it from the invite address in the admin's
app language. The admin types the six digits; `org_verification_confirm`
checks them, and the request then waits for staff.

Limits: a code works for 30 minutes; five wrong tries spend it; an
organization gets one code a minute, five per request and ten a day; one open
request at a time. **Take back the request** withdraws it.

## Deciding

Staff open the ops dashboard's Support section, **Blue check requests**
(decisions.md 162, amended). Each row has the organization, its website (a
link to open) and when it asked. Before granting, open the website: is it
this organization? The dashboard shows the confirmed address only as its
domain (decision 39). To see the whole address and who asked:

```sh
npm run org-verification -- list waiting --hosted
npm run org-verification -- grant <request id> --hosted    # or decline
npm run org-verification -- revoke <organization id> --hosted
```

Every grant or decline from the dashboard is recorded in `ops.actions`; the
script puts your `git config user.name` on it.

## Where the check shows

Any signed-in person may ask which organizations are verified
(`org_badges`). The app asks for the organizations whose names it shows,
keeps the answers on the phone so they show offline, and asks again after ten
minutes (`apps/mobile/src/verified/orgBadges.ts`). The seal
(`VerifiedSeal.tsx`: `OrgName`, `OrgLine`, `OrgSeal`) goes after the name in:

- My Work's header;
- the Manage card, where **Verified · domain** opens what the check means;
- Me → Switch Organization;
- Find your organization;
- the card after scanning an invite;
- New language's review flows and reference material;
- the content templates library ("Following X", "From X").

## Server

`supabase/migrations/20261027000000_verified_organizations.sql`:
`org_verification_requests` and `org_verifications`, both service-role only;
nothing is written to any organization's event log. Held by
`server/orgVerificationSmoke.sql`.

## Trying it locally

The invite-email Worker sends through Cloudflare's email binding, which
`wrangler dev` imitates: it prints each message and writes its text and HTML
under `apps/invite-email/.wrangler/tmp/email/`. Run it on a port the Edge
Functions can reach (`--ip 0.0.0.0`), and give the functions
`INVITE_RELAY_URL=http://host.docker.internal:<port>/send-invite` and the
same `INVITE_RELAY_SECRET` as the Worker's `.dev.vars`, in
`supabase/functions/.env` (git ignores both); restart the stack so the
functions read them.
