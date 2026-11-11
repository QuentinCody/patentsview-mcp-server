# Patents MCP Server (EPO)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for worldwide patent
data. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

> **The name is historical.** The fleet alias is `patentsview` and the worker is
> `patentsview-mcp-server`, but the upstream is **EPO**. The retained name does not imply
> USPTO coverage or connectivity. See [Naming](#naming) below.

## Two tiers

| | Tier 1 — EPO OPS v3.2 | Tier 2 — EPO Linked Open Data |
|---|---|---|
| Paths | `/published-data`, `/family`, `/legal`, `/classification` | `/lod/*` |
| Endpoint | `https://ops.epo.org/3.2/rest-services` | `https://data.epo.org/linked-data/query` (SPARQL) |
| Credential | **Required** — `EPO_OPS_KEY` + `EPO_OPS_SECRET` | **None** |
| Licence | EPO OPS terms / fair use (≈4 GB per week free) | CC BY 4.0 |

Both tiers authenticate host-side. The V8 isolate only ever calls `api.get(path, params)`
and never sees the Consumer Key or Secret.

Every JSON object the server returns carries `_meta.tier` (`epo-ops` or `epo-lod`), the
upstream URL, the licence, and — for LOD — the exact SPARQL that produced the rows.

### What the keyless tier serves

Existing catalog coverage (the new workflows still require live acceptance):

- EP bibliographic records **in full**: title per language, abstract, applicant / inventor /
  agent names, IPC-inventive symbols, priority, PDF link.
- Related non-EP publication identifiers, with more limited content than EP records.
- The publication ↔ application link, and same-application siblings (the A1/B1 pair).
- DOCDB simple-family member links through the new `/simple-family` workflow.
- The backward citation graph.

### What the keyless tier does NOT serve

This is the honest delta. LOD is **not** an OPS substitute:

- **Non-EP bibliographic content.** A US or JP publication node carries only
  number / date / kind / authority / application. There is **no title and no abstract** for
  any non-EP publication anywhere in LOD.
- **Full text** (claims, description) — not at all.
- **INPADOC legal-status events** — the patent-cliff and FTO signal.
- **The INPADOC family** — `/lod/publication/.../application` gives same-application
  siblings, which is narrower.
- **CQL free-text search** — `/lod/search/title` is an unindexed SPARQL substring scan over
  EP titles only.
- **CPC classification lookup.**

Never report an LOD answer as OPS-grade coverage, and never read an empty `/lod/*` result as
proof a patent does not exist. Legacy LOD routes use a graph-liveness guard, which cannot
certify worldwide absence. New evidence routes keep an explicit `completeness: "unverified"`
even for empty or short pages.

## Credentials (Tier 1)

The EPO developer app is free and self-service.

1. Register at <https://developers.epo.org/user/register>.
2. Confirm the e-mail, log in, open **My Apps**, create an app, and copy the **Consumer Key**
   and **Consumer Secret**.
3. Set them as Worker secrets:

```bash
cd servers/patentsview-mcp-server
npx wrangler secret put EPO_OPS_KEY
npx wrangler secret put EPO_OPS_SECRET
```

Until both are set, every OPS path fails fast with a structured `MISSING_CREDENTIALS` error
that names both variables, the registration URL, the two commands above, and the keyless
alternative. It is **an error**, never an empty or fabricated success — a caller must not be
able to mistake "no credentials" for "no data".

For local development put the same two values in `.dev.vars`.

## Connect

```
https://patentsview-mcp-server.quentincody.workers.dev/mcp
```

```json
{
  "mcpServers": {
    "patentsview": {
      "command": "npx",
      "args": ["mcp-remote", "https://patentsview-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

Locally the server runs at `http://localhost:8852/mcp` (start it with
`./scripts/dev-servers.sh patentsview`).

## Tools

- `patents_search` — discover 19 catalog operations, including three local evidence views
- `patents_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` /
  `searchSpec()`) instead of issuing tool calls one by one
- `patentsview_query_data` — run SQL over large responses auto-staged into a per-session
  SQLite database
- `patentsview_get_schema` — inspect the inferred schema of a staged dataset

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a
`data_access_id` you can query with SQL. Every tool returns both a human-readable `content`
summary and a structured `structuredContent` payload.
All tools have `mcp_` aliases. Staging also supports `patents_query_data` and
`patents_get_schema`, matching the names used by Code Mode instructions.

## Family and applicant evidence

```javascript
const family = await api.get("/lod/publication/EP/1000000/simple-family", {
  kind: "A1", limit: 50, offset: 0
});
return family; // Return the staging handle if __staged is true.
```

Keep three concepts separate: `/application` finds publications of the same application;
`/simple-family` follows EPO's DOCDB family links; OPS `/family` returns INPADOC extended
families. The catalog also exposes the existing authenticated OPS
`/published-data/publication/{format}/{number}/equivalents/biblio` constituent for simple
family bibliography. Family membership alone does not establish current legal status.

`/lod/publication/{authority}/{number}/applicants` and `/lod/search/applicant-evidence`
retain original names, language tags, vCard URIs, address-property evidence and publication
links. The optional `kind` parameter on publication routes narrows the seed publication.
Applicant search accepts `name` and `match: "exact" | "contains"`. All three local routes
accept `limit` (1–200) and `offset` (0–10000) and preserve the full SPARQL response in
`native`, with exact query/tier metadata. Row limits do not count unique applicants or
family members. Pages are ordered but not snapshot-pinned; graph updates can shift them.

`comparison_name` applies Unicode NFKC, whitespace folding and lowercase. It preserves
punctuation and legal-form suffixes and never merges records. EPO vCard hashes identify
source name/address records, not canonical companies; `legal_entity_verified` stays false.
OPS native applicant fields, including name data formats, remain intact for inspection.

Provider references: [DOCDB simple families](https://www.epo.org/en/searching-for-patents/helpful-resources/first-time-here/patent-families/docdb),
[INPADOC extended families](https://www.epo.org/en/searching-for-patents/helpful-resources/first-time-here/patent-families/inpadoc),
[LOD ontology specification](https://link.epo.org/web/Ontology_Spec_v1.01.pdf), and
[OPS reference](https://link.epo.org/web/searching-for-patents/data/en-ops-v3.2-documentation-version-1.3.20.pdf).
Queries use the published HTTP ontology namespace used by the existing server; deployed
namespace and data coverage still require validation. No new 2026 API release was established.

Validation on 2026-09-29: 34 focused tests, 29 existing offline regression checks,
TypeScript/lint and the full suite (8,971 tests; 109 skipped) pass. Affected checks passed
application build/tests, then stopped at GDC Wrangler loopback EPERM. The live MCP probe
requires unavailable approval, and local Wrangler cannot bind to loopback; provider query
results, authenticated equivalents and live staging/SQL acceptance remain pending.

### Keyless examples

```js
// One EP record, keyless. Rows are (publication, property, value, lang).
const r = await api.get('/lod/publication/{authority}/{number}',
                        { authority: 'EP', number: '1000000' });
return r.results.bindings
  .filter(b => b.property.value === 'title')
  .map(b => b.lang.value + ': ' + b.value.value);
```

```js
// Title substring search (EP only) and an exact applicant lookup.
const t = await api.get('/lod/search/title',     { text: 'graphene', limit: 10 });
const a = await api.get('/lod/search/applicant', { name: 'Novartis AG', limit: 10 });
```

`/lod/query` takes an arbitrary SPARQL SELECT. Always include a `LIMIT`: the EPO publishes
the SPARQL endpoint for "occasional use … not designed to provide a backend database
service", and the request aborts at 25 s.

## Naming

One server currently answers to three names, which is a real usability problem for a model:

| Surface | Name |
|---|---|
| Fleet alias / worker | `patentsview` |
| Code Mode tools | `patents_search`, `patents_execute` |
| Staging tools | `patents_query_data`, `patents_get_schema`, plus historical `patentsview_*` aliases |

The aliases support both the Code Mode instructions and existing clients. The Durable
Object binding remains `PATENTSVIEW_DATA_DO`; no storage migration is needed.

## Development

```bash
./scripts/dev-servers.sh patentsview               # run locally (port 8852)
pnpm --filter patentsview-mcp-server run type-check
pnpm --filter patentsview-mcp-server run lint
pnpm --filter patentsview-mcp-server run test:regression   # SKIP_LIVE=1 to skip network checks
pnpm --filter patentsview-mcp-server run deploy
```

`test/structured-content-regression.mjs` covers the credential guard (including that a
credential-less OPS call makes zero network calls), SPARQL literal escaping and input
validation, tier routing, and a live check against the real keyless upstream that asserts a
known bound title and confirms the US-stub gap.

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root
[README](../../README.md) for the full architecture (Code Mode, staging, portals).

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from EPO OPS + Linked Open EP Data and stays under the terms of that source: OPS fair-use policy; Linked Open Data CC BY 4.0.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
