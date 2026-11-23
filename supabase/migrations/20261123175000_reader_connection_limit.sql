-- The read gate's two logins may hold 5 connections, not 3. Hyperdrive keeps
-- at least 5 connections for each config (Cloudflare's minimum), and
-- `npm run secrets -- production` now sets each read config to 5
-- (scripts/secrets.mjs HYPERDRIVES). With a limit of 3, Postgres refused the
-- 4th connection ("too many connections for role claude_reader", 2026-11-23
-- 17:35Z) and every read through the gate timed out.
alter role claude_reader connection limit 5;
alter role agent_reader connection limit 5;
