# 139. Words are never cut off: a label wraps, side-by-side things move under each other, and a few choices wrap

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-16): on the passage page, under "Continue
recording", "Something else?" and "Versions and …" were cut off; "Go
through the app and look for cutoff text in all languages on all pages and
resolve." Walking every screen reachable from each role at 360 pt in the 15
interface languages (and reading every layout) found cut-off words in the
kit and in 40 screens' and parts' files, many in English too: the kit and screens shortened words with "…"
(`numberOfLines`), left a label beside other things with no room to wrap
(React Native does not shrink a child by default, and Android clips what
runs past its parent), fixed widths that a word in Swahili or Burmese
outgrows, and choices of two or three in a row that scrolls sideways, the
last one past the edge. The rule, in the kit so screens get it by default:
- **The app's own words show in full.** `Row` labels and subs, `Disclosure`
  summaries (still short, but they wrap: this narrows PLAN.md's one-line
  summaries), `Header` titles and subs, `Badge`, and the labels of
  `PrimaryBtn`, `GhostBtn`, `SmallBtn`, `QuietLinks` and `Chip` wrap instead
  of taking "…"; the buttons shrink to their place and their words wrap in
  them. People's own content (names, notes, titles) may still be shortened
  in a list; it shows in full where it opens.
- **Side by side while it fits, else under.** A `Row`'s badge and right-hand
  part keep the label most of the row (`rowBadge`, `rowRight`); a header
  whose action carries words or is wider than one round button puts the
  title on its own line under the buttons; button groups, figures, keys,
  pills and title-with-badge lines wrap.
- **A few choices wrap** (`ChipWrap`), so every option is in sight; a
  `ChipRow` that scrolls sideways stays for filters among many.
- **The reviews grid** sizes every column to the longest word in any head,
  so a head breaks only between words, and a head is a check's whole name
  where two checks share their first word (Spanish "Verificación …"), so no
  two read alike (`gridColumnNames`).
- **The recording screen's collapsed reference bar** (80 pt) shows the
  Bible's name only: its "Drag down for the guide, key words, notes and
  earlier recordings" never fit in any language, and help mode says it.
- **On Android, bold text set with a line height is drawn at weight 600**
  (`ui/text.tsx`). Caleb's cut was Android's own: on an emulator sized like
  his Pixel 10 Pro, "Versions and history" lost "history" at weight 700 with
  `txt.sm`'s line height, kept it at 600 or without the line height, and the
  kit's wrapping alone did not help. Android draws 600 and 700 near enough
  alike in its system font.
The recording screen's part rows and its footer are 136's: they were being
rebuilt alongside this, and its Done and one-line bar now fit their words.
Reverse if: a screen needs a fixed-size label to stay readable at a glance
(a tab bar), and wrapping makes it worse than an abbreviation would.
