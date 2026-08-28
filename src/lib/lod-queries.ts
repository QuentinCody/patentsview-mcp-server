/**
 * Curated, bounded SPARQL builders for the keyless EPO Linked Open Data tier.
 *
 * Every builder validates its inputs and escapes every literal it interpolates, so a
 * caller-supplied publication number or applicant name cannot break out of the query.
 * Each query carries a LIMIT — the EPO publishes the SPARQL endpoint for "occasional use",
 * and an unbounded pattern over 8M+ publication nodes runs for minutes.
 *
 * This module is deliberately dependency-free so its behaviour is unit-testable without a
 * Worker runtime (see test/structured-content-regression.mjs).
 */

const PATENT_PREFIX = "http://data.epo.org/linked-data/def/patent/";
const ST3_PREFIX = "http://data.epo.org/linked-data/id/st3/";

const PREFIXES = [
	`PREFIX patent: <${PATENT_PREFIX}>`,
	"PREFIX dcterms: <http://purl.org/dc/terms/>",
	"PREFIX vcard: <http://www.w3.org/2006/vcard/ns#>",
	"PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>",
].join("\n");

/**
 * Escape a string for use inside a SPARQL double-quoted literal.
 *
 * Control characters are rejected outright rather than escaped: no legitimate patent
 * number, applicant name or search term contains one, and rejecting them keeps the
 * escaping surface down to backslash and double quote.
 */
export function escapeSparqlLiteral(value: string): string {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code < 0x20 || code === 0x7f) {
			throw new Error("Literal contains a control character");
		}
	}
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Validate a WIPO ST.3 authority code (`EP`, `US`, `WO`, `JP`, …) and return it uppercased. */
export function normalizeAuthority(value: unknown): string {
	const code = String(value ?? "")
		.trim()
		.toUpperCase();
	if (!/^[A-Z]{2}$/.test(code)) {
		throw new Error(
			`Invalid authority "${String(value)}" — expected a two-letter WIPO ST.3 code such as EP, US, WO, JP, DE.`,
		);
	}
	return code;
}

/** Validate a publication number as EPO LOD stores it (digits, occasionally alphanumeric). */
export function normalizePublicationNumber(value: unknown): string {
	const number = String(value ?? "").trim();
	if (!/^[A-Za-z0-9]{1,20}$/.test(number)) {
		throw new Error(
			`Invalid publication number "${String(value)}" — EPO LOD stores the bare number without the ` +
				"country prefix or kind code (EP1000000 → 1000000, US5507996 → 5507996).",
		);
	}
	return number;
}

/** Clamp a caller-supplied limit into [1, max]. */
export function clampLodLimit(value: unknown, fallback: number, max: number): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

function publicationSelector(authority: string, number: string): string {
	return (
		`  ?publication patent:publicationNumber "${escapeSparqlLiteral(number)}" ;\n` +
		`               patent:publicationAuthority <${ST3_PREFIX}${authority}> .`
	);
}

/**
 * One publication's bibliographic record, flattened to (publication, property, value, lang)
 * rows so it stages cleanly into SQLite and so a missing property is visibly absent rather
 * than silently null. EP rows carry title/abstract/applicant/inventor/IPC; a US or JP row
 * carries only date/kind/application — that gap is the LOD-vs-OPS delta, made visible.
 */
export function buildPublicationQuery(params: { authority: unknown; number: unknown }): string {
	const authority = normalizeAuthority(params.authority);
	const number = normalizePublicationNumber(params.number);
	return `${PREFIXES}
SELECT ?publication ?property ?value ?lang WHERE {
${publicationSelector(authority, number)}
  { ?publication patent:publicationDate ?d . BIND(STR(?d) AS ?value) BIND("publicationDate" AS ?property) }
  UNION { ?publication patent:publicationKind ?k . BIND(STR(?k) AS ?value) BIND("publicationKind" AS ?property) }
  UNION { ?publication patent:titleOfInvention ?t . BIND(STR(?t) AS ?value) BIND(LANG(?t) AS ?lang) BIND("title" AS ?property) }
  UNION { ?publication dcterms:abstract ?a . BIND(STR(?a) AS ?value) BIND(LANG(?a) AS ?lang) BIND("abstract" AS ?property) }
  UNION { ?publication patent:applicantVC/vcard:fn ?ap . BIND(STR(?ap) AS ?value) BIND("applicant" AS ?property) }
  UNION { ?publication patent:inventorVC/vcard:fn ?iv . BIND(STR(?iv) AS ?value) BIND("inventor" AS ?property) }
  UNION { ?publication patent:agentVC/vcard:fn ?ag . BIND(STR(?ag) AS ?value) BIND("agent" AS ?property) }
  UNION { ?publication patent:classificationIPCInventive ?c . BIND(STR(?c) AS ?value) BIND("ipcInventive" AS ?property) }
  UNION { ?publication patent:application ?app . BIND(STR(?app) AS ?value) BIND("application" AS ?property) }
  UNION { ?publication patent:priority ?pr . BIND(STR(?pr) AS ?value) BIND("priority" AS ?property) }
  UNION { ?publication patent:representation ?rep . BIND(STR(?rep) AS ?value) BIND("representation" AS ?property) }
}
ORDER BY ?publication ?property
LIMIT 1000`;
}

/** Patent publications cited by one publication (backward citations). */
export function buildCitationsQuery(params: {
	authority: unknown;
	number: unknown;
	limit?: unknown;
}): string {
	const authority = normalizeAuthority(params.authority);
	const number = normalizePublicationNumber(params.number);
	const limit = clampLodLimit(params.limit, 200, 1000);
	return `${PREFIXES}
SELECT ?publication ?cited ?citedLabel WHERE {
${publicationSelector(authority, number)}
  ?publication patent:citesPatentPublication ?citedPub .
  BIND(STR(?citedPub) AS ?cited)
  OPTIONAL { ?citedPub rdfs:label ?citedLabel }
}
ORDER BY ?publication ?cited
LIMIT ${limit}`;
}

/**
 * The application a publication belongs to, plus every other publication of that same
 * application (the A1/B1 pair, and the equivalents EPO records against it).
 * This is the LOD stand-in for an INPADOC family — it is NOT the OPS /family endpoint.
 */
export function buildApplicationQuery(params: {
	authority: unknown;
	number: unknown;
	limit?: unknown;
}): string {
	const authority = normalizeAuthority(params.authority);
	const number = normalizePublicationNumber(params.number);
	const limit = clampLodLimit(params.limit, 200, 1000);
	return `${PREFIXES}
SELECT ?application ?sibling ?siblingLabel ?siblingDate WHERE {
${publicationSelector(authority, number)}
  ?publication patent:application ?applicationUri .
  BIND(STR(?applicationUri) AS ?application)
  ?siblingPub patent:application ?applicationUri .
  BIND(STR(?siblingPub) AS ?sibling)
  OPTIONAL { ?siblingPub rdfs:label ?siblingLabel }
  OPTIONAL { ?siblingPub patent:publicationDate ?siblingDate }
}
ORDER BY ?application ?sibling
LIMIT ${limit}`;
}

/**
 * Substring search over titles of invention. EPO LOD holds titles for EP publications
 * only, so an authority filter other than EP will return zero rows — the catalog says
 * this in as many words.
 */
export function buildTitleSearchQuery(params: {
	text?: unknown;
	authority?: unknown;
	language?: unknown;
	limit?: unknown;
}): string {
	const raw = String(params.text ?? "").trim();
	if (raw.length < 3) {
		throw new Error(
			"`text` must be at least 3 characters — a shorter substring scans the whole title graph and times out.",
		);
	}
	const needle = escapeSparqlLiteral(raw.toLowerCase());
	const language = escapeSparqlLiteral(
		String(params.language ?? "en")
			.trim()
			.toLowerCase(),
	);
	const limit = clampLodLimit(params.limit, 25, 200);
	const authorityClause =
		params.authority === undefined || params.authority === null || params.authority === ""
			? ""
			: `\n  ?publication patent:publicationAuthority <${ST3_PREFIX}${normalizeAuthority(params.authority)}> .`;
	return `${PREFIXES}
SELECT ?publication ?title ?date WHERE {
  ?publication patent:titleOfInvention ?titleLiteral .
  FILTER(langMatches(LANG(?titleLiteral), "${language}") && CONTAINS(LCASE(?titleLiteral), "${needle}"))${authorityClause}
  BIND(STR(?titleLiteral) AS ?title)
  OPTIONAL { ?publication patent:publicationDate ?date }
}
LIMIT ${limit}`;
}

/**
 * Publications by applicant name. `match: "exact"` (default) hits the indexed vcard:fn
 * literal and answers in well under a second; `match: "contains"` scans and is slower.
 */
export function buildApplicantSearchQuery(params: {
	name?: unknown;
	match?: unknown;
	limit?: unknown;
}): string {
	const raw = String(params.name ?? "").trim();
	if (raw.length < 3) {
		throw new Error("`name` must be at least 3 characters.");
	}
	const match = String(params.match ?? "exact").toLowerCase();
	if (match !== "exact" && match !== "contains") {
		throw new Error(`Invalid match "${match}" — use "exact" or "contains".`);
	}
	const limit = clampLodLimit(params.limit, 25, 200);
	const binding =
		match === "exact"
			? `?vc vcard:fn "${escapeSparqlLiteral(raw)}" .\n  ?vc vcard:fn ?applicant .`
			: `?vc vcard:fn ?applicant .\n  FILTER(CONTAINS(LCASE(?applicant), "${escapeSparqlLiteral(raw.toLowerCase())}"))`;
	return `${PREFIXES}
SELECT ?publication ?applicant ?date ?label WHERE {
  ${binding}
  ?vc patent:vcApplicantOf ?publicationUri .
  BIND(STR(?publicationUri) AS ?publication)
  OPTIONAL { ?publicationUri patent:publicationDate ?date }
  OPTIONAL { ?publicationUri rdfs:label ?label }
}
LIMIT ${limit}`;
}

/**
 * The liveness probe behind the empty-result guard: the cheapest query that proves the
 * endpoint is serving the publication graph at all. If a caller's filtered lookup comes
 * back empty AND this comes back empty, the empty is NOT evidence of absence.
 */
export function buildLivenessProbeQuery(): string {
	return `${PREFIXES}
SELECT ?publication WHERE { ?publication a patent:Publication } LIMIT 1`;
}

// ---------------------------------------------------------------------------
// Routing — which catalog path maps to which builder
// ---------------------------------------------------------------------------

const PUBLICATION_ROUTE = /^\/publication\/([^/]+)\/([^/]+)(\/citations|\/application)?$/;

/**
 * Strip the `/lod` prefix from a catalog path. Returns null when the path belongs to the
 * credentialed OPS tier instead, which is what makes this the single routing decision.
 */
export function resolveLodRoute(path: string): string | null {
	if (path === "/lod") return "/";
	return path.startsWith("/lod/") ? path.slice("/lod".length) : null;
}

/** Build the SPARQL for one LOD route, or throw a message naming the routes that exist. */
export function buildLodQuery(route: string, params: Record<string, unknown>): string {
	const publicationMatch = PUBLICATION_ROUTE.exec(route);
	if (publicationMatch) {
		const [, authority, number, sub] = publicationMatch;
		const args = { authority, number, limit: params.limit };
		if (sub === "/citations") return buildCitationsQuery(args);
		if (sub === "/application") return buildApplicationQuery(args);
		return buildPublicationQuery(args);
	}
	if (route === "/search/title") return buildTitleSearchQuery(params);
	if (route === "/search/applicant") return buildApplicantSearchQuery(params);
	if (route === "/query") {
		const query = String(params.query ?? "").trim();
		if (!query) {
			throw new Error(
				"/lod/query requires a `query` param holding a complete SPARQL SELECT. Add a LIMIT — the EPO " +
					"publishes this endpoint for occasional use and unbounded scans time out.",
			);
		}
		return query;
	}
	throw new Error(
		`Unknown EPO Linked Open Data route "${route}". Available: /lod/publication/{authority}/{number}, ` +
			"/lod/publication/{authority}/{number}/citations, /lod/publication/{authority}/{number}/application, " +
			"/lod/search/title, /lod/search/applicant, /lod/query.",
	);
}
