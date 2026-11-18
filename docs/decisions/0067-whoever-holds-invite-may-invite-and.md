# 67. Whoever holds Invite may invite and admit people, with or without an email of their own

Date: 2026-10-07 · By: Carl Sauder · Status: accepted

Reason: supersedes 54's "looked-after accounts cannot invite". Since 59,
joining by QR with no email is how most people in the field get an
account, admins included, so the rule left whole organizations where
nobody could invite anyone or see a join request. A local test showed it:
a looked-after admin's Inbox and Members never asked for the request that
the server had already shown them in an Inbox row, because the session had
removed Invite (`deriveSession`) and both screens gate on it. The rule
added no protection for inviting: both kinds of account stay signed in on
the phone, an email is not yet proven, and a wrong invite or admission is
undone by removing the member, which the log records. So Invite is decided
by permissions alone: `deriveSession` keeps the role's privileges, and
`issue_invite_v3` no longer refuses looked-after accounts
(`20261007180000_looked_after_accounts_invite.sql`). Join requests already
went by permission on the server (`join_requests` read policy,
`decide_join_request`, the projection worker's Inbox rows). Helping
someone sign in is unchanged and still needs an account with its own email
(`may_help_sign_in`): a sign-in code signs a helper in as another person
and can sign that person out everywhere else, a power over someone's
account and recorded work rather than over a team, and it is its own
decision.
Reverse if: invites or admissions from looked-after accounts are abused,
or a stolen phone is used to let people in; then require a proven email
(or a second admin) for those actions rather than removing them from the
role.
