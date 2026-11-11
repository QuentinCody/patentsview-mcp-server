/**
 * EPO Open Patent Services (OPS) v3.2 HTTP client — OAuth 2.0 client-credentials.
 *
 * Token endpoint: https://ops.epo.org/3.2/auth/accesstoken  (HTTP Basic = base64(key:secret))
 * API base:       https://ops.epo.org/3.2/rest-services
 *
 * Replaces the DEAD PatentsView upstream: api.patentsview.org/patents/query now 301-redirects
 * to data.uspto.gov, and new search.patentsview.org key grants have been suspended since 2026-03.
 * EPO OPS is live, free, and self-service: register a developer app at https://developers.epo.org
 * for a Consumer Key/Secret (instant, no approval committee). Free tier ≈ 4 GB traffic/week.
 *
 * OAuth pattern mirrors who-icd11-mcp-server/src/lib/http.ts (client_credentials + module-level
 * token cache, refreshed 60 s before expiry, one retry on 401).
 *
 * This is the CREDENTIALED tier. The keyless tier lives in lib/lod.ts (EPO Linked Open Data);
 * lib/api-adapter.ts routes between the two by path prefix.
 */

import { boundedText } from "./bounded-read.ts";
const TOKEN_URL = "https://ops.epo.org/3.2/auth/accesstoken";
const OPS_BASE = "https://ops.epo.org/3.2/rest-services";

/** Self-service, free, no approval committee. */
export const EPO_OPS_REGISTRATION_URL = "https://developers.epo.org/user/register";

export interface EpoOpsEnv {
	EPO_OPS_KEY: string;
	EPO_OPS_SECRET: string;
}

/**
 * Raised BEFORE any network call when the OPS Consumer Key/Secret are absent.
 *
 * Without this, the only signal was EPO's own `401 Client identifier is required`, which
 * reads like an upstream outage and names neither the env vars nor how to set them. The
 * error still propagates as an error — `api.get()` rethrows it inside the isolate and the
 * tool result stays `isError` — because "no credentials" must never look like a success.
 */
export class MissingEpoOpsCredentialsError extends Error {
	readonly code = "MISSING_CREDENTIALS";
	readonly status = 401;
	readonly data: {
		code: string;
		missing: string[];
		env_vars: string[];
		registration_url: string;
		setup_commands: string[];
		keyless_alternative: string;
	};

	constructor(missing: string[]) {
		super(
			`EPO OPS credentials are not configured — ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} unset. ` +
				"The /published-data, /family, /legal and /classification endpoints of this server all need a free " +
				`EPO developer app. 1) Register at ${EPO_OPS_REGISTRATION_URL}. 2) Create an app under "My Apps" and ` +
				"copy its Consumer Key + Consumer Secret. 3) Set them as Worker secrets: " +
				"`cd servers/patentsview-mcp-server && npx wrangler secret put EPO_OPS_KEY` then " +
				"`npx wrangler secret put EPO_OPS_SECRET`. " +
				"KEYLESS ALTERNATIVE: the /lod/* endpoints of this same server answer with NO credential from EPO " +
				"Linked Open Data. They serve EP bibliographic records, worldwide publication identifiers, the " +
				"application link and the citation graph — but NOT full text, NOT INPADOC legal status, NOT non-EP " +
				"titles or abstracts, and NOT CQL search. Run patents_search('lod') for the list.",
		);
		this.name = "MissingEpoOpsCredentialsError";
		this.data = {
			code: "MISSING_CREDENTIALS",
			missing,
			env_vars: ["EPO_OPS_KEY", "EPO_OPS_SECRET"],
			registration_url: EPO_OPS_REGISTRATION_URL,
			setup_commands: [
				"cd servers/patentsview-mcp-server && npx wrangler secret put EPO_OPS_KEY",
				"cd servers/patentsview-mcp-server && npx wrangler secret put EPO_OPS_SECRET",
			],
			keyless_alternative:
				"Call the /lod/* endpoints of this server (EPO Linked Open Data, no credential).",
		};
	}
}

/** Which of the two OPS secrets are missing or blank. Empty array = both present. */
export function missingEpoOpsCredentials(env: Partial<EpoOpsEnv> | undefined): string[] {
	const missing: string[] = [];
	if (!env?.EPO_OPS_KEY?.trim()) missing.push("EPO_OPS_KEY");
	if (!env?.EPO_OPS_SECRET?.trim()) missing.push("EPO_OPS_SECRET");
	return missing;
}

/** True when both OPS secrets are present, i.e. the OPS tier can be attempted. */
export function hasEpoOpsCredentials(env: Partial<EpoOpsEnv> | undefined): boolean {
	return missingEpoOpsCredentials(env).length === 0;
}

/** Throw the actionable {@link MissingEpoOpsCredentialsError} when either secret is absent. */
export function assertEpoOpsCredentials(env: Partial<EpoOpsEnv> | undefined): void {
	const missing = missingEpoOpsCredentials(env);
	if (missing.length > 0) throw new MissingEpoOpsCredentialsError(missing);
}

// Module-level token cache
const tokens = new WeakMap<EpoOpsEnv, { token: string; expiresAt: number; key: string; secret: string }>();

/**
 * Fetch an OAuth 2.0 access token via client-credentials (HTTP Basic auth).
 * Caches until 60 s before expiry. EPO returns expires_in as a string (e.g. "1199").
 */
async function getAccessToken(env: EpoOpsEnv): Promise<string> {
	// Fail on the missing secret itself, not on EPO's downstream 401.
	assertEpoOpsCredentials(env);

	const now = Date.now();
	const cached = tokens.get(env);
	if (cached && cached.key === env.EPO_OPS_KEY && cached.secret === env.EPO_OPS_SECRET && now < cached.expiresAt) {
		return cached.token;
	}

	const basic = btoa(`${env.EPO_OPS_KEY}:${env.EPO_OPS_SECRET}`);
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		signal: AbortSignal.timeout(25000),
		redirect: "manual",
		headers: {
			Authorization: `Basic ${basic}`,
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: "grant_type=client_credentials",
	});

	if (!response.ok) {
		const errText = await boundedText(response).catch(() => response.statusText);
		throw new Error(
			`EPO OPS token fetch failed (${response.status}): ${errText.slice(0, 300)}`,
		);
	}

	const data = JSON.parse(await boundedText(response)) as { access_token?: unknown; expires_in?: unknown };
	if (typeof data.access_token !== "string" || !data.access_token.trim()) throw new Error("EPO OPS returned no access token");
	const ttl = Number(data.expires_in);
	// Expire 60 seconds early; malformed or missing expiry is not cached for reuse.
	tokens.set(env, { token: data.access_token, expiresAt: now + ((Number.isFinite(ttl) && ttl > 0 ? ttl : 0) - 60) * 1000, key: env.EPO_OPS_KEY, secret: env.EPO_OPS_SECRET });
	return data.access_token;
}

/**
 * Fetch from EPO OPS with automatic OAuth authentication.
 *
 * @param path   - Path relative to /rest-services (e.g. "/published-data/search")
 * @param env    - Environment with EPO_OPS_KEY and EPO_OPS_SECRET
 * @param params - Query-string params appended to the URL
 * @param init   - Optional fetch RequestInit overrides
 */
export async function epoOpsFetch(
	path: string,
	env: EpoOpsEnv,
	params?: Record<string, unknown>,
	init?: RequestInit,
): Promise<Response> {
	const token = await getAccessToken(env);

	const url = new URL(`${OPS_BASE}${path.startsWith("/") ? path : `/${path}`}`);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null && value !== "") {
				url.searchParams.set(key, String(value));
			}
		}
	}

	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		Accept: "application/json",
		...(init?.headers as Record<string, string> | undefined),
	};

	const options = { ...init, signal: init?.signal ?? AbortSignal.timeout(25000), redirect: "manual" as const };
	const response = await fetch(url.toString(), { ...options, headers });

	// 401 → token invalidated; refresh once and retry.
	if (response.status === 401) {
		void response.body?.cancel().catch(() => {}); // Best-effort cleanup before retry.
		tokens.delete(env);
		const freshToken = await getAccessToken(env);
		return fetch(url.toString(), {
			...options,
			headers: { ...headers, Authorization: `Bearer ${freshToken}` },
		});
	}

	return response;
}
