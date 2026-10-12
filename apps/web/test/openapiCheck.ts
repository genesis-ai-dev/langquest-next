import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { openApi } from '../worker/agent/openapi';

/**
 * Holds the API to its OpenAPI document (decisions.md 81). agentApi.test.ts
 * passes every request it makes through `check`: the route must be in the
 * document, the response must match the document's schema for its status,
 * and a request the API took must match the document's request schema.
 * Objects are closed here (the published document leaves them open), so a
 * field the API sends must be listed. `uncovered` names the operations no
 * test reached.
 */

type Schema = Record<string, unknown>;
type Operation = { requestBody?: { content?: Record<string, { schema: Schema }> }; responses: Record<string, { content?: Record<string, { schema: Schema }> }> };

/** Routes only LangQuest's own pages call; the document leaves them out. */
const INTERNAL = ['/session', '/links'];
const METHODS = ['get', 'put', 'post', 'delete'] as const;

export const doc = openApi('https://lq.test') as { paths: Record<string, Partial<Record<(typeof METHODS)[number], Operation>>>; components: { schemas: Record<string, Schema> } };

/** Every object with listed properties takes no others. */
function closed(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closed);
  if (!node || typeof node !== 'object') return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, closed(v)]));
  const type = out['type'];
  const isObject = type === 'object' || (Array.isArray(type) && type.includes('object'));
  if (isObject && out['properties'] && out['additionalProperties'] === undefined) out['additionalProperties'] = false;
  return out;
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat('date-time', (s: string) => /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s)));
ajv.addFormat('binary', true);
ajv.addSchema(closed(doc) as Schema, 'api');

const pointer = (...segments: string[]) => 'api#/' + segments.map((s) => encodeURIComponent(s.replace(/~/g, '~0').replace(/\//g, '~1'))).join('/');
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function validate(at: string, value: unknown): string | null {
  let v = validators.get(at);
  if (!v) validators.set(at, (v = ajv.compile({ $ref: at })));
  if (v(value)) return null;
  // Name the field, so "must NOT have additional properties" says which one.
  return (v.errors ?? []).map((e) => `body${e.instancePath} ${e.message}${'additionalProperty' in e.params ? `: ${String(e.params['additionalProperty'])}` : ''}`).join('; ');
}

/** Templates with the most fixed text first, so …/{unitId}/reviews wins over …/{unitId}. Unit ids and keys may hold slashes. */
const templates = Object.keys(doc.paths)
  .map((t) => ({
    t,
    re: new RegExp(`^${t.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(unitId|key)\}/g, '(.+)').replace(/\{[^}]+\}/g, '([^/]+)')}$`),
    fixed: t.replace(/\{[^}]+\}/g, '').length
  }))
  .sort((a, b) => b.fixed - a.fixed);

const reached = new Set<string>();

/** Why this exchange disagrees with the document, or null when it agrees. */
export function check(method: string, path: string, status: number, body: unknown, sent: unknown): string | null {
  const route = (path.split('?')[0] ?? '').replace(/^\/api\/v1/, '') || '/';
  if (INTERNAL.some((p) => route === p || route.startsWith(`${p}/`))) return null;
  const m = method.toLowerCase() as (typeof METHODS)[number];
  const hit = templates.find((x) => x.re.test(route));
  const op = hit ? doc.paths[hit.t]![m] : undefined;
  if (!hit || !op) return status === 404 || status === 405 || (method === 'OPTIONS' && status === 204) ? null : `${method} ${route} answered ${status} but is not in the OpenAPI document`;
  reached.add(`${m} ${hit.t}`);
  const answer = op.responses[String(status)] ? String(status) : 'default';
  const response = op.responses[answer];
  if (!response) return `${method} ${hit.t} answered ${status}, which the document does not list`;
  const where = [`${method} ${hit.t} ${status}`];
  if (response.content?.['application/json']) {
    const bad = validate(pointer('paths', hit.t, m, 'responses', answer, 'content', 'application/json', 'schema'), body);
    if (bad) return `${where}: response does not match: ${bad}`;
  } else if (body !== null) {
    return `${where}: the document says no body, and one came`;
  }
  const takes = op.requestBody?.content?.['application/json'];
  if (status < 300 && takes && sent !== undefined && !(sent instanceof Uint8Array)) {
    const bad = validate(pointer('paths', hit.t, m, 'requestBody', 'content', 'application/json', 'schema'), sent);
    if (bad) return `${where}: the API took a request the document refuses: ${bad}`;
  }
  return null;
}

/** Operations in the document that no request has reached yet. */
export const uncovered = () =>
  Object.entries(doc.paths).flatMap(([t, item]) => METHODS.filter((m) => item[m]).map((m) => `${m} ${t}`)).filter((k) => !reached.has(k));

/** Compile every schema in the document, so a malformed one fails here rather than at a partner. */
export function compileAll(): void {
  for (const name of Object.keys(doc.components.schemas)) ajv.compile({ $ref: pointer('components', 'schemas', name) });
}

/** Why the document is not valid OpenAPI 3.1 (the OpenAPI Initiative's own schema, in ./oas31), or null. */
export function openApiProblems(): string | null {
  const read = (f: string) => readFileSync(new URL(`./oas31/${f}`, import.meta.url), 'utf8');
  const meta = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  meta.addSchema(JSON.parse(read('meta.json')) as Schema);
  meta.addSchema(JSON.parse(read('dialect.json')) as Schema);
  // Ajv does not follow $dynamicRef "#meta"; it resolves to the dialect, so point there.
  const schema = JSON.parse(read('schema.json').replaceAll('"$dynamicRef": "#meta"', '"$ref": "https://spec.openapis.org/oas/3.1/dialect/base"')) as Schema;
  const served = JSON.parse(JSON.stringify(doc)) as Schema;
  return meta.validate(schema, served) ? null : (meta.errors ?? []).slice(0, 10).map((e) => `${e.instancePath} ${e.message}`).join('; ');
}
