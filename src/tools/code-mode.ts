import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { patentsviewCatalog } from "../spec/catalog";
import { createPatentsviewApiFetch } from "../lib/api-adapter";

/** Minimal interface matching McpServer.tool() for shared register() calls */
interface ToolRegisterable {
	tool: (...args: unknown[]) => void;
}

interface CodeModeEnv {
	PATENTSVIEW_DATA_DO: DurableObjectNamespace;
	CODE_MODE_LOADER: WorkerLoader;
	PATENTSVIEW_API_KEY?: string;
}

export function registerCodeMode(
	server: McpServer,
	env: CodeModeEnv,
) {
	const apiFetch = createPatentsviewApiFetch({
		PATENTSVIEW_API_KEY: env.PATENTSVIEW_API_KEY ?? "",
	});

	const searchTool = createSearchTool({
		prefix: "patentsview",
		catalog: patentsviewCatalog,
	});
	searchTool.register(server as unknown as ToolRegisterable);

	const executeTool = createExecuteTool({
		prefix: "patentsview",
		catalog: patentsviewCatalog,
		apiFetch,
		doNamespace: env.PATENTSVIEW_DATA_DO,
		loader: env.CODE_MODE_LOADER,
	});
	executeTool.register(server as unknown as ToolRegisterable);
}
