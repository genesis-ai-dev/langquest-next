# 55. Wide windows get a centred column, a side rail or sidebar, and list–detail panes; phones are unchanged

Date: 2026-10-01 · By: Carl Sauder · Status: partly superseded by 58

Reason: we are preparing the app for tablets and for publishing on the web.
The partner demo (28) is designed only for a portrait phone, so on an iPad or
in a browser every screen stretched edge to edge and the tab bar spanned the
window. The layout now follows the window's width alone, the same on web and
on native tablets, with breakpoints at 768 and 1100 (`src/layout.ts`,
`breakpoint` and `measure` in `theme.ts`). Phones are always under 768, so
their screens are the demo's exactly: every change is gated on
`useLayout().kind !== 'phone'`, and `layout.test.ts` holds the phone's tab
rule to `TAB_SCREENS`. On a wider window:
- **The kit does the work, not each screen.** `Screen`, `Header`, `Sheet` and
  `ToastView` put content in a centred 720 column. Footer actions stop at
  360 instead of stretching. A sheet becomes a centred dialog. Field sizes
  stay (48/56pt targets, 17pt body), because tablets and touch laptops are
  still touch.
- **The tabs become a rail (768+) or a labelled sidebar (1100+)**
  (`NavChrome.tsx`). On a wide window they also stay on the Manage and
  Settings drill-downs (`WIDE_CHROME`), a deliberate difference from the
  phone. Task screens still hide them (ADR-021).
- **A list and what it opened sit side by side at 1100+**: the Map chain,
  Inbox, the Manage editors, and Org to Language home. The split is read off
  the stack (`panes.ts` `paneFor`), so it adds no screen and no edge. A tap
  in the list pane goes through `goFrom` as `edgeFor(list, to)` with the same
  gates, and `nav.fromRoute` resets the stack as if the list were on top, so
  `flow.ts` and the parity test are unchanged. `panes.test.ts` checks that
  every pair is a push edge the list already has. The list is mounted once,
  in the pane, and its place in the stack shows the "Pick a …" state.
- **Tablets may rotate and phones stay portrait.** iOS is set per idiom in
  `app.json`. Android has one setting for every device, so phones under
  600dp are locked at start (`orientation.ts`). This changes the native
  fingerprint, so testers need new builds.

The costs: a book's grid remounts when it moves into the pane (its filter
survives in params, an open sheet does not); tapping another row discards an
editor's unsaved changes, as Back does on a phone; and the web build is still
not ready to publish (blob storage, camera and notifications have no web
implementation), which this change leaves alone.
Reverse if: tablet testers find the shifting panes confusing; remounts or lost
state in the chain become a real problem; or React Navigation gains a split
view that keeps the edge checks.

Amended (2026-10-23, Carl Sauder): Map and Manage now handle the panes the
same way, which Carl asked for after comparing them on a desktop window.
In Manage, the organization's page and a language's page are lists too
(`SPLITS` in `panes.ts`), so the pane always shows the screen you came from
and the right side what it opened, one level at a time, as Map's Progress,
language and book do: the organization's page beside Members, Members beside
a member, a language's page beside Roles, Roles beside a role. Before,
anything a language's page opened, and anything but a language the
organization's page opened, took the pane over and the page left the
screen. Both hubs (Progress and the organization's page) start beside a
placeholder ("Pick a language", "Pick something to manage") rather than
full width, so the layout does not jump when something opens. The admin
pages' header (`BigTop`) takes the white bar and centred column every other
header has on a wide window. Beside a desktop's sidebar, which names the
organization at its top, headers leave the name out of their subtitles, and
the organization's page is titled Manage, as Progress is titled for Map
(`orgInChrome` on `Layout`). In a split, the list pane leaves the Global
Viewer link and help's ? to the screen open beside it, so each shows once.
