import type { OrgStub } from './http';
import type { Answer } from './org';
import { canRead, SCOPE_TEXT, type Grant } from './tokens';
import { isRefusal, parseRelease, parseReview, type ApiStatus, type PassageFilter } from './view';

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
  run(args: Record<string, unknown>, g: Grant, org: OrgStub): Promise<Answer<unknown>>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const s = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const LANGUAGE = s('A languageId from list_languages.');
const UNIT = s('A unitId from list_passages.');
const bad = (error: string): Answer<never> => ({ ok: false, status: 400, code: 'bad_request', error });
const str = (v: unknown) => (typeof v === 'string' ? v : '');

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
    description: 'Passages of a language in display order, with status (not_started, drafting, in_review, feedback, approved), the version this token hears, the approved version, where it is released, and listener feedback counts. A token with only read:published sees approved passages alone.',
    inputSchema: obj({
      languageId: LANGUAGE,
      status: s('Only passages with this status.', { enum: ['not_started', 'drafting', 'in_review', 'feedback', 'approved'] }),
      changedSince: s('ISO date-time: only passages with something newer. Use the newest updatedAt you have seen to follow changes.')
    }, ['languageId']),
    allowed: (g) => canRead(g),
    run: (a, g, org) => {
      const filter: PassageFilter = {};
      if (a['status'] !== undefined) filter.status = a['status'] as ApiStatus;
      if (a['changedSince'] !== undefined) {
        const ms = Date.parse(str(a['changedSince']));
        if (Number.isNaN(ms)) return Promise.resolve(bad('changedSince must be an ISO date-time.'));
        filter.changedSince = new Date(ms).toISOString();
      }
      return org.read(g, { op: 'passages', languageId: str(a['languageId']), filter });
    }
  },
  {
    name: 'get_passage',
    description: 'One passage: its latest version\'s audio (links that play for ten minutes, in order), its reviews and, with the read scope, its steps and versions.',
    inputSchema: obj({ languageId: LANGUAGE, unitId: UNIT }, ['languageId', 'unitId']),
    allowed: (g) => canRead(g),
    run: (a, g, org) => org.read(g, { op: 'passage', languageId: str(a['languageId']), unitId: str(a['unitId']) })
  },
  {
    name: 'record_review',
    description: 'Record a review of a passage\'s version, as the token\'s person: listener feedback (kindId "listener", the default, which never clears a step) or a review step in the language\'s flow (a kindId from get_passage steps). needs_changes asks the translator to respond. A review through the API never clears a checkpoint.',
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
  }
];

const reply = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const error = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

const HEADERS = {
  'content-type': 'application/json', 'cache-control': 'no-store',
  'access-control-allow-origin': '*', 'access-control-expose-headers': 'mcp-session-id'
};

async function one(m: Rpc, grant: Grant, org: OrgStub): Promise<object | null> {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return error(null, -32600, 'Invalid request.');
  if (m.id === undefined) return null; // a notification: nothing to answer
  switch (m.method) {
    case 'initialize': {
      const asked = str(m.params?.['protocolVersion']);
      return reply(m.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'langquest', version: '1.0.0' },
        instructions: 'LangQuest holds oral Bible translations: languages, passages recorded as audio, and their reviews. Start with list_languages, then list_passages; get_passage gives playable audio links. Writes are recorded as the person who made this token and are visible to their team.'
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
        ? { content: [{ type: 'text', text: JSON.stringify(out.data, null, 2) }], isError: false }
        : { content: [{ type: 'text', text: `${out.error} (${out.code})` }], isError: true });
    }
    default:
      return error(m.id, -32601, `Method not found: ${m.method}`);
  }
}

export async function handleMcp(request: Request, grant: Grant, org: OrgStub, _url: URL): Promise<Response> {
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
  const answers = (await Promise.all(messages.map((m) => one(m as Rpc, grant, org)))).filter((a) => a !== null);
  if (answers.length === 0) return new Response(null, { status: 202, headers: HEADERS });
  return new Response(JSON.stringify(batch ? answers : answers[0]), { status: 200, headers: HEADERS });
}
