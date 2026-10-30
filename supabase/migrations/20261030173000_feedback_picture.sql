-- A picture with feedback (LAN-198, decision 145 amended): besides the
-- screenshot of the app, a report may carry one picture that the person
-- chose from their phone's files or the browser (a photo, or a screenshot of
-- something else), as a JPEG of at most 1 MB that the app made smaller. It
-- is kept in the row like the screenshot, so deleting the account deletes
-- it with the rest (_delete_account deletes the row) and it goes after a
-- year with it.
--
-- feedback_submit gains p_picture at the end, with a default, so a phone
-- that never sends one calls it as before. The old signature is dropped
-- first, or a call naming only the old arguments would match both.
-- diag.feedback() gains has_picture (its row type changes, so it is dropped
-- and made again), and diag.feedback_picture() reads it.
-- SQL test: server/feedback-smoke.sql.

alter table diag.feedback add column picture bytea check (picture is null or length(picture) <= 1048576);

drop function public.feedback_submit(uuid, text, text, text, jsonb, boolean, text, text, text, int);

-- One report, as the signed-in caller. A resend after a dropped link adds
-- nothing (same id). At most 20 a day per account; past that it is refused
-- with 54000, which the phone keeps and tries again later.
create or replace function public.feedback_submit(
  p_id uuid, p_kind text, p_body text, p_install text, p_context jsonb default '{}',
  p_share_profile boolean default false, p_screenshot text default null,
  p_voice text default null, p_voice_format text default null, p_voice_ms int default null,
  p_picture text default null
) returns boolean
language plpgsql security definer set search_path = public, diag, pg_catalog as $$
declare
  v_actor text := public.caller_id();
  v_shot bytea;
  v_picture bytea;
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
  if p_picture is not null then
    if length(p_picture) > 1400000 then raise exception 'invalid payload: picture too large' using errcode = '22023'; end if;
    begin
      v_picture := decode(p_picture, 'base64');
    exception when others then
      raise exception 'invalid payload: picture' using errcode = '22023';
    end;
    if length(v_picture) > 1048576 or length(v_picture) < 3 or substring(v_picture from 1 for 3) <> '\xffd8ff'::bytea then
      raise exception 'invalid payload: picture' using errcode = '22023';
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
    picture, voice, voice_format, voice_ms)
  values (p_id, v_actor, p_kind, p_body, p_install, diag.feedback_context(p_context), v_name, v_email, v_shot,
    v_picture, v_voice, case when v_voice is not null then p_voice_format end,
    case when v_voice is not null and p_voice_ms between 0 and 120000 then p_voice_ms end)
  on conflict (id) do nothing;
  get diagnostics v_row = row_count;
  perform diag.feedback_prune(50);
  return v_row > 0;
end $$;

drop function diag.feedback(interval, text);

create or replace function diag.feedback(p_since interval default '30 days', p_install text default null)
returns table (
  id uuid, created_at timestamptz, kind text, body text, status text, install_id text, context jsonb,
  has_screenshot boolean, shared_name text, shared_email text, voice_format text, voice_ms int,
  has_picture boolean
)
language sql stable security definer set search_path = diag, pg_catalog as $$
  select f.id, f.created_at, f.kind, f.body,
    case when f.done_at is not null then 'done' when f.seen_at is not null then 'seen' else 'new' end,
    f.install_id, f.context,
    f.screenshot is not null, f.shared_name, f.shared_email, f.voice_format, f.voice_ms,
    f.picture is not null
  from diag.feedback f
  where f.created_at > now() - p_since and (p_install is null or f.install_id = p_install)
  order by f.created_at desc
  limit 500
$$;

create or replace function diag.feedback_picture(p_id uuid) returns bytea
language sql stable security definer set search_path = diag, pg_catalog as $$
  select f.picture from diag.feedback f where f.id = p_id
$$;

revoke all on function public.feedback_submit from public, anon;
grant execute on function public.feedback_submit to authenticated, service_role;
revoke all on function diag.feedback(interval, text) from public;
grant execute on function diag.feedback(interval, text) to diag_reader;
revoke all on function diag.feedback_picture from public;
grant execute on function diag.feedback_picture to diag_reader;
