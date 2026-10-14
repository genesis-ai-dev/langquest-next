// i18n-ignore-file: HTTP plumbing; its strings are header names and error messages for the sync layer, never shown.
/**
 * The fetch a phone uses for the database, files and functions: React
 * Native's XMLHttpRequest, reading each answer as text (decisions.md 106).
 *
 * React Native's own fetch keeps every answer in its blob store, and Expo's
 * native fetch keeps it in an object, until the JavaScript heap is next
 * collected. A language kept on disk leaves that heap small, so it is
 * seldom collected, and a big download piled up: Koro Miyan's 40 MB held
 * 80 MB on Android's Java side at once, and a 158 MB language filled its
 * 192 MB limit. Read as text, an answer is handed over and let go.
 */
export function textFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = typeof input === 'string' || input instanceof URL ? null : input;
  const url = request ? request.url : String(input);
  const method = init?.method ?? request?.method ?? 'GET';
  const headers = new Headers(init?.headers ?? request?.headers);
  const signal = init?.signal ?? request?.signal ?? null;
  const body = init?.body ?? null;
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) return reject(aborted());
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort);
    const done = () => signal?.removeEventListener('abort', abort);
    xhr.open(method, url, true);
    headers.forEach((value, name) => xhr.setRequestHeader(name, value));
    xhr.responseType = 'text';
    xhr.onload = () => {
      done();
      resolve(new Response(xhr.responseText, { status: xhr.status, statusText: xhr.statusText, headers: headersOf(xhr.getAllResponseHeaders()) }));
    };
    // The same words React Native's fetch uses, which the sync layer reads as no network (supabaseTransport.ts).
    xhr.onerror = () => { done(); reject(new TypeError('Network request failed')); };
    xhr.ontimeout = () => { done(); reject(new TypeError('Network request failed')); };
    xhr.onabort = () => { done(); reject(aborted()); };
    xhr.send(body as XMLHttpRequestBodyInit | null);
  });
}

function aborted(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/** `name: value` lines, as `getAllResponseHeaders` gives them. */
export function headersOf(raw: string): Headers {
  const out = new Headers();
  for (const line of raw.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0) out.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return out;
}
