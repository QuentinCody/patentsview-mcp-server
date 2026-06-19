/**
 * EPO OPS API adapter for Code Mode.
 *
 * Builds an ApiFetchFn that authenticates host-side (OAuth2 client-credentials) so the
 * Consumer Key/Secret never enter the V8 isolate — the isolate only sees api.get(path, params).
 */

import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { epoOpsFetch, type EpoOpsEnv } from "./http";

/**
 * Create an ApiFetchFn routed to EPO OPS /rest-services. Paths from the catalog
 * (e.g. "/published-data/search", "/published-data/publication/{format}/{number}/biblio")
 * are forwarded verbatim; {placeholders} are interpolated upstream by the execute tool.
 */
export function createEpoOpsApiFetch(env: EpoOpsEnv): ApiFetchFn {
	return async (request) => {
		const response = await epoOpsFetch(request.path, env, request.params);

		if (!response.ok) {
			let errorBody: string;
			try {
				errorBody = await response.text();
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
			const text = await response.text();
			return { status: response.status, data: text };
		}

		const data: unknown = await response.json();
		return { status: response.status, data };
	};
}
