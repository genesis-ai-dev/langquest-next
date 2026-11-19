# 199. Carl's UI review: a grip of dots, holds and grips that show what they do, "Done, don't ask anyone", fewer help numbers, and doors of their own for a cluster and an email account

Date: 2026-11-02 · By: Caleb Koster · Status: accepted

Reason: Carl reviewed the app and filed LAN-125 to LAN-144 (Linear label
"UI Review"). Caleb (2026-11-02) asked for the list fixed, each issue's
Expected followed unless it goes against a product decision or the partner
demo, with before and after screenshots. What changes an earlier entry or
adds a way of working:
- **The part grip is six dots** (LAN-132, amends 136): three lines read as
  a menu, so people tapped them and nothing happened. A tap on the grip,
  with no drag, now bounces the arrows on it (`useDragRows` `tapped`,
  `slots.tsx` `PartGrip` `nudge`).
- **Holding a verse space shows itself** (LAN-133): the first tap on one,
  once per phone or browser, shows a fingertip holding it while the hold's
  ring fills, twice (`recording/useHoldHint.ts`), as the swipe hint shows
  the bin (136); every hold fills the ring as it is held. The verse sheet
  ends with Done, not ✕ (LAN-134): each tap in it is kept as it is made, so
  a ✕ read as Cancel.
- **"Done, don't ask anyone"** (LAN-136, amends 127 and 178) replaces "Send
  later", as a button of its own under Ask someone and Someone else: the
  version is finished and nobody is asked, which is what it did.
- **Help numbers what matters first** (LAN-135, amends 71): parts that
  repeat or only show something are quiet (`HelpQuiet`), dim and
  unnumbered, and a tap still explains them; the recording screen numbers 7.
- **New cluster** (LAN-140, amends 108) is a row on Manage that opens New
  language on the cluster's name and its languages, without the six steps.
  A cluster still holds at least one language.
- **After scanning, a third way in** (LAN-137): "Make an account with
  email" keeps the invite for the next account to sign in, as "I already
  have an account" does, and opens Create Account, which says the invite is
  saved and leaves out its own "Scan an invite".
- **A person whose name is not known yet is "someone"** (LAN-129), never
  their picture's colour and shape, and the app asks the directory again, a
  few times, while a member has no name.
- **The Bible pane's player stays put and the words follow its voice**
  (LAN-130, LAN-131): the words scroll under a fixed header and player; a
  scroll by hand stops the following until the verse playing is back in
  sight or play is pressed again (`helps/useFollowVerse.ts`).
- **A passage's check cards open once there is a version to check**
  (LAN-127), and its latest version plays on the passage itself (LAN-128).
Caleb has a card open on each of four of these (six dots or three lines;
the third way in after scanning; an empty cluster; whether a picture and
pattern stay required, LAN-139, left as they are); the recommended answer
is what is built, and another answer changes it.
Considered: words on the grip (the row was cleared of words in 136); a
"Send later" that reminds (the product has no due dates); a cluster made
empty and filled from each language's page (the clusters chip on a
language's page already adds it to one, and an empty cluster shows nowhere
on Manage).
Reverse if: people drag parts less, or take the hint or the bounce for a
fault; people miss help on the quiet parts; or Manage's two add rows read
as one too many.
