# Sourced by run.sh, web.sh, stop-hook.sh and gate.sh. Journeys only ever talk
# to the local Supabase stack, so its URL and keys come from `supabase status`,
# never from the encrypted env files: no .env.keys is needed here or in CI.
# Returns non-zero when the stack is not running.
_sb="$(npx supabase status -o json 2>/dev/null)" || return 1
eval "$(printf '%s' "$_sb" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const j = JSON.parse(s);
    const vars = { EXPO_PUBLIC_SUPABASE_URL: j.API_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY: j.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: j.SERVICE_ROLE_KEY };
    for (const [k, v] of Object.entries(vars)) if (v) console.log(`export ${k}=${JSON.stringify(v)}`);
  });')" || return 1
unset _sb
[ -n "${EXPO_PUBLIC_SUPABASE_URL:-}" ]
