# Licensing: who may use an organization's work

Every organization chooses a license for the work its members make. The
license says what people outside the organization may do with that work, and
so it decides what they can see in the app. It starts fully closed and can
only open up. Decision 38 in `docs/decisions.md` says why.

## The ladder

Most closed first. Each rung allows everything the one below it does, and more
(`packages/core/test/license.test.ts` holds that).

| License | In a few words | Outsiders may look inside | Adapt | Sell | Share-alike | Credit |
| --- | --- | --- | --- | --- | --- | --- |
| All rights reserved | Only your organization | no | no | no | – | – |
| CC BY-NC-ND 4.0 | Share unchanged, not for sale | yes | no | no | – | yes |
| CC BY-NC-SA 4.0 | Share and adapt, not for sale | yes | yes | no | yes | yes |
| CC BY-SA 4.0 | Share and adapt, same terms | yes | yes | yes | yes | yes |
| CC BY 4.0 | Any use, with credit | yes | yes | yes | no | yes |
| CC0 1.0 | No conditions | yes | yes | yes | no | no |

The ladder leaves out CC BY-ND and CC BY-NC. Each is neither more nor less
open than a rung next to it (BY-ND allows selling but not adapting; BY-NC-SA
allows adapting but not selling), and "only more open" needs one order.

The app shows each license by name, a few words and one plain sentence
(`LICENSE_INFO` in `packages/core/src/license.ts`), with the license text a
tap away. Features never test a license id; they ask its terms
(`LICENSE_INFO[l].terms.outsidersMayView`, `mayAdapt`, `shareAlike` and so on).

## Only more open

Once work has gone out under open terms, anyone who took a copy keeps those
terms, so letting an organization close it again would promise something the
app cannot keep. The rule is in three places:

- **The fold.** `v1.LicenseSet {license}` lives in the organization stream, and
  `applyOrgEvent` keeps the most open license ever set, with the earliest
  event that set it (a ratchet: max over the ladder). Two admins opening it
  offline both land on the more open of their choices, in any order, and a
  late, more closed choice changes nothing. The server accepts such an event
  rather than refusing it, because it cannot know what a phone saw offline
  and the event changes nothing anyway.
- **The screens.** Organization Home offers only the current license and
  those above it, shows the others locked, and asks again before opening
  ("This can't be undone").
- **Who.** Only someone with Manage Roles at organization scope (by default,
  Organization Admin) may set it: `EVENT_PRIVILEGE`, SQL `event_privilege`,
  `mayChangeLicense`. A language admin cannot open the whole organization.

An organization with no license event is all rights reserved (`orgLicense`),
so every organization from before this stays closed and nothing becomes
visible to outsiders by upgrading.

## Choosing it

- **Create Organization** has a "Who may use your work" row, set to All
  rights reserved. The creator may pick any license; `createOrganization`
  records the choice (even the default) after the creator's own membership,
  since the server lets only an Organization Admin set it.
- **Organization Home** shows the license to every member, since it is their
  recordings. An Organization Admin can open it further; everyone else sees
  the explanations and "Only an organization admin can change this."
- Whenever a license lets outsiders look inside, the sheet warns that anyone
  will be able to hear the team's voices. Some translators are at real risk if
  they are identified (the demo's "Visibility" open tension; the ETEN meeting
  notes). Keeping the organization closed is the answer for them today.
- **Explore** listings carry the license of the organization behind them
  (`public_languages.license`, written by the projection worker).

## What the license covers

The license is about the **work**: what the organization publishes as its
translation.

- **The work:** the passages (structure and names) and the version each passage
  currently has, once it has been submitted (never a draft or an archived
  take); reference material, key terms and study notes the organization
  writes for its languages; library items it publishes.
- **Never the record:** reviews, feedback, voice notes, requests, departures,
  notes on the record, who did what, member lists and names. These are about
  people, not the translation, and stay inside the organization whatever the
  license. Opening the license must never publish a person.

Library items already have their own per-item sharing (decision 36). Until
the open question below is settled, that stays as it is and the license
does not change it.

## Access: what outsiders can see

| License | Members | Outsiders |
| --- | --- | --- |
| All rights reserved | everything, by role (unchanged) | the Explore listing (name, languages, progress) if a language is listed, nothing else |
| Any Creative Commons rung | everything, by role (unchanged) | the work, read-only, for every language; listed languages also appear on Explore |

Listing and licensing are separate. **Listing** (per language, reversible,
`set_language_visibility`) is about being found on Explore. **The license**
(per organization, one way) is about what people may do with the work. An
open organization's unlisted language is not on Explore, but someone with a
link may still look inside it.

`pull_events` stays members only, whatever the license. Raw events carry the
record and people's ids, so outsiders never read the log. They read a
projection.

## Plan

1. **Done (this change).** `v1.LicenseSet` with the ratchet fold,
   validation and privilege in core and SQL (now in the baseline migration,
   parity script, smoke section 8e); the
   choice on Create Organization; opening it from Organization Home; the
   license on Explore listings. Nothing outside the organization can see more
   than before.
2. **Public projection.** The projection worker already folds every stream
   off the write path (invariant 9). For languages whose organization's
   license has `outsidersMayView`, it writes safe rows and nothing else:
   `public_languages (org_id, language_id, name, org_name, license, updated_at)`
   and `public_passages (org_id, language_id, unit_id, parent_id, label, sort,
   card_hashes, duration_ms, updated_at)`, plus `public_blobs (hash)` for the
   cards those versions use. Tables are readable by `anon` through RLS that
   checks the org's license again (a SQL `org_license(org)` folded from the
   `_org` events by the same max rule), so a stale row from a worker bug cannot
   outlive a license check. A storage policy lets anyone read an object whose
   hash is in `public_blobs`. Content addressing makes that safe: a hash is
   public only because an open organization published those exact bytes.
3. **Looking inside.** From Explore, a read-only language view: the map and a
   player for each passage's current version, with the credit line the
   license requires. The demo lists public projects (AUTH-6) but has no
   screen inside one, so these are new screens: record the departure and list
   them as app-only edges in `flow.ts` for the parity test.
4. **Reuse.** "Use in our organization" for work whose license has `mayAdapt`:
   import passages as a source (`v1.SourceImported`, a pin, invariant 6),
   carrying the source's license and credit. Share-alike limits the importer:
   work adapted from BY-SA must stay BY-SA, so an organization at CC BY or
   CC0 cannot import it without a per-language license (next item).
5. **Per-language license, if partners need it.** A language may be more open
   than its organization, never less: the organization's license is the
   floor. A team at risk then stays safe in a closed organization while other
   languages open up. This is a new event (`v1.LanguageLicenseSet`, the same
   ratchet), not a change to this one.

## Open questions

- **Where the line is.** Here any Creative Commons license lets outsiders look
  inside, because sharing with the public is what those licenses are for.
  The first request's example only named CC0. If partners want the line
  higher, change `outsidersMayView` in `LICENSE_INFO`; nothing else moves.
- **What counts as published.** The current submitted version of each
  passage, or only passages past a checkpoint? Partners decide; the projection
  is the only place that changes.
- **Whose copyright it is.** For an organization to license work, its members
  must have given it the right. Joining (terms, invites) should say that
  what members contribute is under the organization's license. This needs
  legal review before step 2 ships.
- **The credit line.** The organization's name, or a line it writes
  ("© 2026 Wycliffe Associates, CC BY-SA 4.0")? A register beside the license
  would carry it.
- **Library items.** Should a shared template or study guide carry its
  organization's license, or its own?
