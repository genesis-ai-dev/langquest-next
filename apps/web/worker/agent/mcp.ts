import type { OrgStub } from './http';
import type { Answer } from './org';
import { canRead, canReadValues, SCOPE_TEXT, type Grant } from './tokens';
import {
  API_STATUSES, isRefusal, PASSAGE_INCLUDES, PASSAGES_PAGE, PASSAGES_PAGE_MAX, parseExternalValue, parsePassageQuery, parseRelease, parseReview, TEAM_ONLY, type ExternalValueFilter
} from './view';

/**
 * The same API as Model Context Protocol tools, so an agent (Claude, ChatGPT,
 * any MCP client) connects with one URL and the token as a bearer header.
 * Streamable HTTP without sessions or streams: every POST carries one
 * JSON-RPC message or a batch and gets JSON back.
 */

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
/** One request must not tie up the organization's object; clients send one message at a time anyway. */
const MAX_BATCH = 20;

interface Rpc {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Shown only when the token may use it. */
  allowed(g: Grant): boolean;
  /** Its answer holds external values, which get their app's name (http.ts withAppNames). */
  labels?: boolean;
  run(args: Record<string, unknown>, g: Grant, org: OrgStub): Promise<Answer<unknown>>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const s = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const LANGUAGE = s('A languageId from list_languages.');
const UNIT = s('A unitId from list_passages.');
const bad = (error: string): Answer<never> => ({ ok: false, status: 400, code: 'bad_request', error });
const str = (v: unknown) => (typeof v === 'string' ? v : '');

const KEY = s('A key your app chose: segments of letters, digits and . _ ~ : @ + - joined by /, at most 256 characters. Start it with your app\'s own name, such as org.example.app/plays/…');

const TOOLS: Tool[] = [
  {
    name: 'whoami',
    description: 'What this token is: its organization, scopes and languages.',
    inputSchema: obj({}),
    allowed: () => true,
    run: async (_a, g) => ({ ok: true, data: { orgId: g.orgId, scopes: g.scopes.map((x) => `${x}: ${SCOPE_TEXT[x]}`), languageIds: g.languageIds ?? 'every language the token\'s owner can see' } })
  },
  {
    name: 'list_languages',
    description: 'The languages this token can open, and what it can do in each.',
    inputSchema: obj({}),
    allowed: (g) => canRead(g),
    run: (_a, g, org) => org.read(g, { op: 'languages' })
  },
  {
    name: 'list_passages',
    description: 'Passages of a language in display order, a page at a time ({ passages, nextAfter }; pass nextAfter as after for the next page, null means no more), with status (not_started, drafting, in_review, feedback, approved), the version this token hears (recorded or written, the step that made it if one did, and what steps added to it), the approved version, where it is released, and listener feedback counts. include adds get_passage\'s fields to every passage, so one call can answer, say, where every passage in review stands. A token with only read:published sees approved passages alone.',
    inputSchema: obj({
      languageId: LANGUAGE,
      status: s('Only passages with this status.', { enum: [...API_STATUSES] }),
      changedSince: s('ISO date-time: only passages with something newer. Use the newest updatedAt you have seen to follow changes.'),
      unitIds: { type: 'array', items: { type: 'string' }, maxItems: PASSAGES_PAGE_MAX, description: 'Only these passages (still in display order); ids that do not exist or this token cannot see are left out.' },
      include: {
        type: 'array', items: { type: 'string', enum: [...PASSAGE_INCLUDES] }, uniqueItems: true,
        description: `Fields of get_passage to add to each passage. audio: playable links; text: the version's words, with verses; reviews; steps: where it is in the review flow; requests: work asked for, forYou marking the token person's; versions; made: back translations and other things made beside a version or added to it. ${TEAM_ONLY.join(', ')} need the read scope.`
      },
      limit: { type: 'integer', minimum: 1, maximum: PASSAGES_PAGE_MAX, description: `Passages per page; ${PASSAGES_PAGE} when left out.` },
      after: s('The nextAfter of the page before.')
    }, ['languageId']),
    allowed: (g) => canRead(g),
    run: (a, g, org) => {
      const query = parsePassageQuery(a);
      return isRefusal(query) ? Promise.resolve({ ok: false, ...query }) : org.read(g, { op: 'passages', languageId: str(a['languageId']), query });
    }
  },
  {
    name: 'get_passage',
    description: 'One passage: its version\'s audio (links that play for ten minutes, in order) and words (a written version\'s own, or words a step added to a recording), its reviews and, with the read scope, its steps (each kind\'s kindId, and whether a review through this API counts there), the requests not done yet (forYou marks the ones asked of this token\'s person), its versions and what was made from them (made). For several passages, or only some of this, use list_passages with unitIds and include.',
    inputSchema: obj({ languageId: LANGUAGE, unitId: UNIT }, ['languageId', 'unitId']),
    allowed: (g) => canRead(g),
    run: (a, g, org) => org.read(g, { op: 'passage', languageId: str(a['languageId']), unitId: str(a['unitId']) })
  },
  {
    name: 'record_review',
    description: 'Record a review of a passage\'s version, as the token\'s person: listener feedback (kindId "listener", the default, which never clears a step) or a review step in the language\'s flow (a kindId from get_passage steps). To answer a request, send its kindId: listener feedback leaves the request open. needs_changes asks the translator to respond. A review through the API never clears a checkpoint.',
    inputSchema: obj({
      languageId: LANGUAGE, unitId: UNIT,
      outcome: s('looks_good or needs_changes.', { enum: ['looks_good', 'needs_changes'] }),
      kindId: s('listener (default) or a kind in the flow.'),
      comment: s('What the reviewer said.'),
      reviewerId: s('Your own id for who is giving it; defaults to "agent". One answer per reviewer, version, kind and outcome.'),
      reviewerName: s('Shown to the team as who gave it.'),
      takeId: s('The version heard; the latest when left out.')
    }, ['languageId', 'unitId', 'outcome']),
    allowed: (g) => g.scopes.includes('review'),
    run: (a, g, org) => {
      const input = parseReview({ reviewerId: 'agent', ...a });
      return isRefusal(input) ? Promise.resolve({ ok: false, ...input })
        : org.write(g, { op: 'review', languageId: str(a['languageId']), unitId: str(a['unitId']), input });
    }
  },
  {
    name: 'report_release',
    description: 'Say where a passage\'s approved version is published (live: true, with the channel, such as "Every Language app"), or that a version was taken down (live: false).',
    inputSchema: obj({
      languageId: LANGUAGE, unitId: UNIT, channel: s('Where it is published, at most 60 characters.'), live: { type: 'boolean' },
      url: s('An https link to it there.'), takeId: s('The version; the approved one when left out.')
    }, ['languageId', 'unitId', 'channel', 'live']),
    allowed: (g) => g.scopes.includes('release'),
    run: (a, g, org) => {
      const input = parseRelease(a);
      return isRefusal(input) ? Promise.resolve({ ok: false, ...input })
        : org.write(g, { op: 'release', languageId: str(a['languageId']), unitId: str(a['unitId']), input });
    }
  },
  {
    name: 'set_external_value',
    description: 'Store your app\'s own value with a language under a key you choose, as the token\'s person; the newest write to a key wins. LangQuest keeps it and never acts on it. data is a JSON object of at most 4 KB, or null to delete the key. Every token in the organization can read it.',
    inputSchema: obj({
      languageId: LANGUAGE, key: KEY,
      data: { type: ['object', 'null'], description: 'The value: a JSON object, or null to delete the key.' }
    }, ['languageId', 'key', 'data']),
    allowed: (g) => g.scopes.includes('external_values'),
    labels: true,
    run: (a, g, org) => {
      if (a['data'] === null) return org.write(g, { op: 'externalValue', languageId: str(a['languageId']), key: str(a['key']), data: null });
      const input = parseExternalValue(a);
      return isRefusal(input) ? Promise.resolve({ ok: false, ...input })
        : org.write(g, { op: 'externalValue', languageId: str(a['languageId']), key: str(a['key']), data: input.data });
    }
  },
  {
    name: 'get_external_values',
    description: 'Values third-party apps stored with a language, each with who wrote it: one key, or every key (by key, 500 at a time; pass the answer\'s nextAfter as after for more). With changedSince, deleted keys come back with data null.',
    inputSchema: obj({
      languageId: LANGUAGE, key: s('One key; leave out to list.'),
      keyPrefix: s('Only keys that start with this.'),
      changedSince: s('ISO date-time: only values written after it.'),
      after: s('The nextAfter of the previous answer.')
    }, ['languageId']),
    allowed: (g) => canReadValues(g),
    labels: true,
    run: (a, g, org) => {
      const languageId = str(a['languageId']);
      if (a['key'] !== undefined) return org.read(g, { op: 'externalValue', languageId, key: str(a['key']) });
      const filter: ExternalValueFilter = {};
      if (a['keyPrefix'] !== undefined) filter.keyPrefix = str(a['keyPrefix']);
      if (a['after'] !== undefined) filter.after = str(a['after']);
      if (a['changedSince'] !== undefined) {
        const ms = Date.parse(str(a['changedSince']));
        if (Number.isNaN(ms)) return Promise.resolve(bad('changedSince must be an ISO date-time.'));
        filter.changedSince = new Date(ms).toISOString();
      }
      return org.read(g, { op: 'externalValues', languageId, filter });
    }
  }
];

const reply = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const error = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

const HEADERS = {
  'content-type': 'application/json', 'cache-control': 'no-store',
  'access-control-allow-origin': '*', 'access-control-expose-headers': 'mcp-session-id'
};

/** Adds each external value's app name (http.ts withAppNames). */
type Labeler = (data: unknown) => Promise<unknown>;

async function one(m: Rpc, grant: Grant, org: OrgStub, label: Labeler): Promise<object | null> {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return error(null, -32600, 'Invalid request.');
  if (m.id === undefined) return null; // a notification: nothing to answer
  switch (m.method) {
    case 'initialize': {
      const asked = str(m.params?.['protocolVersion']);
      return reply(m.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'langquest', version: '1.0.0' },
        instructions: 'LangQuest holds oral Bible translations: languages, passages recorded as audio or written, and their reviews. Start with list_languages, then list_passages; get_passage gives playable audio links and the words. Writes are recorded as the person who made this token and are visible to their team.'
      });
    }
    case 'ping':
      return reply(m.id, {});
    case 'tools/list':
      return reply(m.id, { tools: TOOLS.filter((t) => t.allowed(grant)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === m.params?.['name']);
      if (!tool || !tool.allowed(grant)) return error(m.id, -32602, `No tool named ${str(m.params?.['name'])} for this token.`);
      const args = (m.params?.['arguments'] ?? {}) as Record<string, unknown>;
      const out = await tool.run(args, grant, org);
      return reply(m.id, out.ok
        ? { content: [{ type: 'text', text: JSON.stringify(tool.labels ? await label(out.data) : out.data, null, 2) }], isError: false }
        : { content: [{ type: 'text', text: `${out.error} (${out.code})` }], isError: true });
    }
    default:
      return error(m.id, -32601, `Method not found: ${m.method}`);
  }
}

export async function handleMcp(request: Request, grant: Grant, org: OrgStub, _url: URL, label: Labeler = async (d) => d): Promise<Response> {
  if (request.method === 'GET') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } });
  if (request.method === 'DELETE') return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: HEADERS });
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return new Response(JSON.stringify(error(null, -32700, 'Parse error.')), { status: 400, headers: HEADERS });
  }
  const batch = Array.isArray(parsed);
  const messages: unknown[] = batch ? (parsed as unknown[]) : [parsed];
  if (messages.length > MAX_BATCH) return new Response(JSON.stringify(error(null, -32600, `At most ${MAX_BATCH} messages in a batch.`)), { status: 400, headers: HEADERS });
  const answers = (await Promise.all(messages.map((m) => one(m as Rpc, grant, org, label)))).filter((a) => a !== null);
  if (answers.length === 0) return new Response(null, { status: 202, headers: HEADERS });
  return new Response(JSON.stringify(batch ? answers : answers[0]), { status: 200, headers: HEADERS });
}
