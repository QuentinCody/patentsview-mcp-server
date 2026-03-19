import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class PatentsviewDataDO extends RestStagingDO {
	protected getSchemaHints(data: unknown): SchemaHints | undefined {
		if (!data || typeof data !== "object") return undefined;

		if (Array.isArray(data)) {
			const sample = data[0];
			if (!isRecord(sample)) return undefined;

			// Patent records
			if ("patent_id" in sample || "patent_number" in sample || "patent_title" in sample) {
				return {
					tableName: "patents",
					indexes: ["patent_id", "patent_number", "patent_date", "patent_type"],
				};
			}
			// Assignee records
			if ("assignee_id" in sample || "assignee_organization" in sample) {
				return {
					tableName: "assignees",
					indexes: ["assignee_id", "assignee_organization", "assignee_type"],
				};
			}
			// Inventor records
			if ("inventor_id" in sample || "inventor_first_name" in sample || "inventor_last_name" in sample) {
				return {
					tableName: "inventors",
					indexes: ["inventor_id", "inventor_last_name", "inventor_city"],
				};
			}
			// CPC class records
			if ("cpc_group_id" in sample || "cpc_class_id" in sample || "cpc_subclass_id" in sample) {
				return {
					tableName: "cpc_classes",
					indexes: ["cpc_group_id", "cpc_class_id", "cpc_subclass_id"],
				};
			}
			// Generic patentsview data
			return {
				tableName: "patentsview_data",
				indexes: [],
			};
		}

		// Single object with patents or patent_id
		if (isRecord(data)) {
			if ("patent_id" in data || "patents" in data) {
				return {
					tableName: "patent_record",
					indexes: ["patent_id"],
				};
			}
		}

		return undefined;
	}
}
