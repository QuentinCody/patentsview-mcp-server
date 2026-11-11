import { escapeSparqlLiteral, normalizeAuthority, normalizePublicationNumber } from "./lod-queries";

const PREFIXES = `PREFIX patent: <http://data.epo.org/linked-data/def/patent/>
PREFIX vcard: <http://www.w3.org/2006/vcard/ns#>`;
export interface EvidenceQuery { query: string; kind: "docdb_simple_family" | "applicant_candidates"; limit: number; offset: number }

function integer(value: unknown, fallback: number, max: number, min: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" && typeof value !== "string") throw new Error("Expected a numeric paging value");
  const parsed = Number(value);
  if (value === null || value === "" || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`Expected integer in ${min}..${max}`);
  return parsed;
}

function publication(authority: string, number: string, kind: unknown): string {
  let selector = `?publication patent:publicationAuthority <http://data.epo.org/linked-data/id/st3/${normalizeAuthority(authority)}> ; patent:publicationNumber "${normalizePublicationNumber(number)}" .`;
  if (kind !== undefined) {
    if (typeof kind !== "string" || !/^[A-Z][0-9]?$/.test(kind)) throw new Error("kind must be an EPO publication kind such as A1 or B1");
    selector += `\n?publication patent:publicationKind patent:publicationKind_${kind} .`;
  }
  return selector;
}

function familyQuery(selector: string): string {
  return `SELECT DISTINCT ?publication ?application ?family ?member ?memberPublication ?authority ?number ?kind ?date WHERE {
${selector}
?publication patent:application ?application .
?application patent:familyMemberOf ?family .
?family patent:familyMember ?member .
OPTIONAL { ?memberPublication patent:application ?member .
  OPTIONAL { ?memberPublication patent:publicationAuthority ?authority }
  OPTIONAL { ?memberPublication patent:publicationNumber ?number }
  OPTIONAL { ?memberPublication patent:publicationKind ?kind }
  OPTIONAL { ?memberPublication patent:publicationDate ?date }
}
} ORDER BY ?publication ?family ?member ?memberPublication ?authority ?number ?kind ?date`;
}

function applicantQuery(selector: string): string {
  return `SELECT DISTINCT ?publication ?applicantRecord ?name ?address ?addressProperty ?addressValue WHERE {
${selector}
?publication patent:applicantVC ?applicantRecord .
OPTIONAL { ?applicantRecord vcard:fn ?name }
OPTIONAL { ?applicantRecord vcard:hasAddress ?address . ?address ?addressProperty ?addressValue }
} ORDER BY ?publication ?applicantRecord ?name ?address ?addressProperty ?addressValue`;
}

function nameSelector(params: Record<string, unknown>): string {
  if (typeof params.name !== "string" || params.name.trim().length < 3 || params.name.length > 300) throw new Error("name must contain 3..300 characters");
  const name = params.name.trim();
  if (params.match === undefined || params.match === "exact") return `?applicantRecord vcard:fn "${escapeSparqlLiteral(name)}" .`;
  if (params.match !== "contains") throw new Error("match must be exact or contains");
  return `?applicantRecord vcard:fn ?matchedName . FILTER(CONTAINS(LCASE(STR(?matchedName)), "${escapeSparqlLiteral(name.toLowerCase())}"))`;
}

/** Uses the published EPO ontology; deployed namespace/data coverage still needs live acceptance. */
export function evidenceQuery(path: string, params: Record<string, unknown>): EvidenceQuery | null {
  const match = /^\/lod\/publication\/([^/]+)\/([^/]+)\/(simple-family|applicants)$/.exec(path);
  if (!match && path !== "/lod/search/applicant-evidence") return null;
  const limit = integer(params.limit, 50, 200, 1); const offset = integer(params.offset, 0, 10000, 0);
  const selector = match ? publication(match[1], match[2], params.kind) : nameSelector(params);
  const kind = match?.[3] === "simple-family" ? "docdb_simple_family" : "applicant_candidates";
  const body = kind === "docdb_simple_family" ? familyQuery(selector) : applicantQuery(selector);
  return { query: `${PREFIXES}\n${body}\nLIMIT ${limit}\nOFFSET ${offset}`, kind, limit, offset };
}
