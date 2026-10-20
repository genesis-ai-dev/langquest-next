-- Translation helps as library documents (core helpDocs.ts): a set of notes,
-- questions or key-word links listing its books (`helps@1`), one book of
-- them (`helpBook@1`), the word alignment of a Bible book (`alignment@1`)
-- and the contents of a set of articles (`contents@1`).
--
-- A source's books may name their alignment (`books[].alignment`). The
-- source's own `deps` leaves it out, so phones from before alignments still
-- read the source (core validateDoc holds deps to what a format refers to);
-- here it counts as a dependency all the same, so whoever may read the
-- source may read its alignments, and adopting or following it copies them.
--
-- _library_store is restated whole from 20261009120000_book_by_book.sql's,
-- with these formats and that dependency.

create or replace function public._library_store(p_org text, p_body text)
returns text language plpgsql set search_path = '' as $$
declare v_doc jsonb; v_format text; v_deps text[] := '{}'; v_hash text; r record;
begin
  if p_body is null then raise exception 'a document is required' using errcode = '22023'; end if;
  if octet_length(p_body) > 4194304 then raise exception 'document too large (max 4 MB)' using errcode = '54000'; end if;
  begin
    v_doc := p_body::jsonb;
  exception when others then
    raise exception 'a document must be JSON' using errcode = '22023';
  end;
  if jsonb_typeof(v_doc) <> 'object' then raise exception 'a document must be a JSON object' using errcode = '22023'; end if;
  v_format := v_doc->>'format';
  if coalesce(v_format, '') not in ('template@1', 'template@2', 'flow@1', 'study@1', 'study@2', 'collection@1', 'material@1', 'source@1', 'sourceBook@1', 'timing@1', 'versification@1',
                                    'helps@1', 'helpBook@1', 'alignment@1', 'contents@1') then
    raise exception 'unknown document format %', coalesce(v_format, '(none)') using errcode = '22023';
  end if;
  if v_format <> 'versification@1' or v_doc ? 'deps' then
    if jsonb_typeof(v_doc->'deps') is distinct from 'array' then raise exception 'deps must be a list of hashes' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(v_doc->'deps') d where not public._is_hash(d)) then
      raise exception 'deps must be a list of hashes' using errcode = '22023';
    end if;
    v_deps := array(select distinct jsonb_array_elements_text(v_doc->'deps'));
  end if;
  -- A source's alignments travel with it, though its deps leave them out.
  if v_format = 'source@1' and jsonb_typeof(v_doc->'books') = 'array' then
    if exists (select 1 from jsonb_array_elements(v_doc->'books') b where b ? 'alignment' and not public._is_hash(b->'alignment')) then
      raise exception 'an alignment must be a hash' using errcode = '22023';
    end if;
    v_deps := array(select distinct x from unnest(v_deps || array(
      select b->>'alignment' from jsonb_array_elements(v_doc->'books') b where b ? 'alignment')) as x);
  end if;
  if exists (select 1 from unnest(v_deps) dep
             where not exists (select 1 from public.library_document_access a where a.org_id = p_org and a.hash = dep)) then
    raise exception 'a document it depends on is not readable by this organization' using errcode = '42501';
  end if;
  v_hash := encode(sha256(convert_to(p_body, 'UTF8')), 'hex');
  insert into public.library_documents (hash, format, body, bytes, deps)
  values (v_hash, v_format, p_body, octet_length(p_body), v_deps)
  on conflict (hash) do nothing;
  insert into public.library_document_access (org_id, hash) values (p_org, v_hash) on conflict do nothing;
  -- A version published offline may have reached the log before its document.
  for r in select v.item_id from public.library_versions v where v.org_id = p_org and v.doc_hash = v_hash loop
    perform public._library_fan_out(p_org, r.item_id, v_hash);
  end loop;
  return v_hash;
end $$;
