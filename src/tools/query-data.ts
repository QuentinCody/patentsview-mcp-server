import type { McpServer } from "@bio-mcp/shared/mcp";
import { z } from "zod";
import { createQueryDataHandler } from "@bio-mcp/shared/staging/utils";

interface QueryDataArgs {
	[key: string]: unknown;
	data_access_id: string;
	sql: string;
	limit?: number;
}

export function registerQueryData(server: McpServer, env?: { PATENTSVIEW_DATA_DO?: unknown }): void {
	const handler = createQueryDataHandler("PATENTSVIEW_DATA_DO", "patentsview");

	for (const name of ["patentsview_query_data", "mcp_patentsview_query_data", "patents_query_data", "mcp_patents_query_data"]) server.registerTool(
		name,
		{
			title: "Query Staged EPO Patent Data",
			description:
				"Query staged EPO patent data (Open Patent Services v3.2 or EPO Linked Open Data) using SQL. Use this when a patents_execute response was too large and came back with a data_access_id. NOTE: the tool prefix here is `patentsview` for historical reasons, while Code Mode uses `patents_search` / `patents_execute` — same server.",
			inputSchema: {
				data_access_id: z.string().min(1).describe("Data access ID for the staged dataset"),
				sql: z.string().min(1).describe("SQL query to execute against the staged data"),
				limit: z.number().int().positive().max(10000).default(100).optional().describe("Maximum number of rows to return (default: 100)"),
			},
		},
		async (args, extra) => {
			const resolvedEnv = env ?? (extra as { env?: { PATENTSVIEW_DATA_DO?: unknown } })?.env ?? {};
			const envRecord: Record<string, unknown> = { PATENTSVIEW_DATA_DO: resolvedEnv.PATENTSVIEW_DATA_DO };
			const typedArgs: QueryDataArgs = {
				data_access_id: String((args as QueryDataArgs).data_access_id ?? ""),
				sql: String((args as QueryDataArgs).sql ?? ""),
				limit: (args as QueryDataArgs).limit,
			};
			return handler(typedArgs, envRecord);
		},
	);
}
