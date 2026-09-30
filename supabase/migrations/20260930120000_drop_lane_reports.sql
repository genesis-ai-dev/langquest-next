-- The dashboard no longer reads projection tables (decision 44, superseding
-- 40). Its Worker keeps a snapshot of each organization and computes the
-- reports there, so the rows the projection worker wrote, and the policy
-- function that guarded them, go.

drop policy if exists lane_reports_read on public.lane_reports;
drop policy if exists lane_report_days_read on public.lane_report_days;
drop table if exists public.lane_report_days;
drop table if exists public.lane_reports;
drop function if exists public.may_view_lane(text, text, text);
