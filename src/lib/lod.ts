/**
 * EPO Linked Open Data (LOD) SPARQL client — the KEYLESS tier of this server.
 *
 * Endpoint: https://data.epo.org/linked-data/query  (no credential of any kind)
 * License:  Creative Commons Attribution 4.0 International, stated by the EPO at
 *           https://www.epo.org/en/searching-for-patents/data/linked-open-data
 *
 * WHY THIS EXISTS: the OPS tier (lib/http.ts) needs EPO_OPS_KEY/EPO_OPS_SECRET, which a
 * human must register for. LOD needs nothing, so the server still answers real questions
 * from a real upstream database with zero credentials. It is NOT an OPS substitute — see
 * the LOD section of spec/catalog.ts for the measured capability delta.
 *
 * FAIR USE: the EPO calls the SPARQL endpoint a reference service "provided for occasional
 * use … not designed to provide a backend database service". Every query this server sends
 * is bounded (LIMIT + a hard deadline); unbounded scans are the caller's responsibility and
 * the catalog says so.
 */

const LOD_QUERY_URL = "https://data.epo.org/linked-data/query";

/** Hard per-query budget. Narrow LOD queries answer in <1 s; a full-graph scan can run
 *  for minutes, and the isolate's own execution budget is 30 s. */
export const LOD_TIMEOUT_MS = 25_000;

/** One cell of a SPARQL SELECT result row. */
export interface SparqlBinding {
	type: string;
	value: string;
	"xml:lang"?: string;
	datatype?: string;
}

/** SPARQL 1.1 Query Results JSON Format (application/sparql-results+json). */
export interface SparqlResults {
	head: { vars?: string[]; link?: string[] };
	results: { bindings: Array<Record<string, SparqlBinding>> };
}

function isSparqlResults(value: unknown): value is SparqlResults {
	if (value === null || typeof value !== "object") return false;
	const results = (value as { results?: unknown }).results;
	if (results === null || typeof results !== "object") return false;
	return Array.isArray((results as { bindings?: unknown }).bindings);
}

/**
 * Run one SPARQL SELECT against EPO Linked Open Data and return the parsed
 * results JSON.
 *
 * POST (form-encoded) rather than GET: the curated queries in lod-queries.ts run past the
 * length a URL comfortably carries, and the endpoint accepts both (verified live).
 *
 * A non-2xx response THROWS with the upstream body attached — the isolate must see a
 * failed query as a failure, never as an empty result set.
 */
export async function lodSparql(
	query: string,
	timeoutMs: number = LOD_TIMEOUT_MS,
): Promise<SparqlResults> {
	let response: Response;
	try {
		response = await fetch(LOD_QUERY_URL, {
			method: "POST",
			headers: {
				Accept: "application/sparql-results+json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({ query }).toString(),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (cause) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		const error = new Error(
			`EPO Linked Open Data SPARQL request failed after ${timeoutMs} ms: ${reason}. ` +
				"Narrow the query (add a publication number, an authority filter, or a smaller LIMIT) — " +
				"unfiltered scans of the graph exceed the budget.",
		) as Error & { status: number };
		error.status = 504;
		throw error;
	}

	if (!response.ok) {
		const body = await response.text().catch(() => response.statusText);
		const error = new Error(
			`EPO Linked Open Data SPARQL returned HTTP ${response.status}: ${body.slice(0, 300)}`,
		) as Error & { status: number; data: unknown };
		error.status = response.status;
		error.data = body.slice(0, 2000);
		throw error;
	}

	const parsed: unknown = await response.json();
	if (!isSparqlResults(parsed)) {
		const error = new Error(
			"EPO Linked Open Data SPARQL returned a body that is not SPARQL results JSON — " +
				"treat this as an upstream failure, not as an empty result.",
		) as Error & { status: number };
		error.status = 502;
		throw error;
	}
	return parsed;
}
