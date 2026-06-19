import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
 * Register patents_search + patents_execute (EPO OPS upstream).
 * Prefix is `patents` (the data source moved from USPTO PatentsView to EPO OPS);
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
		source: { id: "patents", name: "PatentsView (USPTO)", url: "https://patentsview.org", license: "U.S. Public Domain" },
		catalog: epoOpsCatalog,
		apiFetch,
		doNamespace: env.PATENTSVIEW_DATA_DO,
		loader: env.CODE_MODE_LOADER,
	});
	executeTool.register(server as unknown as ToolRegisterable);
}
