# 91. A language's checks carry their own people, questions and helps, and a ready-made flow is copied

Date: 2026-10-12 · By: Caleb Koster · Status: accepted

Reason: the review set-up read as tangled (Caleb, 2026-10-12). One check was
spread over Who checks (steps that hold two kinds), Review Teams under More
(a team that "usually reviews" one kind, or any), questions as Review
Questions material beside the TMF and Brief, and flows a language used,
followed or copied. Only people with the Reviewer role could be on a team or
be asked, so a translator could not do a peer check, and nothing linked a
note or guide to a check. His model: a language has checks in order, made,
reordered or started from a ready-made flow, and that alone carries the work
forward, with anyone on the team asked. People may be put on a check; they
are then the top choices, and "Ask the Peer check team" reaches all of them.
Helps (notes, guides, Bibles) may be linked to a check. From the audit page
(https://claude.ai/artifact/XqndiTYoof96zmrgzMwVgz) he chose:
- People belong to a check. They are review-team records, one team per check
  (`check:<kindId>`, core `checks.ts`), so a request to a team (56) reaches
  them as it did. Older teams still count: one set to the kind, or to any
  kind, puts its people on the check until that check's people are edited,
  when they move onto the check's own team (`checkPeopleSpecs`). The Review
  Teams screens are dropped (flow.ts `DROPPED_SCREENS`).
- The Translator role has Review (`SEED_ROLES`), so a translator can be on a
  check and be asked. An organization whose Translator role still has
  exactly the old seed gets the change once, from an admin's phone
  (`translatorReviewUpgrade`, `useTranslatorReview`); a changed role is left
  alone.
- A ready-made flow is a starting point: using one copies its checks into
  the language as its own steps (`commands.copyFlow`, the `custom` prefix of
  32), from New language, Get ready, Checks and the flow library alike.
  Nothing follows a flow's later versions. Languages already following one
  keep following it until someone changes their checks.
- Checks that happen at the same time stay one step with two kinds (29); the
  screens show each check as its own row, marked "same time"
  (`checks/model.ts`).
- A help is linked by `v1.CheckHelpSet { kindId, itemId | materialId,
  linked }`, a register per (kind, help) in the language stream, under
  manage_flows (migration `20261012200000_check_helps.sql`). Questions keep
  their storage, a question set scoped to the kind (26), but are added and
  edited on the check.
The screens (`screens/checks.tsx`): the language page's Checks row says the
order; Checks lists each check with its people, questions and helps and saves
every change at once, with Undo; one check holds People, Questions, Helps,
Must pass, Same time and Remove. New language's "I'll choose the checks" edits
the same list before the language exists (`checks/draft.ts`). After
publishing, the ask page shows each open check with its people and asks the
check's team; Someone else lists the team first, then everyone else, and the
questions they will answer. The passage path lists each check with its
people, My Work says when a check went to a team, and the review shows the
check's helps on Listen and every earlier version under Background. "Check"
is the one word for a review stage on every screen (`checkName`).
Not yet: an invite that puts whoever joins on a check (the server would have
to write the team membership at redeem time).
Reverse if: teams need someone on a check who must not review anything else
(then a check's people need a grant of their own), or one check needs
several groups with different people (then groups come back, within a check).

Amended (2026-10-13, Carl Sauder): with Review on the Translator role, the
role chooser's "Back-translate" (decision 71) gave the same role as
"Translate". It now gives a role named for back translation if one exists,
else the smallest role that both translates and reviews but runs nothing
(other than Translate's own role), else the checking role. With only the
seed roles, that is Reviewer (`plainRoleChoices` in `simple/adminModel.ts`,
PEOPLE-003).

Amended (2026-10-16, Caleb Koster): no check hosted by LangQuest comes with
premade questions yet (LAN-85). Spoken asked how to change the community
check's questions, which were LangQuest's shipped set and could not be
edited on the check. Caleb (2026-10-16): there should just be a community
check, and the admin puts in their own questions, notes and helps;
LangQuest will do something specific later. So `QUESTION_TEMPLATES`,
`instantiateQuestionSet` and `questionSetMaterialId` are gone from core,
`questionsForKind` returns the language's own question sets for the check
and then the request's, and the library seed no longer publishes LangQuest's
two question sets (the hosted library keeps them until someone removes
them there). Someone who manages flows opens the check from the questions
on the ask page and on Someone else, to change them there. Changes made
on a check's page (its people, its helps, what its step shows) say what
happened without an Undo button (Caleb, 2026-10-16: no timed undo toasts);
each is reversed the way it was made.
