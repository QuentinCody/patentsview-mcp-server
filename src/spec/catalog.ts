import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";
import { evidenceEndpoints, evidenceWorkflows } from "./evidence";

/**
 * EPO patent data, served in TWO TIERS behind one Code Mode surface.
 *
 * Tier 1 — EPO Open Patent Services (OPS) v3.2, paths `/published-data`, `/family`,
 * `/legal`, `/classification`. OAuth2 client-credentials handled host-side (lib/http.ts).
 * Serves DOCDB worldwide bibliographic data, INPADOC families + legal status, EP/WO
 * full-text, and CQL search. NEEDS EPO_OPS_KEY + EPO_OPS_SECRET.
 *
 * Tier 2 — EPO Linked Open Data (LOD), paths `/lod/*`. NO CREDENTIAL AT ALL
 * (lib/lod.ts + lib/lod-queries.ts), CC BY 4.0. Serves EP bibliographic records, the
 * worldwide publication identifier space, the application link and the citation graph.
 * It is a genuine but PARTIAL substitute — the "KEYLESS TIER" note below states exactly
 * what it cannot answer.
 *
 * The V8 isolate only ever calls api.get(path, params) and never sees the Consumer
 * Key/Secret. Replaces the dead USPTO PatentsView upstream (the fleet alias is historical).
 */
export const epoOpsCatalog: ApiCatalog = {
	name: "EPO Open Patent Services (OPS) v3.2 + EPO Linked Open Data",
	baseUrl: "https://ops.epo.org/3.2/rest-services",
	version: "3.2",
	auth: "oauth2 (OPS paths) / none (/lod/* paths)",
	endpointCount: 19,
	notes:
		"AUTH: OAuth2 client-credentials, handled host-side. Set EPO_OPS_KEY + EPO_OPS_SECRET (register a free app at https://developers.epo.org/user/register, then `npx wrangler secret put EPO_OPS_KEY` / `EPO_OPS_SECRET`). The isolate never sees credentials. When either secret is unset, every OPS path fails FAST with a MISSING_CREDENTIALS error naming both variables — it never returns an empty or fabricated result.\n" +
		"KEYLESS TIER (`/lod/*`): EPO Linked Open Data (https://data.epo.org/linked-data/query, SPARQL, CC BY 4.0) needs no credential. Coverage differs from OPS.\n" +
		"  IT SERVES: EP bibliographic records, related non-EP publication identifiers, application links, DOCDB simple-family links and a citation graph. Local evidence workflows preserve source RDF and record applicant comparison hints without canonical company merging.\n" +
		"  IT DOES NOT SERVE, and OPS does: (a) non-EP bibliographic CONTENT — a US/JP publication node carries only number/date/kind/authority/application, with NO title and NO abstract; (b) full text (claims/description) at all; (c) INPADOC legal-status events; (d) the INPADOC family endpoint (`/lod/publication/.../application` gives same-application siblings, which is narrower); (e) CQL free-text search; (f) CPC classification lookup.\n" +
		"  NEVER report an LOD answer as OPS-grade coverage, and never read an empty `/lod/*` result as proof a patent does not exist — check `_meta.coverage_caveat` and `__guard` on the response.\n" +
		"TIER PROVENANCE: every JSON object this server returns carries `_meta.tier` = `epo-ops` or `epo-lod`, plus the upstream URL, the license and (for LOD) the exact SPARQL that produced the rows. Report the tier alongside any claim.\n" +
		'LOD FAIR USE: the EPO publishes the SPARQL endpoint for "occasional use … not designed to provide a backend database service". Every curated `/lod/*` query is bounded; if you use `/lod/query` directly, include a LIMIT. Unfiltered scans take minutes and abort at 25 s.\n' +
		"RESPONSES: Deeply nested JSON under `ops:world-patent-data`. Request Accept: application/json (default). Some constituents (images, certain full-text) return XML/PDF — those arrive as a text string.\n" +
		"DOCUMENT NUMBER FORMATS: two input formats —\n" +
		"  • epodoc (recommended): country+number, e.g. `EP1000000`, `US20070178709`, `WO2008000000`\n" +
		"  • docdb: dotted country.number.kind, e.g. `US.20070178709.A1`, `EP.1000000.A1`\n" +
		"CQL SEARCH (/published-data/search, `q` param): fields ti=title, ab=abstract, ta=title+abstract, txt=title+abstract+inventor+applicant, in=inventor, pa=applicant, pn=publication-number, ap=application-number, pr=priority, num=any number, ipc=IPC class, cpc=CPC class, pd=publication-date.\n" +
		"  Operators: and / or / not; phrase in quotes; date range via `within`, e.g. q=`ti=graphene and pd within \"20200101 20231231\"`.\n" +
		"PAGINATION: published-data search supports the Range query parameter (1-25 by default, at most 100/page, maximum retrievable result window 2000); EPO documents X-OPS-Range as its HTTP header equivalent. Inspect native counts/ranges; a bounded response does not prove complete coverage.\n" +
		"QUOTA / FAIR USE: free tier ≈ 4 GB traffic/week. Over-quota or burst traffic returns HTTP 403 `<error><code>403</code><message>… Fair Use …</message></error>` — back off and retry. Fine for interactive agent use; NOT for bulk corpus download.\n" +
		"COVERAGE: bibliographic + family + legal is worldwide (DOCDB/INPADOC, 100+ authorities). Full-text (claims/description) is mainly EP and WO; US/other full-text is thinner. For US assignment + PTAB validity data, pair with a USPTO source.\n" +
		"WORKFLOW: search (CQL) → collect publication numbers → fetch /biblio, /abstract, /claims per number → /family for INPADOC siblings → /legal for status events.",
	endpoints: [
		...evidenceEndpoints,
		{
			method: "GET",
			path: "/published-data/search",
			summary:
				"CQL search across EPO's worldwide collection. Returns publication references (country/doc-number/kind) + total-result-count. Use `q` with CQL field syntax.",
			category: "search",
			queryParams: [
				{ name: "q", type: "string", required: true, description: "CQL query, e.g. `ti=apixaban`, `pa=\"bristol-myers squibb\"`, `txt=car-t and pd within \"20200101 20231231\"`" },
				{ name: "Range", type: "string", required: false, description: "Supported range query parameter, e.g. `1-25`; max 100/page and at most 2000 retrievable results." },
			],
		},
		{
			method: "GET",
			path: "/published-data/search/biblio",
			summary:
				"Same CQL search as /search but returns full bibliographic data for each hit in one call (title, abstract, applicants, inventors, IPC/CPC, dates) — fewer round-trips.",
			category: "search",
			queryParams: [
				{ name: "q", type: "string", required: true, description: "CQL query (see /published-data/search)" },
				{ name: "Range", type: "string", required: false, description: "Result range, e.g. `1-25` (max 100)" },
			],
		},
		{
			method: "GET",
			path: "/published-data/publication/{format}/{number}/biblio",
			summary:
				"Bibliographic data for one publication: title, abstract, applicants, inventors, priorities, IPC/CPC classifications, publication/application dates, citations.",
			category: "publication",
			queryParams: [
				{ name: "format", type: "string", required: true, description: "Reference format: `epodoc` or `docdb` (path param)" },
				{ name: "number", type: "string", required: true, description: "Publication number, e.g. `EP1000000` (epodoc) (path param)" },
			],
		},
		{
			method: "GET",
			path: "/published-data/publication/{format}/{number}/abstract",
			summary: "Abstract text for one publication.",
			category: "publication",
			queryParams: [
				{ name: "format", type: "string", required: true, description: "`epodoc` or `docdb` (path param)" },
				{ name: "number", type: "string", required: true, description: "Publication number (path param)" },
			],
		},
		{
			method: "GET",
			path: "/published-data/publication/{format}/{number}/claims",
			summary: "Full claims text. Available mainly for EP and WO publications.",
			category: "fulltext",
			queryParams: [
				{ name: "format", type: "string", required: true, description: "`epodoc` or `docdb` (path param)" },
				{ name: "number", type: "string", required: true, description: "Publication number (path param)" },
			],
		},
		{
			method: "GET",
			path: "/published-data/publication/{format}/{number}/description",
			summary: "Full specification/description text. Available mainly for EP and WO publications.",
			category: "fulltext",
			queryParams: [
				{ name: "format", type: "string", required: true, description: "`epodoc` or `docdb` (path param)" },
				{ name: "number", type: "string", required: true, description: "Publication number (path param)" },
			],
		},
		{
			method: "GET",
			path: "/family/publication/docdb/{number}/biblio",
			summary:
				"INPADOC extended-family members with bibliographic data. Distinct from DOCDB simple-family equivalents; family membership alone does not establish legal status or freedom to operate.",
			category: "family",
			queryParams: [
				{ name: "number", type: "string", required: true, description: "docdb-format number, e.g. `US.20070178709.A1` (path param)" },
			],
		},
		{
			method: "GET",
			path: "/legal/publication/docdb/{number}",
			summary:
				"INPADOC legal-status events for a publication (grants, lapses, transfers, oppositions, extensions) — the lifecycle signal behind patent-cliff and FTO analysis.",
			category: "legal",
			queryParams: [
				{ name: "number", type: "string", required: true, description: "docdb-format number (path param)" },
			],
		},
		{
			method: "GET",
			path: "/classification/cpc/{symbol}",
			summary:
				"Cooperative Patent Classification (CPC) lookup for a symbol — titles and hierarchy, for building/expanding class-based landscape queries.",
			category: "classification",
			queryParams: [
				{ name: "symbol", type: "string", required: true, description: "CPC symbol, e.g. `A61K39/00` (path param)" },
			],
		},

		// -------------------------------------------------------------------
		// KEYLESS TIER — EPO Linked Open Data (data.epo.org). No credential.
		// Every one of these returns SPARQL results JSON:
		// { head: { vars }, results: { bindings: [...] }, _meta: { tier: "epo-lod", … } }
		// -------------------------------------------------------------------
		{
			method: "GET",
			path: "/lod/publication/{authority}/{number}",
			summary:
				"KEYLESS. Bibliographic record for one publication from EPO Linked Open Data, flattened to (publication, property, value, lang) rows. EP publications yield title/abstract/applicant/inventor/agent/ipcInventive/priority/representation; NON-EP publications yield only publicationDate, publicationKind and application — there is no title and no abstract for them anywhere in LOD.",
			category: "lod",
			example:
				"const r = await api.get('/lod/publication/{authority}/{number}', { authority: 'EP', number: '1000000' });\nreturn r.results.bindings.filter(b => b.property.value === 'title').map(b => b.lang.value + ': ' + b.value.value);",
			queryParams: [
				{ name: "authority", type: "string", required: true, description: "Two-letter WIPO ST.3 code: `EP`, `US`, `WO`, `JP`, `DE`, … (path param)" },
				{ name: "number", type: "string", required: true, description: "Bare publication number WITHOUT country prefix or kind code — `EP1000000` → `1000000` (path param)" },
			],
		},
		{
			method: "GET",
			path: "/lod/publication/{authority}/{number}/citations",
			summary:
				"KEYLESS. Patent publications cited BY this publication (backward citations) with their labels. Densely populated for EP publications; sparse elsewhere.",
			category: "lod",
			queryParams: [
				{ name: "authority", type: "string", required: true, description: "Two-letter WIPO ST.3 code (path param)" },
				{ name: "number", type: "string", required: true, description: "Bare publication number (path param)" },
				{ name: "limit", type: "number", required: false, description: "Max rows, 1-1000 (default 200)" },
			],
		},
		{
			method: "GET",
			path: "/lod/publication/{authority}/{number}/application",
			summary:
				"KEYLESS. The application this publication belongs to, plus every other publication of that same application (the A1/B1 pair). This is NOT the INPADOC family — it is same-application siblings only. For a true worldwide family use the OPS /family endpoint.",
			category: "lod",
			queryParams: [
				{ name: "authority", type: "string", required: true, description: "Two-letter WIPO ST.3 code (path param)" },
				{ name: "number", type: "string", required: true, description: "Bare publication number (path param)" },
				{ name: "limit", type: "number", required: false, description: "Max rows, 1-1000 (default 200)" },
			],
		},
		{
			method: "GET",
			path: "/lod/search/title",
			summary:
				"KEYLESS. Case-insensitive substring search over titles of invention. LOD holds titles for EP publications only, so this effectively searches EP. It is a SPARQL string scan, not an index — expect a few seconds and keep `text` specific. NOT a replacement for OPS CQL search (no abstract, inventor, applicant or classification fields).",
			category: "lod",
			example:
				"const r = await api.get('/lod/search/title', { text: 'graphene', limit: 10 });\nreturn r.results.bindings.map(b => ({ pub: b.publication.value, title: b.title.value }));",
			queryParams: [
				{ name: "text", type: "string", required: true, description: "Substring to look for, minimum 3 characters" },
				{ name: "authority", type: "string", required: false, description: "Restrict to a ST.3 authority. Anything but `EP` returns zero rows — LOD has no non-EP titles." },
				{ name: "language", type: "string", required: false, description: "ISO 639-1 title language: `en` (default), `de`, `fr`" },
				{ name: "limit", type: "number", required: false, description: "Max rows, 1-200 (default 25)" },
			],
		},
		{
			method: "GET",
			path: "/lod/search/applicant",
			summary:
				"KEYLESS. Publications by applicant name, via the vCard graph. `match=exact` (default) is an indexed literal lookup and answers in well under a second; `match=contains` scans and is slower.",
			category: "lod",
			example:
				"const r = await api.get('/lod/search/applicant', { name: 'Novartis', match: 'contains', limit: 20 });\nreturn r.results.bindings.map(b => ({ pub: b.publication.value, applicant: b.applicant.value }));",
			queryParams: [
				{ name: "name", type: "string", required: true, description: "Applicant name, minimum 3 characters. With `match=exact` this must be the full vCard name, e.g. `Koninklijke Philips Electronics N.V.`" },
				{ name: "match", type: "string", required: false, description: "`exact` (default) or `contains`", enum: ["exact", "contains"] },
				{ name: "limit", type: "number", required: false, description: "Max rows, 1-200 (default 25)" },
			],
		},
		{
			method: "GET",
			path: "/lod/query",
			summary:
				"KEYLESS escape hatch: run an arbitrary SPARQL SELECT against https://data.epo.org/linked-data/query. Use the curated /lod/* endpoints first — they are bounded and validated. ALWAYS include a LIMIT; the request aborts at 25 s and the EPO asks for occasional use only.",
			category: "lod",
			usageHint:
				"Useful prefixes: patent: <http://data.epo.org/linked-data/def/patent/>, dcterms: <http://purl.org/dc/terms/>, vcard: <http://www.w3.org/2006/vcard/ns#>. Authorities are <http://data.epo.org/linked-data/id/st3/EP>. Publications are <http://data.epo.org/linked-data/data/publication/{AUTH}/{NUMBER}/{KIND}/->.",
			queryParams: [
				{ name: "query", type: "string", required: true, description: "A complete SPARQL SELECT, including PREFIX declarations and a LIMIT" },
			],
		},
	],
	workflows: evidenceWorkflows,
};
