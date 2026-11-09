-- The record and assign scopes (decisions.md 205): an app writes back work
-- made in it, as the person behind its access token. record: a new version
-- of a passage (v1.RecordingAdded, v1.TakeComposed, v1.TakeSubmitted, and
-- v1.ResponseRecorded or v1.NoteAdded) or a new passage (v1.UnitAdded).
-- assign: someone asked to record or review (v1.RequestMade). Notes and
-- back translations go with the review scope, as reviews do.
--
-- No event is new, and none is reserved to the Worker: may_emit checks the
-- token's person for each as it does for their phone (translate for a
-- version, manage_templates for a passage, send_to_reviewers or
-- assign_work for a request). The scope itself is the
-- Worker's to check (apps/web/worker/agent/contribute.ts); the tables only
-- have to accept it.

alter table public.api_tokens drop constraint api_tokens_scopes_check;
alter table public.api_device_grants drop constraint api_device_grants_requested_scopes_check;
alter table public.api_tokens add constraint api_tokens_scopes_check check (
  cardinality(scopes) > 0 and scopes <@ array['read:published', 'read', 'review', 'release', 'external_values', 'record', 'assign']::text[]);
alter table public.api_device_grants add constraint api_device_grants_requested_scopes_check check (
  cardinality(requested_scopes) > 0 and requested_scopes <@ array['read:published', 'read', 'review', 'release', 'external_values', 'record', 'assign']::text[]);
