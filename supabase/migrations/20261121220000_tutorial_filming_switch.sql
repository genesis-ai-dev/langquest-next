-- Which app languages the tutorial videos are filmed in each night, set from the ops dashboard
-- (docs/decisions/2026-11-21-filming-languages-switch-on-the-dashboard.md). Caleb (2026-11-21, thread
-- "Pause filming by language on the dashboard"): a switch for each language, which works at once, in
-- place of a pull request on NIGHTLY_LANGUAGES in tutorials.yml.
--
-- - One row for each language a person has set; `nightly` says whether it is filmed. A language with no
--   row is not filmed. The three filmed today (en, fr, es) start on, so nothing changes on merge.
-- - Only the service role writes it, through the dashboard's action `tutorial-filming`, recorded in
--   ops.actions as `filming_on` or `filming_off` with the language as target.
-- - The filming reads the list from the app's Worker with its GitHub OIDC token
--   (GET /api/tutorial-filmed, tutorialFilmed.ts); when it cannot, it films NIGHTLY_LANGUAGES as before.
-- - The dashboard reads it as diag_reader through diag.ops_tutorial_filming().

create table if not exists ops.tutorial_filming (
  language text primary key check (language ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?$'),
  nightly boolean not null,
  set_at timestamptz not null default now(),
  -- Null for the rows this migration starts with.
  set_by uuid
);
alter table ops.tutorial_filming enable row level security;

insert into ops.tutorial_filming (language, nightly) values ('en', true), ('fr', true), ('es', true)
  on conflict (language) do nothing;

-- A person turns a language's nightly filming on or off: 'on' or 'off'.
create or replace function public.ops_tutorial_filming_set(p_language text, p_on boolean, p_by uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_language is null or p_language !~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?$' or p_on is null then
    raise exception 'not a language and a switch: % %', p_language, p_on using errcode = '22023';
  end if;
  insert into ops.tutorial_filming (language, nightly, set_at, set_by) values (p_language, p_on, now(), p_by)
    on conflict (language) do update set nightly = excluded.nightly, set_at = excluded.set_at, set_by = excluded.set_by;
  return case when p_on then 'on' else 'off' end;
end $$;
revoke all on function public.ops_tutorial_filming_set from public, anon, authenticated;
grant execute on function public.ops_tutorial_filming_set to service_role;

-- The languages filmed each night, for the filming (through the Worker): a sorted array of codes.
create or replace function public.ops_tutorial_filming_languages() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(language order by language), '[]'::jsonb) from ops.tutorial_filming where nightly
$$;
revoke all on function public.ops_tutorial_filming_languages from public, anon, authenticated;
grant execute on function public.ops_tutorial_filming_languages to service_role;

-- Every language set, for the dashboard: the switch and when it was last moved. No person's id.
create or replace function diag.ops_tutorial_filming() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('language', language, 'nightly', nightly, 'setAt', set_at) order by language), '[]'::jsonb)
  from ops.tutorial_filming
$$;
revoke all on function diag.ops_tutorial_filming from public;
grant execute on function diag.ops_tutorial_filming to diag_reader;

-- The dashboard's new action, in its log (ops.actions). The list is the one of 20261119171500_tutorial_reply_done.sql
-- with filming_on and filming_off added, and suggestion_fix of 20261121214500_tutorial_fix_in_app.sql, so the lists
-- are the same whichever merges first.
alter table ops.actions drop constraint if exists actions_action_check;
alter table ops.actions add constraint actions_action_check
  check (action in ('feedback_new', 'feedback_seen', 'feedback_done', 'run_job', 'verification_grant', 'verification_decline',
    'youtube_start', 'youtube_connect', 'tutorials_publish', 'tutorial_note', 'suggestion_accepted', 'suggestion_rejected', 'suggestion_edited',
    'quiet_ok', 'quiet_ok_undo', 'user_issue_note', 'reply_posted', 'reply_none', 'reply_open', 'filming_on', 'filming_off', 'suggestion_fix'));
