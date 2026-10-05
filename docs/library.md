# The library: content templates, review flows, reference material

Content templates, review flows and reference material live in the database,
not in the app. Each organization has a **library** of items; each item has
**published versions**; an organization decides per item whether other
organizations may see it (and copy it) and whether they may subscribe to it.
The official **LangQuest** organization (`langquest`) hosts the starters:
versifications, Bible and FIA templates, the standard review flows, question
sets and FIA study material. Decision 36 in `docs/decisions.md` says why.

## Items and versions

An item is one of four kinds:

| Kind | Documents | Managed with |
| --- | --- | --- |
| `template` | `template@1` | Manage Content Templates |
| `flow` | `flow@1` | Manage Review Flows |
| `material` | `study@1`, `collection@1`, `material@1` | Manage Reference Material |
| `versification` | `versification@1` (Copenhagen Alliance JSON) | Manage Content Templates |

A version is an immutable JSON **document** named by the SHA-256 of its
canonical text (`canonicalJson` in `packages/core/src/libraryDocs.ts`: keys
sorted, no whitespace). The log never carries a document, only its hash.
Documents that refer to others list them in `deps` (a template its
versification, a collection its study guides) so they are shared together.

Events, all in the org partition (`packages/core/src/library.ts`):

| Event | Merge |
| --- | --- |
| `v1.LibraryItemDefined {itemId, kind, name, description, copiedFrom?}` | kind and copiedFrom earliest wins; name, description registers |
| `v1.LibraryVersionPublished {itemId, kind, docHash, note?}` | grow-only per hash, earliest wins; numbered by clock |
| `v1.LibrarySharingSet {itemId, kind, shared, subscribable}` | register (subscribable implies shared) |
| `v1.LibraryItemArchived {itemId, kind, archived}` | register |
| `v1.LibrarySubscribed {itemId, kind, sourceOrgId, sourceItemId, name, autoUpdate, active}` | register |
| `v1.LibraryPinned {itemId, kind, docHash}` | register; the server writes it for automatic updates |

The version an item is **at** (`libraryItemView(...).current`): for an
item this organization controls, its latest published version; for a
subscription, its pinned version.

## Using another organization's item

- **Copy:** the item becomes this organization's own. `LibraryItemDefined`
  with `copiedFrom`, then `LibraryVersionPublished` of the same hash. Edits
  here publish new versions here; the source never changes it again.
- **Subscribe:** only if the owner allows it. `LibrarySubscribed` (item id
  `sub.<sourceOrg>.<sourceItem>`) and `LibraryPinned` to the version taken.
  With `autoUpdate`, the server pins each new version the owner publishes;
  without it, the app says an update is available and someone takes it.
  Unsharing never takes away a version already pinned or copied.

Before either, `library_adopt` gives the organization access to the version
and everything it depends on. That copy of access is what makes it
self-contained (PLAN.md invariant 6): no live link to the other organization.

## Languages

A language uses one version of a template and one of a flow. Applying one
emits the ordinary events into the language's own partition (decision 37)
(`libraryApply.ts`), with ids decided by the item, so two admins applying
offline agree:

- Template: `v2.LaneTemplateSelected {laneId, itemId, docHash, unitPrefix}`,
  `v1.UnitAdded` for parts not yet in the log (id `<itemId>/<node>`: `GEN`,
  `GEN.1`, `GEN.1.1-2.3`, or an outline id), and `v1.LaneUnitHidden` for
  parts the version no longer has (hidden, never deleted; TPL-7).
- Flow: `v1.ReviewKindDefined` for kinds the organization lacks,
  `v2.WorkflowStepSet` under the version's prefix (`<lane>/<itemId>~<hash12>@2/`),
  and `v2.LaneFlowSelected {..., itemId, docHash, name}`.

When an item a language uses moves to a new version (an edit here, or a
subscription update), the next device of someone who may apply it does so.

## Versification

`packages/core/src/versification.ts` reimplements the pivot method of
Frontier's versification-tool: every system is written as differences from
the Original (org) numbering, and two ranges line up where the org verses
they cover meet. Templates and study material each name their versification,
so FIA guides numbered in English land on passages a team numbers in Hebrew.
The six standard systems are in `library/versifications/` (Copenhagen JSON,
MIT, from versification-tool).

## Server contract

Tables (no direct access; only the functions below): `library_items`,
`library_versions`, `library_subscriptions` (projections of the events, kept
by `_apply_org_event`), `library_documents` (hash, format, body, deps) and
`library_document_access` (which organization may read which document).

| Function | Who | What |
| --- | --- | --- |
| `library_put_document(p_org, p_body) → hash` | a member of `p_org` who manages templates, flows or reference | stores a document; its deps must already be readable by `p_org` |
| `library_get_documents(p_org, p_hashes) → (hash, body)` | a member of `p_org` | documents `p_org` may read, plus current versions of shared items (for browsing) |
| `library_shared_items(p_kind, p_query, p_limit, p_offset)` | anyone signed in | shared, unarchived items of every organization, with their latest version |
| `library_adopt(p_org, p_source_org, p_source_item, p_hash)` | a member of `p_org` who manages that kind | gives `p_org` access to one version of a shared item and its deps |
| `library_updates(p_org)` | a member of `p_org` | each active subscription's newest available version |
| `library_seed_document` / `library_seed_events` | service role only | how `scripts/library-seed.ts` publishes the LangQuest organization |

## Content in this repository

`library/` holds what the LangQuest organization publishes: the
versifications, and the sources `scripts/library-seed.ts` turns into
documents (templates, flows, question sets). FIA study material comes in
through the FIA adapter (`scripts/fia-adapter.ts`) from the FIA API's
pericope JSON. Sources to read and hear (`source@1`) are built by
`scripts/sources-seed.ts`: Bible Brain editions from FCBH's API (linked,
nothing of theirs stored) and the BSB read by Frederick Surrey from its
public-domain text (library/README.md). None of it ships in the app.
