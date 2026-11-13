-- LAN-229 (decisions.md 253): an organization's own Bible, uploaded as USFM
-- files on the web, is two library document formats: `usfmBible@1` (name,
-- language, numbering, rights, the books) and `usfmBook@1` (one book's verses
-- and its file). _library_store, from 20261030110000_library_labels.sql's,
-- plus the two formats. Nothing else changes: a document's shape is checked
-- by the app before it is published (core `validateDoc`) and its hash by this
-- function, and publishing is the admin's events like any library item
-- (Manage Reference at the organization's level).

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
  if coalesce(v_format, '') not in ('template@1', 'template@2', 'flow@1', 'study@1', 'study@2', 'collection@1', 'material@1', 'source@1', 'sourceBook@1', 'timing@1', 'versification@1', 'names@1', 'labels@1', 'usfmBible@1', 'usfmBook@1') then
    raise exception 'unknown document format %', coalesce(v_format, '(none)') using errcode = '22023';
  end if;
  if v_format <> 'versification@1' or v_doc ? 'deps' then
    if jsonb_typeof(v_doc->'deps') is distinct from 'array' then raise exception 'deps must be a list of hashes' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(v_doc->'deps') d where not public._is_hash(d)) then
      raise exception 'deps must be a list of hashes' using errcode = '22023';
    end if;
    v_deps := array(select distinct jsonb_array_elements_text(v_doc->'deps'));
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
