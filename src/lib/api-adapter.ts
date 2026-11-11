/**
 * Two-tier API adapter for Code Mode.
 *
 * The single ApiFetchFn routes by path prefix:
 *   /lod/*  → EPO Linked Open Data (data.epo.org), KEYLESS, CC BY 4.0
 *   everything else → EPO OPS v3.2 (ops.epo.org), OAuth2 client-credentials
 *
 * Both tiers authenticate (or not) host-side, so the Consumer Key/Secret never enter the
 * V8 isolate — the isolate only sees api.get(path, params).
 *
 * Every successful object response carries `_meta.tier` naming which upstream answered, so
 * a consumer can never mistake a keyless LOD stub for an OPS bibliographic record.
 */

import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { guardEmptyResult } from "@bio-mcp/shared/codemode/empty-result-guard";
import { type EpoOpsEnv, epoOpsFetch } from "./http";
import { lodSparql, type SparqlResults } from "./lod";
import { buildLivenessProbeQuery, buildLodQuery, resolveLodRoute } from "./lod-queries";
import { evidenceQuery } from "./evidence-queries";
import { evidenceView } from "./evidence-view";
import { boundedText } from "./bounded-read";

/** Provenance stamp added to every object payload this adapter returns. */
interface TierMeta {
	tier: "epo-ops" | "epo-lod";
	upstream: string;
	credentialed: boolean;
	license: string;
	/** Present on LOD responses: the exact SPARQL that produced the rows. */
	sparql?: string;
	/** Present on LOD responses: what this tier cannot answer, so nobody infers absence. */
	coverage_caveat?: string;
}

const OPS_META: TierMeta = {
	tier: "epo-ops",
	upstream: "https://ops.epo.org/3.2/rest-services",
	credentialed: true,
	license:
		"EPO Open Patent Services terms of use / fair-use policy — https://www.epo.org/en/service-support/ordering/fair-use.html",
};

const LOD_COVERAGE_CAVEAT =
	"EPO Linked Open Data. Bibliographic content (title, abstract, applicant, inventor, IPC) exists for EP " +
	"publications; non-EP publications are number/date/kind/application stubs. NO full text, NO INPADOC legal " +
	"status, NO INPADOC family, NO CQL search. An empty result here is NOT evidence the patent does not exist — " +
	"re-check via the OPS tier once EPO_OPS_KEY/EPO_OPS_SECRET are set.";

function lodMeta(sparql: string): TierMeta {
	return {
		tier: "epo-lod",
		upstream: "https://data.epo.org/linked-data/query",
		credentialed: false,
		license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
		sparql,
		coverage_caveat: LOD_COVERAGE_CAVEAT,
	};
}

/**
 * Stamp `_meta` onto a plain-object payload. Arrays and non-JSON passthrough bodies
 * (OPS returns XML/PDF for some constituents) are returned untouched — annotating them
 * would change a shape callers already depend on.
 */
function annotateTier(data: unknown, meta: TierMeta): unknown {
	if (data === null || typeof data !== "object" || Array.isArray(data)) return data;
	return { ...(data as Record<string, unknown>), _meta: meta };
}

// ---------------------------------------------------------------------------
// Keyless tier — EPO Linked Open Data
// ---------------------------------------------------------------------------

function isEmptyBindings(results: SparqlResults): boolean {
	return results.results.bindings.length === 0;
}

/**
 * Run one curated LOD query.
 *
 * A zero-row answer runs through the fleet's empty-result guard: an unfiltered 1-row probe
 * of the same graph decides whether the empty is a certified negative or a dead endpoint.
 * A dead endpoint throws (EmptyDatasetError) rather than returning a plausible `[]`.
 */
async function fetchLod(
	route: string,
	params: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
	const sparql = buildLodQuery(route, params);
	const results = await lodSparql(sparql);
	const outcome = await guardEmptyResult(results, {
		isEmpty: isEmptyBindings,
		probe: () => lodSparql(buildLivenessProbeQuery(), 10_000),
		describe: `EPO Linked Open Data SPARQL (/lod${route})`,
	});
	const data: Record<string, unknown> = { ...outcome.data };
	if (outcome.guard) data.__guard = outcome.guard;
	return { status: 200, data: annotateTier(data, lodMeta(sparql)) };
}

// ---------------------------------------------------------------------------
// Credentialed tier — EPO OPS v3.2
// ---------------------------------------------------------------------------

async function fetchOps(
	path: string,
	env: EpoOpsEnv,
	params: Record<string, unknown> | undefined,
): Promise<{ status: number; data: unknown }> {
	// Throws MissingEpoOpsCredentialsError before any network call when the secrets are unset.
	const response = await epoOpsFetch(path, env, params);

	if (!response.ok) {
		let errorBody: string;
		try {
			errorBody = await boundedText(response);
		} catch {
			errorBody = response.statusText;
		}
		// EPO returns structured <error><code>403</code><message>… Fair Use …</message></error>
		// for quota/fair-use throttling — surface it intact for the isolate to read.
		const error = new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`) as Error & {
			status: number;
			data: unknown;
		};
		error.status = response.status;
		error.data = errorBody;
		throw error;
	}

	const contentType = response.headers.get("content-type") || "";
	if (!contentType.includes("json")) {
		// EPO can return XML/PDF for some constituents (images, certain full-text) — pass as text.
		const text = await boundedText(response);
		return { status: response.status, data: text };
	}

	const data: unknown = JSON.parse(await boundedText(response));
	return { status: response.status, data: annotateTier(data, OPS_META) };
}

/**
 * Create the ApiFetchFn backing `patents_execute`.
 *
 * Catalog paths are forwarded verbatim; `{placeholders}` are interpolated upstream by the
 * shared api-proxy before this function sees them.
 */
export function createEpoOpsApiFetch(env: EpoOpsEnv): ApiFetchFn {
	return async (request) => {
		if (request.method !== "GET" || request.body !== undefined) throw new Error("EPO catalog routes support GET only");
		const evidence = evidenceQuery(request.path, request.params ?? {});
		if (evidence) {
			const native = await lodSparql(evidence.query);
			return { status: 200, data: annotateTier(evidenceView(native, evidence), lodMeta(evidence.query)) };
		}
		const route = resolveLodRoute(request.path);
		if (route !== null) {
			return fetchLod(route, request.params ?? {});
		}
		return fetchOps(request.path, env, request.params);
	};
}
