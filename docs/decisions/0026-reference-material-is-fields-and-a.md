# 26. Reference material is fields, and a question is a field

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: audit 5.E. One material with one text register would make two
people filling different blanks of the same document a conflict; per-field
registers make it a merge. Treating a question set as a material whose
fields are the questions means one screen, one lock rule and one scope rule
cover TMF, briefs, guidelines, study material and questions alike, and
`TakeSubmitted.questionSetIds` keeps its shape. Key terms stay grow-only
because every part of a glossary entry is an addition: a rendering, a
recorded adjustment, a link. Reverse if: partners need to edit a rendering
in place; then renderings become registers, and nothing else changes.
