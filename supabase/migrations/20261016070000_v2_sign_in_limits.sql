-- Signing in with a v2 account: limits per address and overall, counted
-- before v2 is asked (functions/v2-sign-in).
--
-- v2_import_sign_in_try counted only wrong passwords for one email, after
-- v2 had answered, so tries running at once all passed its check, and one
-- caller spraying many emails was never slowed. Every try reaches v2 from
-- the same few servers, so that caller could make v2 refuse everyone. Now
-- v2_import_sign_in_begin counts a try before v2 is asked, under a lock per
-- email: at most 10 an hour for one email, 30 an hour from one address, and
-- 300 in five minutes from everyone. v2_import_sign_in_passed clears an
-- email's count once v2 accepts its password, so a person who mistypes a
-- few times and then gets it right starts afresh.
--
-- v2_import_sign_in_try stays for the function deployed before this one.

alter table v2_import.sign_in_failures add column ip text;
create index sign_in_failures_ip_idx on v2_import.sign_in_failures (ip, at desc) where ip is not null;
create index sign_in_failures_at_idx on v2_import.sign_in_failures (at);

-- Null when this try may go to v2, else which limit stops it: email, address or busy.
create or replace function public.v2_import_sign_in_begin(p_email text, p_ip text)
returns text language plpgsql security definer set search_path = v2_import, public as $$
declare v_email text := lower(p_email);
begin
  perform pg_advisory_xact_lock(hashtext('v2_sign_in:' || v_email));
  delete from v2_import.sign_in_failures where at < now() - interval '1 hour';
  if (select count(*) from v2_import.sign_in_failures where email = v_email) >= 10 then return 'email'; end if;
  if p_ip is not null and (select count(*) from v2_import.sign_in_failures where ip = p_ip) >= 30 then return 'address'; end if;
  if (select count(*) from v2_import.sign_in_failures where at > now() - interval '5 minutes') >= 300 then return 'busy'; end if;
  insert into v2_import.sign_in_failures (email, ip) values (v_email, p_ip);
  return null;
end $$;

create or replace function public.v2_import_sign_in_passed(p_email text)
returns void language sql security definer set search_path = v2_import, public as $$
  delete from v2_import.sign_in_failures where email = lower(p_email);
$$;

revoke all on function public.v2_import_sign_in_begin(text, text) from public, anon, authenticated;
grant execute on function public.v2_import_sign_in_begin(text, text) to service_role;
revoke all on function public.v2_import_sign_in_passed(text) from public, anon, authenticated;
grant execute on function public.v2_import_sign_in_passed(text) to service_role;
