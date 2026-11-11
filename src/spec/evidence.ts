import type { ApiCatalog, ParamDef } from "@bio-mcp/shared/codemode/catalog";

const publicationParams: ParamDef[] = [
  { name: "authority", type: "string", required: true, description: "Two-letter publication authority (path parameter)." },
  { name: "number", type: "string", required: true, description: "Bare publication number (path parameter)." },
  { name: "kind", type: "string", required: false, description: "Optional seed publication kind (A1/B1/etc.). Omit to select every kind sharing the authority/number." },
];
const paging: ParamDef[] = [
  { name: "limit", type: "number", required: false, description: "1..200 rows, default 50. A row is not necessarily a distinct applicant or family member." },
  { name: "offset", type: "number", required: false, description: "0..10000, default 0. Live pages are not snapshot-pinned." },
];

export const evidenceEndpoints: ApiCatalog["endpoints"] = [
  {
    method: "GET", path: "/lod/publication/{authority}/{number}/simple-family", category: "family",
    summary: "Keyless DOCDB simple-family member/application/publication links",
    description: "Local SPARQL workflow using EPO familyMemberOf and familyMember. Distinguishes simple families from same-application publications and INPADOC extended families. Retains members without publication links, native RDF bindings, exact query, tier and incomplete/paging context. EPO LOD coverage is limited; this is not an exhaustive worldwide family or legal-status determination.",
    queryParams: [...publicationParams, ...paging],
    example: 'return await api.get("/lod/publication/EP/1000000/simple-family", {kind:"A1", limit:50});',
  },
  {
    method: "GET", path: "/lod/publication/{authority}/{number}/applicants", category: "applicant",
    summary: "Applicant source records and conservative name-comparison hints for a publication",
    description: "Local workflow retains vCard URI, native name/language, address-property evidence and publication link. comparison_name applies NFKC, whitespace folding and lowercase only. No company-name suffix removal, fuzzy merging or ownership inference. A vCard hash identifies a source record, not a canonical legal entity.",
    queryParams: [...publicationParams, ...paging],
    example: 'return await api.get("/lod/publication/EP/1430076/applicants", {kind:"A2", limit:50});',
  },
  {
    method: "GET", path: "/lod/search/applicant-evidence", category: "applicant",
    summary: "Find applicant candidates while retaining source identities and addresses",
    description: "Local workflow with native RDF rows and the same conservative comparison hints as /applicants. Exact or substring name matching is candidate retrieval, not legal-entity resolution. Inspect differing source records before cross-patent aggregation.",
    queryParams: [
      { name: "name", type: "string", required: true, description: "3..300-character applicant name." },
      { name: "match", type: "string", required: false, enum: ["exact", "contains"], description: "Defaults to exact native name. Contains is a potentially slower substring search." }, ...paging,
    ],
    example: 'return await api.get("/lod/search/applicant-evidence", {name:"Novartis AG", match:"exact", limit:50});',
  },
  {
    method: "GET", path: "/published-data/publication/{format}/{number}/equivalents/biblio", category: "family",
    summary: "Credentialed OPS DOCDB simple-family equivalents with bibliographic data",
    description: "Existing OPS equivalents constituent, distinct from /family (INPADOC extended family). Preserve native publication/application IDs, family IDs and applicant name data-format fields. Does not establish current ownership or freedom to operate.",
    queryParams: [
      { name: "format", type: "string", required: true, enum: ["epodoc", "docdb"], description: "OPS reference format (path parameter)." },
      { name: "number", type: "string", required: true, description: "Reference, for example EP1000000.A1 (epodoc)." },
    ],
    example: 'return await api.get("/published-data/publication/epodoc/EP1000000.A1/equivalents/biblio");',
  },
];

export const evidenceWorkflows: NonNullable<ApiCatalog["workflows"]> = [
  { title: "Inspect a DOCDB simple family", description: "Fetch bounded member links with original RDF evidence; check staging before inspecting rows.", keywords: ["family", "DOCDB", "INPADOC", "deduplication"],
    code: 'const family = await api.get("/lod/publication/EP/1000000/simple-family", {kind:"A1", limit:50}); return family;' },
  { title: "Compare applicant names without merging identities", description: "Review candidate vCard IDs and original names/address evidence. Normalization is a comparison aid only.", keywords: ["applicant", "normalization", "organization", "assignee"],
    code: 'const candidates = await api.get("/lod/search/applicant-evidence", {name:"Novartis", match:"contains", limit:50}); if (candidates.__staged) return candidates; return candidates;' },
];
