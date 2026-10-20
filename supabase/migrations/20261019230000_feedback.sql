-- Feedback from help mode (decisions.md 144): a problem or an idea, typed or
-- said (a voice note) by the person, with the install id that diagnostics
-- already use, and, when they turn it on, a screenshot and their name and
-- email.
--
-- Not a diagnostics record: those are counts and codes and never carry what
-- someone typed, names or screenshots (docs/diagnostics.md). Feedback is its
-- own table in the diag schema, so it shares that schema's walls: not exposed
-- by PostgREST, read only through report functions granted to diag_reader,
-- written only through public.feedback_submit.
--
-- The screenshot (a JPEG of about 720 px wide, at most 1 MB) and the voice
-- note (a phone's AAC, or 16 kHz WAV from the web, at most two minutes and
-- 4 MB) are kept in the row, so deleting an account deletes them with one
-- statement and no storage policy or signing key is involved. Kept 365 days, pruned on each
-- submit. _delete_account is restated whole, as `create or replace`, from
-- 20261016110000_delete_account_v2_import.sql's, adding the feedback.
-- SQL test: server/feedback-smoke.sql.

create table diag.feedback (
  id uuid primary key,
  created_at timestamptz not null default now(),
  -- The account that sent it, from the session, never from the phone.
  profile_id text not null,
  kind text not null check (kind in ('bug', 'idea')),
  body text not null check (length(body) <= 4000),
  install_id text not null check (length(install_id) <= 64),
  -- The diag context keys, plus the screen it was sent from and the app's language.
  context jsonb not null default '{}',
  -- What the person chose to send; null unless they turned it on.
  shared_name text,
  shared_email text,
  screenshot bytea check (screenshot is null or length(screenshot) <= 1048576),
  voice bytea check (voice is null or length(voice) <= 4194304),
  voice_format text check (voice_format in ('m4a', 'wav')),
  voice_ms int check (voice_ms between 0 and 120000),
  -- When someone at LangQuest read it and when they finished with it; the
  -- admin page's New, Seen and Done come from these, as content reports'
  -- resolution does (no status column, AGENTS.md).
  seen_at timestamptz,
  done_at timestamptz,
  -- Words, a voice note, or both.
  check (length(btrim(body)) > 0 or voice is not null),
  check ((voice is null) = (voice_format is null))
);
create index diag_feedback_created_idx on diag.feedback (created_at desc);
create index diag_feedback_profile_idx on diag.feedback (profile_id, created_at);
create index diag_feedback_install_idx on diag.feedback (install_id);
revoke all on diag.feedback from public, anon, authenticated;

-- ---- writing -------------------------------------------------------------------------------

-- What a phone may say about itself besides the install id: the diag context
-- keys, the screen id and the app's language, each a short token.
create or replace function diag.feedback_context(p jsonb) returns jsonb
language plpgsql immutable set search_path = diag, pg_catalog as $$
declare
  v jsonb := '{}';
  k text;
begin
  if jsonb_typeof(p) is distinct from 'object' then return v; end if;
  for k in select jsonb_array_elements_text(diag.schema()->'context') union all select unnest(array['screen', 'uiLanguage']) loop
    continue when k = 'installId';
    if diag.is_token(p->>k) then v := v || jsonb_build_object(k, p->>k); end if;
  end loop;
  return v;
end $$;

create or replace function diag.feedback_prune(p_limit int default 200) returns int
language plpgsql security definer set search_path = diag, pg_catalog as $$
declare v_n int;
begin
  delete from diag.feedback where id in (
    select id from diag.feedback where created_at < now() - interval '365 days' order by created_at limit p_limit
  );
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- One report, as the signed-in caller. A resend after a dropped link adds
-- nothing (same id). At most 20 a day per account; past that it is refused
-- with 54000, which the phone keeps and tries again later.
create or replace function public.feedback_submit(
  p_id uuid, p_kind text, p_body text, p_install text, p_context jsonb default '{}',
  p_share_profile boolean default false, p_screenshot text default null,
  p_voice text default null, p_voice_format text default null, p_voice_ms int default null
) returns boolean
language plpgsql security definer set search_path = public, diag, pg_catalog as $$
declare
  v_actor text := public.caller_id();
  v_shot bytea;
  v_voice bytea;
  v_name text;
  v_email text;
  v_row int;
begin
  if v_actor is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_id is null then raise exception 'invalid payload: id' using errcode = '22023'; end if;
  if exists (select 1 from diag.feedback f where f.id = p_id) then return false; end if;
  if p_kind is null or p_kind not in ('bug', 'idea') then raise exception 'invalid payload: kind' using errcode = '22023'; end if;
  if p_body is null or length(p_body) > 4000 or (length(btrim(p_body)) = 0 and p_voice is null) then
    raise exception 'invalid payload: body' using errcode = '22023';
  end if;
  if not diag.is_token(p_install) or length(p_install) > 64 then
    raise exception 'invalid payload: installId' using errcode = '22023';
  end if;
  if p_screenshot is not null then
    if length(p_screenshot) > 1400000 then raise exception 'invalid payload: screenshot too large' using errcode = '22023'; end if;
    begin
      v_shot := decode(p_screenshot, 'base64');
    exception when others then
      raise exception 'invalid payload: screenshot' using errcode = '22023';
    end;
    -- A JPEG starts FF D8 FF.
    if length(v_shot) > 1048576 or length(v_shot) < 3 or substring(v_shot from 1 for 3) <> '\xffd8ff'::bytea then
      raise exception 'invalid payload: screenshot' using errcode = '22023';
    end if;
  end if;
  if p_voice is not null then
    if p_voice_format is null or p_voice_format not in ('m4a', 'wav') or length(p_voice) > 5600000 then
      raise exception 'invalid payload: voice' using errcode = '22023';
    end if;
    begin
      v_voice := decode(p_voice, 'base64');
    exception when others then
      raise exception 'invalid payload: voice' using errcode = '22023';
    end;
    -- An MP4 (AAC) names its kind at byte 4 ("ftyp"); a WAV starts RIFF....WAVE.
    if length(v_voice) > 4194304 or length(v_voice) < 12
       or (p_voice_format = 'm4a' and substring(v_voice from 5 for 4) <> 'ftyp'::bytea)
       or (p_voice_format = 'wav' and (substring(v_voice from 1 for 4) <> 'RIFF'::bytea or substring(v_voice from 9 for 4) <> 'WAVE'::bytea)) then
      raise exception 'invalid payload: voice' using errcode = '22023';
    end if;
  end if;
  if (select count(*) from diag.feedback f where f.profile_id = v_actor and f.created_at > now() - interval '1 day') >= 20 then
    raise exception 'too much feedback today' using errcode = '54000';
  end if;
  if p_share_profile then
    select p.display_name into v_name from public.profiles p where p.id = v_actor;
    select u.email into v_email from auth.users u where u.id::text = v_actor;
  end if;

  insert into diag.feedback (id, profile_id, kind, body, install_id, context, shared_name, shared_email, screenshot,
    voice, voice_format, voice_ms)
  values (p_id, v_actor, p_kind, p_body, p_install, diag.feedback_context(p_context), v_name, v_email, v_shot,
    v_voice, case when v_voice is not null then p_voice_format end,
    case when v_voice is not null and p_voice_ms between 0 and 120000 then p_voice_ms end)
  on conflict (id) do nothing;
  get diagnostics v_row = row_count;
  perform diag.feedback_prune(50);
  return v_row > 0;
end $$;

-- Seen or done, from the admin page (its Worker holds the service role).
create or replace function public.feedback_set_status(p_id uuid, p_status text) returns boolean
language plpgsql security definer set search_path = diag, pg_catalog as $$
declare v_row int;
begin
  if p_status is null or p_status not in ('new', 'seen', 'done') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update diag.feedback set
    seen_at = case when p_status = 'new' then null else coalesce(seen_at, now()) end,
    done_at = case when p_status = 'done' then coalesce(done_at, now()) else null end
  where id = p_id;
  get diagnostics v_row = row_count;
  return v_row > 0;
end $$;

-- ---- reading (diag_reader: npm run diag -- feedback, and the admin page) ---------------------

create or replace function diag.feedback(p_since interval default '30 days', p_install text default null)
returns table (
  id uuid, created_at timestamptz, kind text, body text, status text, install_id text, context jsonb,
  has_screenshot boolean, shared_name text, shared_email text, voice_format text, voice_ms int
)
language sql stable security definer set search_path = diag, pg_catalog as $$
  select f.id, f.created_at, f.kind, f.body,
    case when f.done_at is not null then 'done' when f.seen_at is not null then 'seen' else 'new' end,
    f.install_id, f.context,
    f.screenshot is not null, f.shared_name, f.shared_email, f.voice_format, f.voice_ms
  from diag.feedback f
  where f.created_at > now() - p_since and (p_install is null or f.install_id = p_install)
  order by f.created_at desc
  limit 500
$$;

create or replace function diag.feedback_screenshot(p_id uuid) returns bytea
language sql stable security definer set search_path = diag, pg_catalog as $$
  select f.screenshot from diag.feedback f where f.id = p_id
$$;

-- The voice note; its format is diag.feedback()'s voice_format (audio/mp4 for m4a, audio/wav).
create or replace function diag.feedback_voice(p_id uuid) returns bytea
language sql stable security definer set search_path = diag, pg_catalog as $$
  select f.voice from diag.feedback f where f.id = p_id
$$;

-- ---- account deletion ------------------------------------------------------------------------

create or replace function public._delete_account(p_actor text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  m record;
begin
  if p_actor is null or p_actor = '' then raise exception 'no account' using errcode = '22023'; end if;
  select u.email into v_email from auth.users u where u.id::text = p_actor;

  for m in select om.org_id, om.scope_key, om.scope_level, om.language_id
             from public.org_memberships om
            where om.profile_id = p_actor and not om.removed loop
    perform public._append_event_as('accountdeleted:' || p_actor || ':' || m.scope_key,
      m.org_id, '_org', 'v1.MemberRemoved', 'service', 'server',
      jsonb_build_object('profileId', p_actor, 'scope', jsonb_strip_nulls(jsonb_build_object(
        'level', m.scope_level, 'languageId', m.language_id))));
  end loop;

  delete from public.push_receipts r using public.push_tokens t
    where r.token = t.token and t.profile_id = p_actor;
  delete from public.push_tokens where profile_id = p_actor;
  delete from public.notifications where profile_id = p_actor;
  delete from public.join_requests where profile_id = p_actor;
  delete from public.profiles where id = p_actor;
  if v_email is not null then
    update public.invites set email = null where lower(email) = lower(v_email);
  end if;
  delete from diag.records where delivered_by = p_actor;
  delete from diag.installs where profile_id = p_actor;
  -- Feedback they sent, with its screenshots, voice notes and the name and email they shared.
  delete from diag.feedback where profile_id = p_actor;
  update storage.objects set owner = null, owner_id = null where owner_id = p_actor;
  delete from public.user_blocks where blocker_id = p_actor or blocked_id = p_actor;
  update public.content_reports set reporter_id = null where reporter_id = p_actor;
  -- What the v2 import knows of this account: what Welcome back listed, and a link from a v2 person to it, turned off so the import
  -- names the v2 person again rather than an account that is gone.
  delete from v2_import.arrivals where profile_id = p_actor;
  update v2_import.people_links set active = false, email = null, confirmed_at = now() where next_id = p_actor;
  if v_email is not null then delete from v2_import.sign_in_failures where email = lower(v_email); end if;

  delete from auth.users where id::text = p_actor;
end $$;

-- ---- grants ----------------------------------------------------------------------------------

revoke all on function diag.feedback_context from public;
revoke all on function diag.feedback_prune from public;
revoke all on function diag.feedback(interval, text) from public;
revoke all on function diag.feedback_screenshot from public;
revoke all on function diag.feedback_voice from public;
grant execute on function diag.feedback(interval, text) to diag_reader;
grant execute on function diag.feedback_screenshot to diag_reader;
grant execute on function diag.feedback_voice to diag_reader;

revoke all on function public.feedback_submit from public, anon;
grant execute on function public.feedback_submit to authenticated, service_role;
revoke all on function public.feedback_set_status from public, anon, authenticated;
grant execute on function public.feedback_set_status to service_role;
