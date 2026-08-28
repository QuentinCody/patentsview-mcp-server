# Patents MCP Server (EPO)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for worldwide patent
data. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

> **The name is historical.** The fleet alias is `patentsview` and the worker is
> `patentsview-mcp-server`, but the upstream is **not** USPTO PatentsView. PatentsView is
> dead — `api.patentsview.org` 301-redirects to `data.uspto.gov`, `search.patentsview.org`
> is NXDOMAIN, and the successor `api.uspto.gov` is key-gated. This server talks to the
> **EPO** instead. See [Naming](#naming) below.

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

Measured against the live endpoint, with no credential:

- EP bibliographic records **in full**: title per language, abstract, applicant / inventor /
  agent names, IPC-inventive symbols, priority, PDF link.
- The worldwide publication identifier space (~8.17M US publication nodes, plus AT, DE, JP,
  WO, AU, FR and more).
- The publication ↔ application link, and same-application siblings (the A1/B1 pair).
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
proof a patent does not exist. Empty LOD results run through the fleet empty-result guard:
a certified negative is annotated `__guard.verified_empty`, and a dead endpoint throws.

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

- `patents_search` — discover available API operations (Code Mode catalog search, 15 endpoints)
- `patents_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` /
  `searchSpec()`) instead of issuing tool calls one by one
- `patentsview_query_data` — run SQL over large responses auto-staged into a per-session
  SQLite database
- `patentsview_get_schema` — inspect the inferred schema of a staged dataset

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a
`data_access_id` you can query with SQL. Every tool returns both a human-readable `content`
summary and a structured `structuredContent` payload.

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
| Staging tools | `patentsview_query_data`, `patentsview_get_schema` |

A model that discovers `patents_execute` cannot guess that the SQL tool is
`patentsview_query_data`. The tool names are **deliberately left alone here** — renaming
them breaks every client and every saved prompt that already calls them. The recommended fix
is a coordinated fleet-wide rename to a single prefix (`patents_*`, since the upstream is
EPO, not PatentsView), landed together with the registry entries in
`config/mcp-servers.json` and `cf/server/lib/curated/clinical.ts`. The Durable Object binding
`PATENTSVIEW_DATA_DO` must stay as it is — renaming it forces a DO migration.

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
