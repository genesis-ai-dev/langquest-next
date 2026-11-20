# 86. The access-token API is described by an OpenAPI 3.1 document the tests hold it to

Date: 2026-10-12 · By: Carl Sauder · Status: accepted

Reason: the API (70) had a written guide, a list of routes at `GET /api/v1`
and MCP's argument schemas, but nothing a machine could read for the REST
routes, and the response shapes lived only in TypeScript types and prose.
Partners want to generate clients and check what they get; a description
nobody checks drifts. Carl chose an OpenAPI document tied to the code by
tests. Chosen:
- OpenAPI 3.1, written as a TypeScript object in
  `apps/web/worker/agent/openapi.ts` and served without a token at
  `GET /api/v1/openapi.json`. It uses the code's own constants (statuses,
  includes, scopes, kind states, page sizes and limits), so they cannot
  drift. `docs/agent-api.md` stays the guide; the document is the
  reference, and wins on details.
- It covers what apps and agents call. `/session/*` and `/links/*`, which
  only LangQuest's own pages call, with no CORS, are left out.
- Its object schemas are open, so a field added later does not break a
  generated client. The tests close them.
- `apps/web/test/agentApi.test.ts` passes every request it makes through
  `openapiCheck.ts`: the route must be in the document, the response must
  match the schema for its status with no unlisted field, and a request the
  API took must match the request schema. Every operation must be reached
  by some test, and the document must pass the OpenAPI Initiative's own
  schema (copied into `apps/web/test/oas31`). Ajv, a JSON Schema
  validator, is a development dependency of `apps/web` for this; it never
  ships in the Worker.
Rejected: a hand-written YAML file (nothing ties it to the code); types
generated from the document, or the document from the types (a build step
and a generator's opinions for one API of 19 operations); deriving MCP's
argument schemas from it (MCP takes arrays where REST repeats a query
parameter, so they would differ anyway).
Reverse if: the document is often updated only because the tests fail
rather than ahead of the change (then generate it from the types), or a
second API needs one (then a shared generator).
