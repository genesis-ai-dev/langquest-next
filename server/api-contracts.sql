-- Check deployed function identity, not only migration history. A migration
-- once shipped under the same version with incompatible invite arguments.
select signature as missing_contract
from (values
  ('public.issue_invite(text,text,text,text,jsonb,timestamptz)'),
  ('public.issue_invite_v3(text,text,text,text,jsonb,timestamptz,text,integer)'),
  ('public.redeem_invite_v2(text)'),
  ('public.preview_invite(text)'),
  ('public.can_help_sign_in(text)'),
  ('public.create_join_request(text,text,text)'),
  ('public.decide_join_request(text,boolean,text)'),
  ('public.save_profile(text)'),
  ('public.record_user_event(text,text,jsonb)'),
  ('public.get_user_state()'),
  ('public.my_organizations()'),
  ('public.set_partition_visibility(text,text,boolean)'),
  ('public.register_push_token(text)'),
  ('public.delete_my_account()')
) expected(signature)
where to_regprocedure(signature) is null;
