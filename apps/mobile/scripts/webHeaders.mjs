// The web app's response headers (decisions.md 58), as the `_headers` file
// the Worker's static assets serve. Kept apart so a test reads the policy.
//
// - Content security policy from what the app loads: its own files; the
//   database's WebAssembly; the audio worklet and object URLs for recordings
//   (blob:); Supabase over HTTPS and its realtime socket; study images from
//   anywhere on HTTPS. react-native-web writes its styles at run time, so
//   inline styles are allowed; inline scripts are not.
// - No cross-origin isolation headers: the app uses expo-sqlite's async API
//   only, which needs no SharedArrayBuffer, and isolation would block study
//   images from other sites and is not the same in Safari.
// - Hashed bundles never change, so they are cached for good; the page and
//   version.json are always checked.

export function headersFor({ supabaseUrl }) {
  const supabase = new URL(supabaseUrl);
  const wss = `wss://${supabase.host}`;
  const local = supabase.protocol === 'http:' ? ` ws://${supabase.host}` : '';
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    // The reports API is 'self': the Worker serving the page answers it.
    `connect-src 'self' ${supabase.origin} ${wss}${local} blob:`,
    `img-src 'self' data: blob: https:`,
    `media-src 'self' blob: ${supabase.origin}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
  return `/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: microphone=(self), camera=(self), geolocation=()
  Cross-Origin-Opener-Policy: same-origin

/_expo/static/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/index.html
  Cache-Control: no-cache

/version.json
  Cache-Control: no-cache

/.well-known/apple-app-site-association
  Content-Type: application/json
`;
}
