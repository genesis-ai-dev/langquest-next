-- The public roadmap (docs/decisions/2026-11-27-a-public-roadmap-that-anyone-can-answer.md, docs/roadmap.md):
-- app.langquest.org/roadmap shows what the LangQuest team works on now, plans and considers, and what it
-- finished. Anyone can say how important an item is, write what they need and leave an email, or suggest
-- a new item. The ops dashboard's Roadmap page adds and changes the items and reads what people sent.
--
-- 1. ops.roadmap_items: each item, in one of five states. Its picture is kept in the row, small.
-- 2. ops.roadmap_notes: what people sent: a vote on an item (importance, with words and an email if they
--    wrote them), or a suggestion (no item yet), which an admin turns into an item, adds to one or hides.
--    Each row is deleted a year after it was sent (ops.roadmap_expire, pg_cron langquest-purge-roadmap).
-- 3. ops_roadmap_list(), ops_roadmap_picture() and ops_roadmap_send() serve the public page through the
--    app's Worker (service role); the Worker limits how often one address may send.
-- 4. ops_roadmap_item_save() and ops_roadmap_suggestion_decide() take a tap from the dashboard (the service
--    role, after apps/web/worker/opsActions.ts checked the person).
-- 5. diag.ops_roadmap() hands everything, emails too, to the dashboard. The public page never sees an email.
-- 6. Claude's read-only logins (docs/production-reads.md) never read an email. agent_reader reads what
--    people wrote only through masked.roadmap_notes, with emails, phone numbers and addresses taken out.

create table if not exists ops.roadmap_items (
  id uuid primary key default gen_random_uuid(),
  -- progress, planned, considering: the roadmap's three parts; done: the Done tab; hidden: off the page.
  state text not null check (state in ('progress', 'planned', 'considering', 'done', 'hidden')),
  title text not null check (length(btrim(title)) between 1 and 120 and title = btrim(title)),
  body text not null default '' check (length(body) <= 2000),
  -- A small picture for the item's card, as the dashboard made it (at most 960 by 420, WebP or JPEG).
  picture text check (picture is null or (length(picture) <= 300000 and picture ~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$')),
  -- The Linear issue the work is in, for the team; the public page does not show it.
  issue text check (issue is null or issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  -- When it went to done: the Done tab's date and order.
  done_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  check ((state = 'done') = (done_at is not null) or state = 'hidden')
);
create index if not exists roadmap_items_state on ops.roadmap_items (state, created_at);
alter table ops.roadmap_items enable row level security;

create table if not exists ops.roadmap_notes (
  id uuid primary key default gen_random_uuid(),
  -- The item it is about; null for a suggestion that no admin has added to an item yet.
  item uuid references ops.roadmap_items (id) on delete cascade,
  -- 0 not important, 1 nice to have, 2 important, 3 critical.
  importance smallint not null check (importance between 0 and 3),
  words text check (words is null or (length(words) between 1 and 2000 and words = btrim(words))),
  email text check (email is null or (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  -- The page's language when it was sent (an app language code).
  language text not null check (language ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?$'),
  at timestamptz not null default now(),
  -- true: sent with Suggest, as a new item. It stays true after an admin adds it to an item.
  suggestion boolean not null default false,
  -- A suggestion's state: new until an admin adds it to an item (added) or hides it (hidden).
  state text not null default 'added' check (state in ('new', 'added', 'hidden')),
  decided_by uuid,
  decided_at timestamptz,
  check (not suggestion or words is not null),
  check (suggestion or item is not null),
  check (state <> 'new' or item is null)
);
create index if not exists roadmap_notes_item on ops.roadmap_notes (item, at desc);
create index if not exists roadmap_notes_new on ops.roadmap_notes (at desc) where state = 'new';
create index if not exists roadmap_notes_at on ops.roadmap_notes (at);
alter table ops.roadmap_notes enable row level security;

-- The default privileges give both read-only logins every new ops table. The item's words and picture
-- are the public page's, written by the team; a note's email is personal, and its words are what a
-- person typed.
revoke select on ops.roadmap_notes from claude_reader, agent_reader;
grant select (id, item, importance, words, language, at, suggestion, state, decided_by, decided_at) on ops.roadmap_notes to claude_reader;
grant select (id, item, importance, language, at, suggestion, state, decided_by, decided_at) on ops.roadmap_notes to agent_reader;
create or replace view masked.roadmap_notes as
  select id, item, importance, masked.personal(words) as words, email is not null as has_contact, language, at, suggestion, state, decided_at
    from ops.roadmap_notes;
grant select on masked.roadmap_notes to agent_reader, claude_reader;

-- The most votes and suggestions the page takes in a day, from everyone together, so a flood cannot fill the table.
create or replace function ops.roadmap_day_max() returns int language sql immutable as $$ select 1000 $$;

-- For the public page: every item that is not hidden, in its part's order, without its issue or its picture's bytes
-- (`picture` is the picture's version, for its address, or null). The newest 50 done items.
create or replace function public.ops_roadmap_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'state', i.state, 'title', i.title, 'body', i.body,
      'picture', case when i.picture is null then null else floor(extract(epoch from i.updated_at))::bigint end, 'doneAt', i.done_at)
    order by i.state, coalesce(i.done_at, i.created_at) desc), '[]'::jsonb)
  from (
    select * from ops.roadmap_items where state in ('progress', 'planned', 'considering')
    union all
    (select * from ops.roadmap_items where state = 'done' order by done_at desc limit 50)
  ) i
$$;
revoke all on function public.ops_roadmap_list from public, anon, authenticated;
grant execute on function public.ops_roadmap_list to service_role;

-- For the public page: an item's picture, or null when it has none or is hidden.
create or replace function public.ops_roadmap_picture(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select picture from ops.roadmap_items where id = p_id and state <> 'hidden'
$$;
revoke all on function public.ops_roadmap_picture from public, anon, authenticated;
grant execute on function public.ops_roadmap_picture to service_role;

-- From the public page: a vote on an item (p_item), or a suggestion (p_item null, words needed).
-- Answers ok, not_found (no such item, or it is hidden or done) or full (the day's sends are used up).
create or replace function public.ops_roadmap_send(p_item uuid, p_importance int, p_words text, p_email text, p_language text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_words text := nullif(btrim(coalesce(p_words, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if p_item is not null and not exists (select 1 from ops.roadmap_items where id = p_item and state in ('progress', 'planned', 'considering')) then
    return 'not_found';
  end if;
  if (select count(*) from ops.roadmap_notes where at > now() - interval '1 day') >= ops.roadmap_day_max() then
    return 'full';
  end if;
  insert into ops.roadmap_notes (item, importance, words, email, language, suggestion, state)
  values (p_item, p_importance, v_words, v_email, p_language, p_item is null, case when p_item is null then 'new' else 'added' end);
  return 'ok';
end $$;
revoke all on function public.ops_roadmap_send from public, anon, authenticated;
grant execute on function public.ops_roadmap_send to service_role;

-- From the dashboard: an item made (no id) or changed. A picture key that is absent keeps the picture; null
-- removes it. Going to done sets when; leaving done clears it. Answers the item's id, or null when no item has that id.
create or replace function public.ops_roadmap_item_save(p jsonb, p_by uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_state text := p->>'state';
  v_issue text := nullif(btrim(coalesce(p->>'issue', '')), '');
begin
  if v_id is null then
    insert into ops.roadmap_items (state, title, body, picture, issue, done_at, created_by, updated_by)
    values (v_state, btrim(p->>'title'), coalesce(p->>'body', ''), p->>'picture', v_issue,
            case when v_state = 'done' then now() end, p_by, p_by)
    returning id into v_id;
    return v_id;
  end if;
  update ops.roadmap_items set
    state = v_state, title = btrim(p->>'title'), body = coalesce(p->>'body', ''), issue = v_issue,
    picture = case when p ? 'picture' then p->>'picture' else picture end,
    done_at = case when v_state = 'done' then coalesce(done_at, now()) when v_state = 'hidden' then done_at end,
    updated_at = now(), updated_by = p_by
  where id = v_id;
  return case when found then v_id end;
end $$;
revoke all on function public.ops_roadmap_item_save from public, anon, authenticated;
grant execute on function public.ops_roadmap_item_save to service_role;

-- From the dashboard: a new suggestion made into a new item (new; the item is under consideration, its title the
-- suggestion's first words), added to an item (add, p_item), or hidden (hide). Answers the item's id for new and add,
-- 'hidden', or 'not_found' when the suggestion is not new or the item does not exist.
create or replace function public.ops_roadmap_suggestion_decide(p_id uuid, p_decision text, p_item uuid, p_by uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_words text;
  v_title text;
  v_item uuid := p_item;
begin
  select words into v_words from ops.roadmap_notes where id = p_id and state = 'new' for update;
  if not found then return 'not_found'; end if;
  if p_decision = 'hide' then
    update ops.roadmap_notes set state = 'hidden', decided_by = p_by, decided_at = now() where id = p_id;
    return 'hidden';
  end if;
  if p_decision = 'new' then
    v_title := btrim(split_part(v_words, E'\n', 1));
    if length(v_title) > 120 then v_title := btrim(left(v_title, 117)) || '...'; end if;
    insert into ops.roadmap_items (state, title, body, created_by, updated_by)
    values ('considering', v_title, left(v_words, 2000), p_by, p_by) returning id into v_item;
  elsif p_decision <> 'add' or v_item is null or not exists (select 1 from ops.roadmap_items where id = v_item) then
    return 'not_found';
  end if;
  update ops.roadmap_notes set item = v_item, state = 'added', decided_by = p_by, decided_at = now() where id = p_id;
  return v_item::text;
end $$;
revoke all on function public.ops_roadmap_suggestion_decide from public, anon, authenticated;
grant execute on function public.ops_roadmap_suggestion_decide to service_role;

-- Each night: what people sent a year ago or more goes, with its words and email (the privacy policy says so).
create or replace function ops.roadmap_expire() returns int
language sql security definer set search_path = '' as $$
  with gone as (delete from ops.roadmap_notes where at < now() - interval '1 year' returning 1)
  select count(*)::int from gone
$$;
revoke all on function ops.roadmap_expire from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'langquest-purge-roadmap';
  perform cron.schedule('langquest-purge-roadmap', '53 3 * * *', $job$ select ops.roadmap_expire(); $job$);
end $$;

-- For the dashboard's Roadmap page: every item with its counts and what people wrote (the newest 200 of each),
-- and the suggestions no admin has decided on yet (the newest 200). Emails are here: the page is for Global
-- Viewers only, and no public page reads this.
create or replace function diag.ops_roadmap() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'state', i.state, 'title', i.title, 'body', i.body, 'issue', i.issue,
        'picture', case when i.picture is null then null else floor(extract(epoch from i.updated_at))::bigint end,
        'doneAt', i.done_at, 'at', i.created_at, 'updatedAt', i.updated_at,
        'counts', (select jsonb_build_array(count(*) filter (where n.importance = 0), count(*) filter (where n.importance = 1),
                                            count(*) filter (where n.importance = 2), count(*) filter (where n.importance = 3))
                   from ops.roadmap_notes n where n.item = i.id),
        'notes', (select coalesce(jsonb_agg(jsonb_build_object('importance', n.importance, 'words', n.words, 'email', n.email,
                                                               'language', n.language, 'at', n.at, 'suggestion', n.suggestion) order by n.at desc), '[]'::jsonb)
                  from (select * from ops.roadmap_notes n where n.item = i.id and (n.words is not null or n.email is not null)
                        order by n.at desc limit 200) n)
      ) order by i.state, coalesce(i.done_at, i.created_at) desc) from ops.roadmap_items i), '[]'::jsonb),
    'suggestions', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'importance', n.importance, 'words', n.words,
        'email', n.email, 'language', n.language, 'at', n.at) order by n.at desc)
      from (select * from ops.roadmap_notes where state = 'new' order by at desc limit 200) n), '[]'::jsonb),
    'day', (select count(*) from ops.roadmap_notes where at > now() - interval '1 day'),
    'dayMax', ops.roadmap_day_max()
  )
$$;
revoke all on function diag.ops_roadmap from public;
grant execute on function diag.ops_roadmap to diag_reader;

-- The dashboard's two new actions, in its log (ops.actions). Other branches change this list too, so this
-- adds the two names to the list that is there, whatever it holds.
do $$
declare
  v_def text;
  v_names text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c where c.conrelid = 'ops.actions'::regclass and c.conname = 'actions_action_check';
  if v_def is null then raise exception 'ops.actions has no actions_action_check to add to'; end if;
  -- The check is written either as ARRAY['a'::text, ...] or, after 20261124013000, as '{a,b}'::text[].
  if v_def ~ '''\{' then
    v_names := string_to_array(substring(v_def from '''\{([^}]*)\}'''), ',');
  else
    select array_agg(m[1]) into v_names from regexp_matches(v_def, '''([a-z_]+)''', 'g') m;
  end if;
  if coalesce(array_length(v_names, 1), 0) < 10 then raise exception 'read only % names from %', coalesce(array_length(v_names, 1), 0), v_def; end if;
  v_names := array(select distinct x from unnest(coalesce(v_names, '{}'::text[]) || array['roadmap_item', 'roadmap_suggestion']) x order by x);
  alter table ops.actions drop constraint if exists actions_action_check;
  execute format('alter table ops.actions add constraint actions_action_check check (action = any (%L::text[]))', v_names);
end $$;
