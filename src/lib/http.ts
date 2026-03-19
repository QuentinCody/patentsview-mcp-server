import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const PATENTSVIEW_BASE = "https://search.patentsview.org/api/v1";

export interface PatentsviewFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
	baseUrl?: string;
	apiKey: string;
}

/**
 * Fetch from the USPTO PatentsView API.
 * Authenticates via X-Api-Key header.
 *
 * NOTE: New API key grants are temporarily suspended as of March 2026.
 */
export async function patentsviewFetch(
	path: string,
	params?: Record<string, unknown>,
	opts?: PatentsviewFetchOptions,
): Promise<Response> {
	const baseUrl = opts?.baseUrl ?? PATENTSVIEW_BASE;
	const headers: Record<string, string> = {
		Accept: "application/json",
		"X-Api-Key": opts?.apiKey ?? "",
		...(opts?.headers ?? {}),
	};

	return restFetch(baseUrl, path, params, {
		...opts,
		headers,
		retryOn: [429, 500, 502, 503],
		retries: opts?.retries ?? 3,
		timeout: opts?.timeout ?? 30_000,
		userAgent: "patentsview-mcp-server/1.0 (bio-mcp)",
	});
}
