-- An issue's card in plain words, written by the issue manager after its work
-- (docs/card-words.md "An issue's card",
-- docs/decisions/2026-11-25-the-issue-manager-writes-the-card-and-a-naive-reader-checks-it.md).
--
-- The watch writes an issue's first lines (Wrong, Known, Next) before anyone looked
-- at the cause. The manager then proves the cause, but its words went only to
-- Details, so a card kept the first guess and hid the choice (LAN-339). The manager
-- now writes `card` in fix.json: a title, what the issue is about, what goes wrong
-- and why, what is known, and the choice with what each option leads to. The
-- dashboard shows it in place of the watch's lines.
--
-- 1. ops.user_issue_fixes.card keeps it (jsonb; the Worker checks its shape first,
--    server/userIssues.ts parseIssueCard).
-- 2. ops_user_issue_fixes_done() takes it; a later record that sends none keeps it.
-- 3. diag.ops_user_issue_fixes() hands it to the dashboard.

alter table ops.user_issue_fixes add column if not exists card jsonb
  check (card is null or (jsonb_typeof(card) = 'object' and length(card::text) <= 4000));

create or replace function public.ops_user_issue_fixes_done(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  f jsonb;
  v_kept int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  for f in select value from jsonb_array_elements(coalesce(p->'fixes', '[]'::jsonb)) loop
    insert into ops.user_issue_fixes (issue, decision, reason, why, pr, verdict, model, effort, summary, cause, proof, review, twins, before_jpg, after_jpg, run_url, card)
    values (f->>'issue', f->>'decision', nullif(f->>'reason', ''), nullif(f->>'why', ''), (f->>'pr')::int, nullif(f->>'verdict', ''),
            nullif(f->>'model', ''), nullif(f->>'effort', ''), nullif(f->>'summary', ''), nullif(f->>'cause', ''), nullif(f->>'proof', ''),
            nullif(f->>'review', ''), nullif(f->>'twins', ''), decode(nullif(f->>'before', ''), 'base64'), decode(nullif(f->>'after', ''), 'base64'), p->>'runUrl',
            case when jsonb_typeof(f->'card') = 'object' then f->'card' end)
    on conflict (issue) do update set decision = excluded.decision, reason = excluded.reason, why = excluded.why, pr = excluded.pr,
      verdict = coalesce(excluded.verdict, ops.user_issue_fixes.verdict), model = coalesce(excluded.model, ops.user_issue_fixes.model),
      effort = coalesce(excluded.effort, ops.user_issue_fixes.effort), summary = coalesce(excluded.summary, ops.user_issue_fixes.summary),
      cause = coalesce(excluded.cause, ops.user_issue_fixes.cause), proof = coalesce(excluded.proof, ops.user_issue_fixes.proof),
      review = coalesce(excluded.review, ops.user_issue_fixes.review), twins = coalesce(excluded.twins, ops.user_issue_fixes.twins),
      -- The pictures stay while the record is about the same pull request, and go with another one.
      before_jpg = case when excluded.before_jpg is not null then excluded.before_jpg when excluded.pr is not distinct from ops.user_issue_fixes.pr then ops.user_issue_fixes.before_jpg end,
      after_jpg = case when excluded.after_jpg is not null then excluded.after_jpg when excluded.pr is not distinct from ops.user_issue_fixes.pr then ops.user_issue_fixes.after_jpg end,
      -- A later record that sends no card keeps the one the manager wrote.
      card = coalesce(excluded.card, ops.user_issue_fixes.card),
      run_url = excluded.run_url, at = now();
    v_kept := v_kept + 1;
  end loop;
  return v_kept;
end $$;
revoke all on function public.ops_user_issue_fixes_done from public, anon, authenticated;
grant execute on function public.ops_user_issue_fixes_done to service_role;

-- For the dashboard: by issue, the record of the last 90 days, and `pictures`: each problem sent
-- from help mode among the issue's kinds that came with a screenshot or a picture (the page asks
-- for the file itself by its id, as its Feedback list does). Never who sent it.
create or replace function diag.ops_user_issue_fixes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(x.issue, jsonb_build_object('decision', x.decision, 'reason', x.reason, 'why', x.why, 'pr', x.pr,
      'verdict', x.verdict, 'model', x.model, 'effort', x.effort, 'summary', x.summary, 'cause', x.cause, 'proof', x.proof,
      'review', x.review, 'twins', x.twins, 'card', x.card, 'runUrl', x.run_url, 'at', x.at, 'before', x.before_jpg is not null, 'beforeAfter', x.after_jpg is not null,
      'pictures', coalesce((
        select jsonb_agg(jsonb_build_object('id', f.id, 'screenshot', f.screenshot is not null, 'picture', f.picture is not null) order by f.created_at)
        from ops.user_issues u join diag.feedback f on u.key = 'feedback:' || f.id::text
        where u.issue = x.issue and (f.screenshot is not null or f.picture is not null)), '[]'::jsonb))), '{}'::jsonb)
  from ops.user_issue_fixes x
  where x.at > now() - interval '90 days'
$$;
revoke all on function diag.ops_user_issue_fixes from public;
grant execute on function diag.ops_user_issue_fixes to diag_reader;
