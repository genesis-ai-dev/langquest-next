# 76. Names identify nothing: a repeated language is warned about, and an organization can be renamed

Date: 2026-10-09 · By: Carl Sauder · Status: accepted

Reason: organizations and languages are identified by ids made on the
phone (`org-<uuid>` in `createOrg.ts`, `L-<code>-<random>` in
`newLanguageId`), so they can be created offline without asking anyone,
and nothing on the phone or the server refuses a name already in use. Two
people offline can start two organizations with one name, and two admins
can add one language twice to the same organization; each stands, since
no server check on names can reach a phone that is offline. Names stay
labels, and two answers are added instead of a uniqueness rule. Adding a
language warns when the organization already lists one with the same code,
or the same name once case, accents, spaces and punctuation are set aside
(`similarLanguages` in `orgAdmin.ts`, shown on the first step of New
language). It only warns: the admin may still go on. It sees the
languages this phone has synced, so a repeat added on another phone while
both were offline still lands. An organization can be renamed with
`v1.OrgRenamed { name }`, which writes the same name register as
`v1.OrgCreated`, as `MemberAdded` and `MemberRemoved` share `removed`: the
later clock wins, then the higher id. A rename is always stamped after the
creation its phone saw. Only an Organization Admin may rename
(`manage_roles`, as for the license), since the name is how everyone,
Request Access included, tells the organization apart. Every server
reader of the name reads that register (`org_name`, `library_shared_items`,
`diag.find`; migration `20261009160000_org_renamed.sql`). A library
subscription keeps the source's name as it was when subscribed
(`sourceOrgName`). A language is renamed from its page (More, Name)
with the `v1.LanguageRenamed` it always had, by whoever manages its
structure there or for the whole organization (`mayRenameLanguage`), so a
language admin may rename their own; the sheet warns when another
language already has the name. Not built: a way to merge or retire a repeated
language, a check after sync for repeats that landed offline, and a way
to tell same-named organizations apart in Request Access beyond their
listed languages.
Reverse if: repeated languages keep landing despite the warning; then
check for repeats after sync and give admins a way to retire one.
