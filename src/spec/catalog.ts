import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const patentsviewCatalog: ApiCatalog = {
	name: "USPTO PatentsView",
	baseUrl: "https://search.patentsview.org/api/v1",
	version: "1.0",
	auth: "apiKey",
	endpointCount: 4,
	notes:
		"AUTH: Requires X-Api-Key header. Set PATENTSVIEW_API_KEY env var.\n" +
		"NOTE: New API key grants are temporarily suspended as of 2026-03.\n" +
		"- Rate limit: 45 req/min\n" +
		"- Elasticsearch-based REST/JSON API\n" +
		"- Query params: q (JSON query object), f (fields to return), s (sort), o (options with per_page, page)\n" +
		"- Example q: {\"_gte\":{\"patent_date\":\"2023-01-01\"}}\n" +
		"- Example f: [\"patent_id\",\"patent_title\",\"patent_date\"]\n" +
		"- Pagination via o: {\"per_page\":25,\"page\":1}",
	endpoints: [
		{
			method: "GET",
			path: "/patent/",
			summary: "Search and retrieve patent records by criteria such as date, title, abstract, type, or associated entities",
			category: "patent",
			queryParams: [
				{ name: "q", type: "string", required: true, description: "JSON query object (e.g., {\"_gte\":{\"patent_date\":\"2023-01-01\"}})" },
				{ name: "f", type: "string", required: false, description: "JSON array of fields to return (e.g., [\"patent_id\",\"patent_title\"])" },
				{ name: "s", type: "string", required: false, description: "JSON sort specification (e.g., [{\"patent_date\":\"desc\"}])" },
				{ name: "o", type: "string", required: false, description: "JSON options object (e.g., {\"per_page\":25,\"page\":1})" },
			],
		},
		{
			method: "GET",
			path: "/assignee/",
			summary: "Search patent assignees (organizations and individuals) by name, location, or patent criteria",
			category: "assignee",
			queryParams: [
				{ name: "q", type: "string", required: true, description: "JSON query object for assignee search" },
				{ name: "f", type: "string", required: false, description: "JSON array of fields to return" },
				{ name: "s", type: "string", required: false, description: "JSON sort specification" },
				{ name: "o", type: "string", required: false, description: "JSON options object for pagination" },
			],
		},
		{
			method: "GET",
			path: "/inventor/",
			summary: "Search patent inventors by name, location, or associated patent criteria",
			category: "inventor",
			queryParams: [
				{ name: "q", type: "string", required: true, description: "JSON query object for inventor search" },
				{ name: "f", type: "string", required: false, description: "JSON array of fields to return" },
				{ name: "s", type: "string", required: false, description: "JSON sort specification" },
				{ name: "o", type: "string", required: false, description: "JSON options object for pagination" },
			],
		},
		{
			method: "GET",
			path: "/cpc_class/",
			summary: "Search CPC (Cooperative Patent Classification) classes and subclasses",
			category: "classification",
			queryParams: [
				{ name: "q", type: "string", required: true, description: "JSON query object for CPC class search" },
				{ name: "f", type: "string", required: false, description: "JSON array of fields to return" },
				{ name: "s", type: "string", required: false, description: "JSON sort specification" },
				{ name: "o", type: "string", required: false, description: "JSON options object for pagination" },
			],
		},
	],
};
