# OpenAPI 3.1 schemas

Copied unchanged from the OpenAPI Initiative, who publish them under the
Apache License 2.0 (https://github.com/OAI/OpenAPI-Specification):

- `schema.json`: https://spec.openapis.org/oas/3.1/schema/2022-10-07
- `dialect.json`: https://spec.openapis.org/oas/3.1/dialect/base
- `meta.json`: https://spec.openapis.org/oas/3.1/meta/base

`agentApi.test.ts` checks the API's OpenAPI document against them
(decisions.md 81). Ajv does not follow `schema.json`'s `$dynamicRef: "#meta"`,
so `openapiCheck.ts` points it at `dialect.json` instead, which is what it
resolves to.
