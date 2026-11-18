# 66. Request Access lists the organizations that list their work; others are joined by invite

Date: 2026-10-07 · By: Carl Sauder · Status: accepted

Reason: opened from the intent chooser, Request Access asked for an
"organization code", which was the organization's id (`org-` and a UUID).
No screen shows anyone that id, so nobody could give it out or type it, and
the demo has no code: it lists organizations to pick from. The screen now
lists, by name and with their listed languages, the organizations that list
at least one language on Explore (`listed_organizations`,
`20261007160000_listed_organizations.sql`), to signed-in people only, as
asking to join is. An organization that lists nothing is not found there;
the screen says to ask its people for an invite. Listing a language already
made it public with its organization behind it (docs/licensing.md, Access),
so this names no organization that had not chosen to be found. A short
code an admin could share was considered and not built: it needs a new
column, a lookup, and protection against guessing, for organizations that
chose not to be found and can invite instead.
Reverse if: organizations that list nothing need people to find them
without an invite; then give each a short code an admin can share.

Amended (2026-10-13, Carl Sauder): the phone receives the first 500 listed
organizations by name, and searching only that list hid every organization
after them. Typing now also asks the server, which searches every listed
organization by its name or any language it lists
(`listed_organizations_search`). What it finds joins the phone's own
matches. Offline, the saved list is searched as before. The UI test suite
found this (JRN-005) once the local database listed more than 500.

Amended (2026-10-26, Carl Sauder): an organization's name is read from the
table `org_names` (the latest `v1.OrgCreated` or `v1.OrgRenamed` by hlc and
id, kept by a trigger on `events` and filled from the log by migration
`20261026170700_org_names.sql`), not found by sorting its name events for
every organization in a listing. `org_name()`, `listed_organizations`,
`listed_organizations_search` (now by trigram index) and
`global_viewer_organizations` (158) read it; their results are unchanged.
