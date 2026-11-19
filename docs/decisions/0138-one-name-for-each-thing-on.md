# 138. One name for each thing on a language's page: its pick under each, the others and the organization's shelf behind it, and no More

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-16), on a language's page in Manage: under More,
Members, "Every way to divide the work", "Bibles, guides and notes" and
"Every way to check" looked like People, They record, What helps them and
Checks above them, and "The connection between the pairs of options isn't
really obvious in the list." He asked for the name as "a pencil by big title
on top of page", the cluster "below the big page title", one "Languages"
entry, and no organization row ("they can just go back"). Layout research
(apps such as Revolut Business, Notion and Settings show the pick where you
are and open the library from the bottom of the picker) found each pair was
one thing under three names: a language's choice, and the organization's
shelf it picks from. Caleb approved the layout ("Looks great, please go
ahead"). What was built:
- **One name each, everywhere:** Content template(s), Reference material and
  Review flow(s), on a language's page, its pages, and the organization's
  Setup and shelves (which were Content Templates, Reference Material, Review
  Flows). A row's second line is this language's pick, never an explanation.
- **A ready language's page has seven rows and no More** (`LanguageHome`):
  Content template, Reference material and Review flow; People and Roles,
  with join requests under them; Languages and Show on the public list.
  Members (People's own screen), the three shelf rows, the organization's
  row, Name, In the language list, Cluster, and More's progress bars and
  code line are gone; progress is on See their work and the organization's
  list. A language that is not ready keeps its checklist, then See their
  work and Roles, then Languages and the public list.
- **Each pick opens the same way** (get_ready `step` 'template', 'helps',
  'flow'): what it uses on top (`PickCard`: a lit radio, its facts, links
  into it), the others under it as radio rows with an explicit Use (others
  see the choice, so it is not saved on tap), and last a row to the
  organization's whole shelf ("All content templates", "All reference
  material", "All review flows"). The content template's links are Each
  book's passages (the language's books, which was its template view),
  Which books (question 1), and Edit or View; its version and Take update
  moved onto it. The review flow's link is Edit (the Checks screen); using a
  ready-made flow over its own checks asks first (134). Reference material is
  What helps them renamed, ending with its shelf instead of Add more's
  library row. The demo's Choose a Template screen (`template_picker`) is
  dropped: the Content template page lists the choices itself.
- **The name and clusters change where they show:** a pencil beside the big
  title (the rename keeps Save the name, since everyone sees it, 76), and an
  amber chip under it with the clusters it is in, "+ Cluster" for whoever may
  group languages while it is in none (108).
- **Languages** is one row (`LanguagesRow`): its sheet has They translate
  into (its link to the language list) and They understand (the languages
  its Bibles and guides are in, 130).
- **Up instead of a row:** a language lead's Manage tab opens on their
  language with no Back, so the organization's name sits where Back would be
  and opens its page (`BigTop` `up`).
- **The organization's page, the same way:** a pencil beside its name in the
  top card, and its licence under the name opens the licence sheet; Setup
  loses Name and the licence row.
Alternatives: keeping the pairs with standard titles and a line under each
saying what it is (Caleb's first idea): the line repeats on every visit,
must be translated and fit 360 wide in 15 languages, and the project keeps
explanatory text out of the UI; the pick says what the row is about.
Reverse if: people cannot find the organization's templates, reference
material or review flows from a language, or look for the name or clusters
in a More that is no longer there.
