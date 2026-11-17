# 175. An organization can move a library item to another organization: the other takes it, and the server moves the item's followers to its copy

Date: 2026-10-27 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-27) asked for "some mechanism by which to transfer the
hosting of content from one organization to another", after publishers got
organizations of their own (173, 174): LangQuest's own FIA copies, which
teams follow, should be able to go to Word Collective. Built
(docs/library.md, "Moving an item to another organization"):
- **Offer.** Someone who manages that kind of item at its organization
  offers it to another organization, found by name among those that share
  material, have a blue check or list a language (`library_move_offer`,
  `library_move_targets`). One open offer an item; it can be taken back
  until it is taken.
- **Take.** Someone who manages that kind at the other organization sees it
  under "Offered to you" on the page for that kind, and takes it as a new
  item or in place of one of its own of the same kind, or turns it down
  (`library_move_accept`, `library_move_decline`). As a new item, the server
  gives the organization every version's documents and their app publishes
  them, oldest first, under the old item's name; either way their app shares
  the item for following. If that organization followed the old item, it
  stops and archives the item that followed it: the item is its own now.
- **The server moves the followers.** When the new item's version or sharing
  lands, `_library_move_land` (called from `_apply_library_event`) appends,
  as `server`, a `v1.LibrarySubscribed` to every organization that follows
  the old item, naming the new one (same local item, same settings), a
  `v1.LibraryPinned` to its version for those that take updates
  automatically, and to the old organization `v1.LibrarySharingSet` (not
  shared) and `v1.LibraryItemArchived`. This is how `_library_fan_out` already
  pins automatic updates in followers' streams; both organizations agreed
  and the followers asked to follow the item, so it is not the server
  writing an organization's library on its own (62). Languages that use the
  item keep their item ids. No new event type: the move itself is the
  server's own state (`library_moves`, its state worked out from its times).
- An item that follows a moved item keeps its local id (`sub.<old org>...`),
  so "already following" is now looked up by the subscription's source
  (core `followerItemId`), not worked out from the id.
Not yet: moving several items at once, and a note in a follower's app that
the item moved (its line says the new organization, with its blue check).
Reverse if: an organization objects to its followers being moved without
being asked (then the move would offer each follower the switch instead), or
moves are wanted between organizations that cannot find each other.
