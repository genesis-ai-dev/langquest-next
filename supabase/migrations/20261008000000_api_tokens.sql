-- Access tokens for apps and agents (docs/agent-api.md, decisions.md 73).
--
-- A token belongs to one person in one organization and is narrowed by
-- scopes and, optionally, a list of languages. Only its SHA-256 is kept, as
-- for invites. The app's Worker is the only reader and writer (service
-- role): row-level security is on with no policies, and there are no
-- functions, so nothing here is reachable with the public key or a
-- person's session (decision 64). What a token may do is decided per
-- request from the person's privileges in the log, never stored here.

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id text not null check (length(org_id) between 1 and 200),
  -- Deleting the account (decision 46) deletes its tokens.
  profile_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (
    cardinality(scopes) > 0 and scopes <@ array['read:published', 'read', 'feedback', 'publish']::text[]),
  -- Null: every language the person may view.
  language_ids text[] check (language_ids is null or cardinality(language_ids) between 1 and 500),
  -- 'page': made on the connect page; 'device': an app asked and a person approved.
  created_via text not null check (created_via in ('page', 'device')),
  -- What the app called itself when it asked; unverified.
  client_name text check (client_name is null or length(client_name) between 1 and 120),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);

create index api_tokens_owner on public.api_tokens (org_id, profile_id, created_at desc);

alter table public.api_tokens enable row level security;

-- An app's request for a token (OAuth 2.0 device authorization, RFC 8628).
-- The app keeps the device code secret and polls with it; a person sees
-- the user code on the connect page and approves. The approved token's
-- secret is the device code itself, so no plaintext secret is ever stored:
-- the token row takes the device code's hash.
create table public.api_device_grants (
  id uuid primary key default gen_random_uuid(),
  device_code_hash text not null unique check (device_code_hash ~ '^[0-9a-f]{64}$'),
  user_code text not null unique check (user_code ~ '^[B-DF-HJ-NP-TV-XZ]{4}-[B-DF-HJ-NP-TV-XZ]{4}$'),
  client_name text not null check (length(client_name) between 1 and 120),
  requested_scopes text[] not null check (
    cardinality(requested_scopes) > 0
    and requested_scopes <@ array['read:published', 'read', 'feedback', 'publish']::text[]),
  requested_org_id text check (requested_org_id is null or length(requested_org_id) between 1 and 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_polled_at timestamptz,
  approved_at timestamptz,
  denied_at timestamptz,
  token_id uuid references public.api_tokens (id) on delete set null
);

create index api_device_grants_expiry on public.api_device_grants (expires_at);

alter table public.api_device_grants enable row level security;

revoke all on public.api_tokens, public.api_device_grants from public, anon, authenticated;
grant select, insert, update, delete on public.api_tokens, public.api_device_grants to service_role;
