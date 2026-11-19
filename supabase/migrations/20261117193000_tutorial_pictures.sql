-- Pictures of what each suggestion about a tutorial video is about (docs/tutorial-videos.md "Feedback",
-- decisions.md 186 amended 2026-11-17). Caleb (2026-11-17, thread "Show pictures on tutorial video
-- suggestion cards"): a card that only says "the dim backdrop is half drawn at step 12 in fr" leaves him
-- unable to tell what it is about, so he cannot answer it.
--
-- - Claude's nightly look picks, for each suggestion, up to six pictures from the last film run in a
--   language (a step's screen, a still the frame check found wrong, the screen where a film stopped), with
--   a caption and, where it can see the place, a ring. The workflow sends each picture to the app's Worker,
--   which keeps it in R2 by its bytes' hash; a suggestion keeps only the names (`pictures`).
-- - A suggestion made before has its pictures added by a later look, while it has none or still waits for
--   a person, and, while it waits and no admin edited it, its words said again in plain words; once its fix
--   is merged and the video filmed again, the look adds the same places as they look now (`after_pictures`),
--   so the dashboard shows before and after.

-- One picture list, as server/tutorialFeedback.ts `parsePictures` checks it: at most six, each named by its
-- hash, with its language, video, kind and number, a caption, and a ring inside the picture when there is one.
create or replace function ops.tutorial_pictures_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) is distinct from 'array' then false when jsonb_array_length(p) > 6 then false else coalesce((
    select bool_and(
      jsonb_typeof(x) = 'object'
      and coalesce(x->>'picture' ~ '^[0-9a-f]{64}\.(png|jpg)$', false)
      and coalesce(x->>'language' ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?$', false)
      and coalesce(x->>'tutorial' ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(x->>'tutorial') <= 80, false)
      and coalesce(x->>'kind' in ('step', 'still', 'stopped'), false)
      and jsonb_typeof(x->'n') = 'number' and coalesce((x->>'n') ~ '^[0-9]{1,3}$', false)
      and (x->'at' is null or jsonb_typeof(x->'at') = 'number')
      and jsonb_typeof(x->'caption') = 'string' and length(x->>'caption') between 1 and 300
      and (x->'ring' is null or (jsonb_typeof(x->'ring') = 'array' and jsonb_array_length(x->'ring') = 4)))
    from jsonb_array_elements(p) x), true) end
$$;

alter table ops.tutorial_suggestions
  add column if not exists pictures jsonb not null default '[]'::jsonb,
  add column if not exists after_pictures jsonb not null default '[]'::jsonb;
alter table ops.tutorial_suggestions drop constraint if exists tutorial_suggestions_pictures_check;
alter table ops.tutorial_suggestions add constraint tutorial_suggestions_pictures_check
  check (ops.tutorial_pictures_ok(pictures) and ops.tutorial_pictures_ok(after_pictures));

-- As in 20261116210000_tutorial_clear_fixes.sql, and its pictures, before and after.
create or replace function ops.tutorial_suggestion_json(s ops.tutorial_suggestions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'kind', s.kind, 'tutorial', s.tutorial, 'language', s.language, 'title', s.title, 'detail', s.detail,
    'madeAt', s.made_at, 'editedAt', s.edited_at, 'decision', s.decision, 'decidedAt', s.decided_at, 'reason', s.reason, 'clear', s.clear,
    'issue', s.issue, 'issueUrl', s.issue_url,
    'fix', case when s.fix_state is null then null else jsonb_build_object('state', s.fix_state, 'pr', s.fix_pr, 'at', s.fix_at,
      'run', s.fix_run, 'note', s.fix_note) end,
    'pictures', s.pictures, 'after', s.after_pictures,
    'inputs', coalesce((select jsonb_agg(ops.tutorial_input_json(i) order by i.at)
      from ops.tutorial_suggestion_inputs l join ops.tutorial_inputs i on i.id = l.input where l.suggestion = s.id), '[]'::jsonb))
$$;
revoke all on function ops.tutorial_suggestion_json from public;

-- As in 20261116210000_tutorial_clear_fixes.sql, and pictures: a new suggestion's own, and `pictures` for
-- suggestions made before (`now` while one has none or waits for a person, `after` once its fix is merged).
-- A `now` entry may also say a waiting suggestion's title and detail again in plain words (Caleb could not
-- read the cards made before); an admin's edit is never written over. A list or words the table would refuse
-- are skipped and counted, never the whole look.
create or replace function public.ops_tutorial_reviewed(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_review bigint;
  v_keys jsonb := '{}'::jsonb;
  v_id uuid;
  v_sug uuid;
  v_ref text;
  v_clear boolean;
  v_pictures jsonb;
  v_title text;
  v_detail text;
  v_skipped int := 0;
  v_code int := 0;
  v_suggested int := 0;
  v_looked int := 0;
  v_pictured int := 0;
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
    v_pictures := coalesce(c->'pictures', '[]'::jsonb);
    if not ops.tutorial_pictures_ok(v_pictures) then
      v_pictures := '[]'::jsonb;
      v_skipped := v_skipped + 1;
    end if;
    insert into ops.tutorial_suggestions (kind, tutorial, language, title, detail, review, clear, decision, decided_at, pictures)
    values (c->>'kind', c->>'tutorial', nullif(c->>'language', ''), c->>'title', c->>'detail', v_review, v_clear,
      case when v_clear then 'accepted' end, case when v_clear then now() end, v_pictures)
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

  for c in select * from jsonb_array_elements(coalesce(p->'pictures', '[]'::jsonb)) loop
    v_pictures := coalesce(c->'pictures', '[]'::jsonb);
    v_title := nullif(btrim(c->>'title'), '');
    v_detail := nullif(btrim(c->>'detail'), '');
    if coalesce(c->>'suggestion' !~ '^[0-9a-f-]{36}$', true) or not ops.tutorial_pictures_ok(v_pictures)
       or length(v_title) > 200 or length(v_detail) > 4000 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if jsonb_array_length(v_pictures) = 0 and (v_title is null and v_detail is null or coalesce(c->>'when', 'now') = 'after') then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if coalesce(c->>'when', 'now') = 'after' then
      update ops.tutorial_suggestions set after_pictures = v_pictures where id = (c->>'suggestion')::uuid and fix_state = 'merged';
    else
      -- New words only while it waits for a person and no admin edited it; an admin's own words always stay.
      update ops.tutorial_suggestions set
        pictures = case when jsonb_array_length(v_pictures) > 0 and (decision is null or pictures = '[]'::jsonb) then v_pictures else pictures end,
        title = case when decision is null and edited_at is null then coalesce(v_title, title) else title end,
        detail = case when decision is null and edited_at is null then coalesce(v_detail, detail) else detail end
      where id = (c->>'suggestion')::uuid
        and ((jsonb_array_length(v_pictures) > 0 and (decision is null or pictures = '[]'::jsonb))
          or ((v_title is not null or v_detail is not null) and decision is null and edited_at is null));
    end if;
    if found then v_pictured := v_pictured + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  update ops.tutorial_reviews set looked = v_looked, suggested = v_suggested, code = v_code where id = v_review;
  return jsonb_build_object('review', v_review, 'code', v_code, 'looked', v_looked, 'suggested', v_suggested, 'pictured', v_pictured, 'skipped', v_skipped);
end $$;

revoke all on function public.ops_tutorial_reviewed from public, anon, authenticated;
grant execute on function public.ops_tutorial_reviewed to service_role;
