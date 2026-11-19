# 173. An organization gets a blue check after its name when an admin proves an email address at its website and LangQuest staff grant it

Date: 2026-10-26 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-26) wants publishers such as unfoldingWord and Word
Collective (which owns FIA) to host their own material in organizations of
their own, and people to be able to tell the real organization from a
look-alike, wherever its name shows. He chose that blue checks are granted
by request: the organization gives its domain, and the request comes from an
admin whose email address is at that domain and confirmed, with a
confirmation of its own since LangQuest confirms no email otherwise
(docs/invites-and-accounts.md). Built (docs/verified-organizations.md):
- **Asking.** An admin (manage_roles at the organization's level) names the
  domain and an address at it or under it; free email services are refused
  (the same list in SQL and in `apps/mobile/src/verified/model.ts`). The Edge
  Function `verify-org-email` has the database make a 6-digit code
  (`org_verification_begin`, service role only, so no client holds a code it
  was not emailed) and sends it through the invite-email Worker's
  `/send-code`, in the admin's language. A code lives 30 minutes, five wrong
  tries spend it, and an organization gets a code a minute, five a request
  and ten a day.
- **Staff decide.** A confirmed request waits for LangQuest staff, who open
  the website and check it is this organization, then grant or decline on
  the ops dashboard (162, amended) or with `npm run org-verification`. The
  dashboard shows the address only as its domain (decision 39); the script
  shows it whole. Revoking is the script's alone.
- **Showing.** Any signed-in person may ask which organizations are verified
  (`org_badges`); the phone keeps the answers (asked again after ten minutes)
  and draws one blue seal after the name: My Work, the Manage card (whose
  "Verified · domain" line opens what the check means), Switch Organization,
  Find your organization, the card after scanning an invite, New language's
  review flows and reference material, and the content templates library.
  The seal is not a button of its own. Its sheet says that the check shows
  who is sharing, not that LangQuest reviewed what they share.
- Nothing is written to any organization's log: whether it is verified is
  the server's own state, like a Global Viewer grant (158).
Not yet: the import tools for publishers' own material, and the seal in the
remaining library screens (Reference material and Review flows in Setup,
Get ready's helps).
Reverse if: requests come faster than staff can check them (then a DNS
record could prove the domain, or a confirmed address could grant at once,
in `org_verification_confirm`), or people read the check as LangQuest
vouching for an organization's material.

Amended (2026-10-27, Caleb Koster): staff keep looking at every request
before granting it. Caleb chose this over granting once the email is
confirmed: "one look at each request stops look-alikes, such as someone with
a university email claiming that university." The Manage card loses its
"Ask for a blue check" and "Verified · domain" lines, which Caleb found
cluttered: the check after the name is the button, grey for an admin until
it is granted (it opens the request), blue for every member once it is (it
opens what it means). The long explanation is one sentence in the style of
other sites' notes on their checks: "A blue check means the LangQuest team
has verified this organization. It is not an approval or endorsement of what
the organization publishes."
