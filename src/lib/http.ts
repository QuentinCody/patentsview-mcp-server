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
 */

const TOKEN_URL = "https://ops.epo.org/3.2/auth/accesstoken";
const OPS_BASE = "https://ops.epo.org/3.2/rest-services";

export interface EpoOpsEnv {
	EPO_OPS_KEY: string;
	EPO_OPS_SECRET: string;
}

// Module-level token cache
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Fetch an OAuth 2.0 access token via client-credentials (HTTP Basic auth).
 * Caches until 60 s before expiry. EPO returns expires_in as a string (e.g. "1199").
 */
async function getAccessToken(env: EpoOpsEnv): Promise<string> {
	const now = Date.now();
	if (cachedToken && now < tokenExpiresAt) {
		return cachedToken;
	}

	const basic = btoa(`${env.EPO_OPS_KEY}:${env.EPO_OPS_SECRET}`);
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: {
			Authorization: `Basic ${basic}`,
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: "grant_type=client_credentials",
	});

	if (!response.ok) {
		const errText = await response.text().catch(() => response.statusText);
		throw new Error(`EPO OPS token fetch failed (${response.status}): ${errText.slice(0, 300)}`);
	}

	const data = (await response.json()) as { access_token: string; expires_in: string | number };
	cachedToken = data.access_token;
	const ttl = typeof data.expires_in === "string" ? Number.parseInt(data.expires_in, 10) : data.expires_in;
	// Expire 60 seconds early; default to 20 min if EPO omits/garbles expires_in.
	tokenExpiresAt = now + ((Number.isFinite(ttl) && ttl > 0 ? ttl : 1200) - 60) * 1000;

	return cachedToken;
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

	const response = await fetch(url.toString(), { ...init, headers });

	// 401 → token invalidated; refresh once and retry.
	if (response.status === 401) {
		cachedToken = null;
		tokenExpiresAt = 0;
		const freshToken = await getAccessToken(env);
		return fetch(url.toString(), {
			...init,
			headers: { ...headers, Authorization: `Bearer ${freshToken}` },
		});
	}

	return response;
}
