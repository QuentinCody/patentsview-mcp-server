import type { EvidenceQuery } from "./evidence-queries";
import type { SparqlResults, SparqlBinding } from "./lod";

/** A name comparison hint, never an organization identity or ownership assertion. */
export function applicantCandidate(binding: Record<string, SparqlBinding>): Record<string, unknown> {
  const name = binding.name?.value;
  const record = binding.applicantRecord;
  return {
    publication: binding.publication ?? null,
    applicant_record: record ?? null,
    source_record_key: record?.type === "uri" ? record.value : null,
    native_name: binding.name ?? null,
    comparison_name: typeof name === "string" ? name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase() : null,
    address: binding.address ?? null,
    address_property: binding.addressProperty ?? null,
    address_value: binding.addressValue ?? null,
    legal_entity_verified: false,
  };
}

export function evidenceView(native: SparqlResults, query: EvidenceQuery): Record<string, unknown> {
  const rows = native.results.bindings;
  return {
    native,
    _workflow: {
      kind: query.kind, retrieved_at: new Date().toISOString(), release: null,
      paging: { limit: query.limit, offset: query.offset, returned_rows: rows.length,
        next_offset: rows.length >= query.limit && query.offset + rows.length <= 10000 ? query.offset + rows.length : null,
        page_limit_reached: rows.length >= query.limit,
        offset_limit_reached: query.offset + rows.length > 10000,
        completeness: "unverified", snapshot_pinned: false },
      family_definition: query.kind === "docdb_simple_family" ? "DOCDB simple family; distinct from same-application publications and INPADOC extended family" : null,
      caveat: "LOD covers EP records and related non-EP identifiers. Empty or bounded results do not prove absence or worldwide completeness. Pages can drift as the live graph changes. Applicant vCard URIs identify source records, not canonical legal entities; comparison names do not establish equivalence, ownership or current proprietor status.",
    },
    ...(query.kind === "applicant_candidates" ? { applicants: rows.map(applicantCandidate) } : {}),
  };
}
