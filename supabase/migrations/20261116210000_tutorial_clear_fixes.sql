-- Claude fixes a tutorial video by itself when the fix is clear, and every fix merges itself
-- (docs/tutorial-videos.md "Feedback", decisions.md 186 amended 2026-11-16). Caleb (2026-11-16,
-- thread "Automate tutorial video fixes"): a person should not have to see a clear fix at all, and
-- a developer's answer on the ops dashboard should be the only thing a person gives.
--
-- - A suggestion the nightly look calls clear (a change to a video's script, screens or voice that
--   has one right answer, which Claude checked) is accepted by Claude at once: `clear`, with
--   `decided_at` and no `decided_by`. Every other suggestion waits for a person, as before.
-- - A suggestion may name the language of the film it is about (a film that fails or is held in
--   French), as an admin's instruction does.
-- - A fix that needs no change (the video already does what it says) is `unneeded`, not failed.
-- - A fix's pull request merges itself when its checks pass. One whose checks fail, or that does
--   not merge within a day, is closed and its fix `failed` (from `open`), so a developer is asked.
--   The fix jobs ask GitHub; the open list says since when each waits.

alter table ops.tutorial_suggestions
  add column if not exists clear boolean not null default false;

-- Decided by a person (decided_by), or by Claude for a clear fix (clear, no decided_by).
do $$
declare c text;
begin
  for c in select conname from pg_constraint
    where conrelid = 'ops.tutorial_suggestions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%decided_at IS NULL%decided_by IS NULL%'
  loop
    execute format('alter table ops.tutorial_suggestions drop constraint %I', c);
  end loop;
end $$;
alter table ops.tutorial_suggestions drop constraint if exists tutorial_suggestions_decided_check;
alter table ops.tutorial_suggestions add constraint tutorial_suggestions_decided_check check (
  (decision is null) = (decided_at is null)
  and (decided_by is null or decided_at is not null)
  and (decided_at is null or decided_by is not null or clear)
);
alter table ops.tutorial_suggestions drop constraint if exists tutorial_suggestions_clear_check;
alter table ops.tutorial_suggestions add constraint tutorial_suggestions_clear_check check (
  not clear or (decision = 'accepted' and kind in ('script', 'screen', 'voice') and tutorial is not null)
);

alter table ops.tutorial_suggestions drop constraint if exists tutorial_suggestions_fix_state_check;
alter table ops.tutorial_suggestions add constraint tutorial_suggestions_fix_state_check
  check (fix_state is null or fix_state in ('working', 'open', 'merged', 'closed', 'failed', 'unneeded'));

-- As in 20261114010000_tutorial_fixes.sql, and whether Claude accepted it as clear.
create or replace function ops.tutorial_suggestion_json(s ops.tutorial_suggestions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'kind', s.kind, 'tutorial', s.tutorial, 'language', s.language, 'title', s.title, 'detail', s.detail,
    'madeAt', s.made_at, 'editedAt', s.edited_at, 'decision', s.decision, 'decidedAt', s.decided_at, 'reason', s.reason, 'clear', s.clear,
    'issue', s.issue, 'issueUrl', s.issue_url,
    'fix', case when s.fix_state is null then null else jsonb_build_object('state', s.fix_state, 'pr', s.fix_pr, 'at', s.fix_at,
      'run', s.fix_run, 'note', s.fix_note) end,
    'inputs', coalesce((select jsonb_agg(ops.tutorial_input_json(i) order by i.at)
      from ops.tutorial_suggestion_inputs l join ops.tutorial_inputs i on i.id = l.input where l.suggestion = s.id), '[]'::jsonb))
$$;
revoke all on function ops.tutorial_suggestion_json from public;

-- As in 20261029120000_tutorial_feedback.sql, and: a suggestion's language, and a clear one accepted by
-- Claude at once (only a change to a video's script, screens or voice; anything else waits for a person).
create or replace function public.ops_tutorial_reviewed(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_review bigint;
  v_keys jsonb := '{}'::jsonb;
  v_id uuid;
  v_sug uuid;
  v_ref text;
  v_clear boolean;
  v_skipped int := 0;
  v_code int := 0;
  v_suggested int := 0;
  v_looked int := 0;
  c jsonb;
begin
  delete from ops.tutorial_reviews where at < now() - interval '1 year';
  delete from ops.tutorial_suggestions where decided_at < now() - interval '1 year';
  insert into ops.tutorial_reviews (sha, run_url) values (p->>'sha', p->>'runUrl') returning id into v_review;

  for c in select * from jsonb_array_elements(coalesce(p->'code', '[]'::jsonb)) loop
    insert into ops.tutorial_inputs (kind, ref, tutorial, pr, text, english, at, looked_at)
    values ('code', c->>'sha', c->>'tutorial', (c->>'pr')::int, c->>'title', c->>'english', (c->>'at')::timestamptz, now())
    on conflict (ref, tutorial) where kind = 'code' do update set english = excluded.english
    returning id into v_id;
    v_keys := v_keys || jsonb_build_object(c->>'key', v_id);
    v_code := v_code + 1;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p->'comments', '[]'::jsonb)) loop
    update ops.tutorial_inputs set english = c->>'english', reply = nullif(c->>'reply', ''), reply_english = nullif(c->>'replyEnglish', '')
    where id = (c->>'id')::uuid and kind = 'comment';
    if not found then v_skipped := v_skipped + 1; end if;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p->'looked', '[]'::jsonb)) loop
    update ops.tutorial_inputs set looked_at = now(), outcome = nullif(c->>'outcome', '')
    where id = coalesce((v_keys->>(c->>'input'))::uuid, case when c->>'input' ~ '^[0-9a-f-]{36}$' then (c->>'input')::uuid end);
    if found then v_looked := v_looked + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p->'suggestions', '[]'::jsonb)) loop
    v_clear := coalesce((c->>'clear')::boolean, false) and c->>'kind' in ('script', 'screen', 'voice') and c->>'tutorial' is not null;
    insert into ops.tutorial_suggestions (kind, tutorial, language, title, detail, review, clear, decision, decided_at)
    values (c->>'kind', c->>'tutorial', nullif(c->>'language', ''), c->>'title', c->>'detail', v_review, v_clear,
      case when v_clear then 'accepted' end, case when v_clear then now() end)
    returning id into v_sug;
    v_suggested := v_suggested + 1;
    for v_ref in select jsonb_array_elements_text(coalesce(c->'inputs', '[]'::jsonb)) loop
      v_id := coalesce((v_keys->>v_ref)::uuid, case when v_ref ~ '^[0-9a-f-]{36}$' then v_ref::uuid end);
      if v_id is not null and exists (select 1 from ops.tutorial_inputs where id = v_id) then
        insert into ops.tutorial_suggestion_inputs (suggestion, input) values (v_sug, v_id) on conflict do nothing;
        update ops.tutorial_inputs set looked_at = coalesce(looked_at, now()) where id = v_id;
      else
        v_skipped := v_skipped + 1;
      end if;
    end loop;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p->'attach', '[]'::jsonb)) loop
    if not exists (select 1 from ops.tutorial_suggestions where id = (c->>'suggestion')::uuid and decision is null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    for v_ref in select jsonb_array_elements_text(coalesce(c->'inputs', '[]'::jsonb)) loop
      v_id := coalesce((v_keys->>v_ref)::uuid, case when v_ref ~ '^[0-9a-f-]{36}$' then v_ref::uuid end);
      if v_id is not null and exists (select 1 from ops.tutorial_inputs where id = v_id) then
        insert into ops.tutorial_suggestion_inputs (suggestion, input) values ((c->>'suggestion')::uuid, v_id) on conflict do nothing;
        update ops.tutorial_inputs set looked_at = coalesce(looked_at, now()) where id = v_id;
      else
        v_skipped := v_skipped + 1;
      end if;
    end loop;
  end loop;

  update ops.tutorial_reviews set looked = v_looked, suggested = v_suggested, code = v_code where id = v_review;
  return jsonb_build_object('review', v_review, 'code', v_code, 'looked', v_looked, 'suggested', v_suggested, 'skipped', v_skipped);
end $$;

-- As in 20261114010000_tutorial_fixes.sql, and since when each pull request waits ('at'), so a fix run
-- can close one that has not merged within a day.
create or replace function public.ops_tutorial_fixes(p_limit int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'toFix', coalesce((select jsonb_agg(ops.tutorial_suggestion_json(x.s) order by (x.s).decided_at)
      from (select s from ops.tutorial_suggestions s
            where ops.tutorial_fixable(s) and (s.fix_state is null or (s.fix_state = 'working' and s.fix_at < now() - interval '3 hours'))
            order by s.decided_at limit least(greatest(p_limit, 0), 10)) x), '[]'::jsonb),
    'open', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'pr', s.fix_pr, 'at', s.fix_at) order by s.fix_at)
      from ops.tutorial_suggestions s where s.fix_state = 'open'), '[]'::jsonb)
  )
$$;

-- As in 20261114010000_tutorial_fixes.sql, and two moves: `unneeded` from working (the video already does
-- it), and `failed` from open too (its checks failed, or it did not merge within a day: the run closed it).
create or replace function public.ops_tutorial_fixed(p_id uuid, p_state text, p_pr int, p_run text, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s ops.tutorial_suggestions;
  v_moves boolean;
begin
  if p_state is null or p_state not in ('working', 'open', 'merged', 'closed', 'failed', 'unneeded') then raise exception 'not a fix state' using errcode = '22023'; end if;
  select * into s from ops.tutorial_suggestions where id = p_id for update;
  if not found then return 'not_found'; end if;
  if not ops.tutorial_fixable(s) then return 'refused'; end if;
  v_moves := case p_state
      when 'working' then s.fix_state is null or s.fix_state = 'failed' or (s.fix_state = 'working' and s.fix_at < now() - interval '3 hours')
      when 'open' then (s.fix_state = 'working' or s.fix_state = 'closed') and p_pr is not null
      when 'failed' then s.fix_state = 'working' or (s.fix_state = 'open' and p_pr = s.fix_pr)
      when 'unneeded' then s.fix_state = 'working'
      else s.fix_state = 'open' and p_pr = s.fix_pr
    end;
  if not coalesce(v_moves, false) then return 'refused'; end if;
  update ops.tutorial_suggestions set fix_state = p_state, fix_at = now(),
    fix_pr = case when p_state in ('working', 'unneeded') then null else coalesce(p_pr, fix_pr) end,
    fix_run = case when p_state in ('working', 'open', 'failed', 'unneeded') then coalesce(p_run, fix_run) else fix_run end,
    fix_note = case when p_state in ('failed', 'unneeded') then left(nullif(p_note, ''), 1000) when p_state = 'working' then null else fix_note end
  where id = p_id;
  return 'ok';
end $$;

revoke all on function public.ops_tutorial_reviewed, public.ops_tutorial_fixes, public.ops_tutorial_fixed from public, anon, authenticated;
grant execute on function public.ops_tutorial_reviewed, public.ops_tutorial_fixes, public.ops_tutorial_fixed to service_role;
