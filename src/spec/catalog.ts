import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

/**
 * EPO Open Patent Services (OPS) v3.2 — worldwide patent data.
 *
 * Replaces the dead USPTO PatentsView upstream. OPS serves DOCDB worldwide bibliographic
 * data, INPADOC patent families + legal status, EP/WO full-text, and CQL search across
 * EPO's worldwide collection — covering the data-retrieval core of Patentfield / PatentCloud.
 *
 * Auth is OAuth2 client-credentials handled host-side (see lib/http.ts); the V8 isolate only
 * ever calls api.get(path, params) and never sees the Consumer Key/Secret.
 */
export const epoOpsCatalog: ApiCatalog = {
	name: "EPO Open Patent Services (OPS) v3.2",
	baseUrl: "https://ops.epo.org/3.2/rest-services",
	version: "3.2",
	auth: "oauth2",
	endpointCount: 9,
	notes:
		"AUTH: OAuth2 client-credentials, handled host-side. Set EPO_OPS_KEY + EPO_OPS_SECRET (register a free app at https://developers.epo.org). The isolate never sees credentials.\n" +
		"RESPONSES: Deeply nested JSON under `ops:world-patent-data`. Request Accept: application/json (default). Some constituents (images, certain full-text) return XML/PDF — those arrive as a text string.\n" +
		"DOCUMENT NUMBER FORMATS: two input formats —\n" +
		"  • epodoc (recommended): country+number, e.g. `EP1000000`, `US20070178709`, `WO2008000000`\n" +
		"  • docdb: dotted country.number.kind, e.g. `US.20070178709.A1`, `EP.1000000.A1`\n" +
		"CQL SEARCH (/published-data/search, `q` param): fields ti=title, ab=abstract, ta=title+abstract, txt=title+abstract+inventor+applicant, in=inventor, pa=applicant, pn=publication-number, ap=application-number, pr=priority, num=any number, ipc=IPC class, cpc=CPC class, pd=publication-date.\n" +
		"  Operators: and / or / not; phrase in quotes; date range via `within`, e.g. q=`ti=graphene and pd within \"20200101 20231231\"`.\n" +
		"PAGINATION: the search endpoint returns the first 25 hits and a @total-result-count. Larger ranges use the OPS `Range` HTTP header (max 100/page) — not all clients can set it, so paginate by narrowing the CQL query (e.g. by date window or class).\n" +
		"QUOTA / FAIR USE: free tier ≈ 4 GB traffic/week. Over-quota or burst traffic returns HTTP 403 `<error><code>403</code><message>… Fair Use …</message></error>` — back off and retry. Fine for interactive agent use; NOT for bulk corpus download.\n" +
		"COVERAGE: bibliographic + family + legal is worldwide (DOCDB/INPADOC, 100+ authorities). Full-text (claims/description) is mainly EP and WO; US/other full-text is thinner. For US assignment + PTAB validity data, pair with a USPTO source.\n" +
		"WORKFLOW: search (CQL) → collect publication numbers → fetch /biblio, /abstract, /claims per number → /family for INPADOC siblings → /legal for status events.",
	endpoints: [
		{
			method: "GET",
			path: "/published-data/search",
			summary:
				"CQL search across EPO's worldwide collection. Returns publication references (country/doc-number/kind) + total-result-count. Use `q` with CQL field syntax.",
			category: "search",
			queryParams: [
				{ name: "q", type: "string", required: true, description: "CQL query, e.g. `ti=apixaban`, `pa=\"bristol-myers squibb\"`, `txt=car-t and pd within \"20200101 20231231\"`" },
				{ name: "Range", type: "string", required: false, description: "Result range, e.g. `1-25` (max 100). Often must be sent as an HTTP header; narrow the query instead if unavailable." },
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
				"INPADOC patent family for a publication: all family members worldwide with their bibliographic data — the basis for global freedom-to-operate / coverage mapping.",
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
	],
};
