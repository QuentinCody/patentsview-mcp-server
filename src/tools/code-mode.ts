import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { epoOpsCatalog } from "../spec/catalog";
import { createEpoOpsApiFetch } from "../lib/api-adapter";
import type { EpoOpsEnv } from "../lib/http";

/** Minimal interface matching McpServer.tool() for shared register() calls */
interface ToolRegisterable {
	tool: (...args: unknown[]) => void;
}

/** Minimal shape required from the worker Env for Code Mode registration. */
interface CodeModeEnv {
	PATENTSVIEW_DATA_DO: Pick<Env["PATENTSVIEW_DATA_DO"], "get" | "idFromName">;
	CODE_MODE_LOADER: Env["CODE_MODE_LOADER"];
	EPO_OPS_KEY?: string;
	EPO_OPS_SECRET?: string;
}

/** Resolve OPS credentials from the worker Env, defaulting to empty strings. */
function epoEnvFrom(env: CodeModeEnv): EpoOpsEnv {
	return {
		EPO_OPS_KEY: env.EPO_OPS_KEY ?? "",
		EPO_OPS_SECRET: env.EPO_OPS_SECRET ?? "",
	};
}

/**
 * Register patents_search + patents_execute (EPO upstream, two tiers).
 * Prefix is `patents` (the data source moved from USPTO PatentsView to EPO);
 * the DO binding name PATENTSVIEW_DATA_DO is retained to avoid a migration.
 */
export function registerCodeMode(
	server: McpServer,
	env: CodeModeEnv,
): void {
	const apiFetch = createEpoOpsApiFetch(epoEnvFrom(env));

	const searchTool = createSearchTool({
		prefix: "patents",
		catalog: epoOpsCatalog,
	});
	searchTool.register(server as unknown as ToolRegisterable);

	const executeTool = createExecuteTool({
		prefix: "patents",
		// Verifiable provenance: patents_execute results carry a _meta.citation.
		// This descriptor named "PatentsView (USPTO)" / patentsview.org / "U.S. Public Domain"
		// while every byte came from EPO — a citation that misattributed the source and
		// asserted a licence that does not apply. Both EPO tiers are named here; the tier
		// that actually answered a given call is stamped on the payload as `_meta.tier` by
		// lib/api-adapter.ts (ExecuteToolOptions.source is fixed per tool, not per call).
		source: {
			id: "epo-patent-data",
			name: "EPO Open Patent Services v3.2 (credentialed) + EPO Linked Open Data (keyless)",
			url: "https://ops.epo.org",
			license:
				"OPS: EPO terms of use / fair-use policy (https://www.epo.org/en/service-support/ordering/fair-use.html). Linked Open Data: CC BY 4.0 (https://www.epo.org/en/searching-for-patents/data/linked-open-data).",
		},
		catalog: epoOpsCatalog,
		apiFetch,
		doNamespace: env.PATENTSVIEW_DATA_DO,
		loader: env.CODE_MODE_LOADER,
	});
	executeTool.register(server as unknown as ToolRegisterable);
}
