-- A language is no longer folded again for every event in its organization's
-- stream (performance-audit-2026-10-26.md item 2). The pass keeps, with each
-- mark, a fingerprint of what a language's projection reads from the
-- organization: who may open it, its name and code, the licence
-- (server/projectionWorker.ts orgFingerprint). When the organization moved
-- and the fingerprint did not (an invite, a role for another language, a
-- join decided elsewhere), the language is skipped. A mark without one (all
-- of them today) is folded once when the organization next moves, which
-- writes it.
alter table public.projection_marks add column if not exists org_fp text;
