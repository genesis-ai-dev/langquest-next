-- What the organization's other languages call a book (v1.BookNameSet,
-- decision 74), for naming it in one language: the naming sheet offers
-- them as "What other languages here call it" (demo ADR-042). A phone
-- pulls only the languages it opens (decision 37), so the server answers,
-- as library_template_users does for templates: the latest name in each
-- language stream, as the fold keeps it (latest clock, then event id, a
-- redacted one left out), and only in languages the caller may read
-- (can_read_stream), so a person with a role in one language sees no other.

create or replace function public.language_book_names(p_org text, p_book text)
returns table (language_id text, name text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_actor text := public.caller_id();
begin
  if not public._library_member(p_org, v_actor) then raise exception 'not a member' using errcode = '42501'; end if;
  return query
    select x.stream_id, x.name from (
      select distinct on (e.stream_id) e.stream_id, e.payload->>'name' as name
      from public.events e
      where e.org_id = p_org and e.type = 'v1.BookNameSet' and e.stream_id <> '_org' and e.payload->>'book' = p_book
        and not exists (select 1 from public.events r
                        where r.org_id = e.org_id and r.stream_id = e.stream_id and r.type = 'v1.Redacted' and r.payload->>'eventId' = e.id)
      order by e.stream_id, e.hlc collate "C" desc, e.id collate "C" desc
    ) x
    where public.can_read_stream(p_org, x.stream_id, v_actor);
end $$;
revoke all on function public.language_book_names(text, text) from public, anon;
grant execute on function public.language_book_names(text, text) to authenticated, service_role;
