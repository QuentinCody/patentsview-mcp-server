import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { patentsviewFetch } from "./http";

interface PatentsviewAdapterEnv {
	PATENTSVIEW_API_KEY: string;
}

export function createPatentsviewApiFetch(env: PatentsviewAdapterEnv): ApiFetchFn {
	return async (request) => {
		// PatentsView paths map directly: /patent/, /assignee/, /inventor/, /cpc_class/
		const path = request.path;

		const response = await patentsviewFetch(path, request.params, {
			apiKey: env.PATENTSVIEW_API_KEY,
		});

		if (!response.ok) {
			let errorBody: string;
			try {
				errorBody = await response.text();
			} catch {
				errorBody = response.statusText;
			}
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
			const text = await response.text();
			return { status: response.status, data: text };
		}

		const data: unknown = await response.json();
		return { status: response.status, data };
	};
}
