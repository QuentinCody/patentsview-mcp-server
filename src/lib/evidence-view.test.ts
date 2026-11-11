import { expect, it } from "vitest";
import { applicantCandidate, evidenceView } from "./evidence-view";
import type { SparqlResults } from "./lod";

it("preserves original names and only supplies a comparison hint", () => {
  const native = { name: { type: "literal", value: "  ＡＣＭＥ   S.A. ", "xml:lang": "fr" }, applicantRecord: { type: "uri", value: "https://data.epo.org/data/vc/fixture" } };
  expect(applicantCandidate(native)).toMatchObject({ native_name: native.name, comparison_name: "acme s.a.", source_record_key: native.applicantRecord.value, legal_entity_verified: false });
  expect(applicantCandidate({ name: { type: "literal", value: "Acme SA" } }).comparison_name).toBe("acme sa");
});
it("does not turn missing names or blank nodes into canonical IDs", () => {
  expect(applicantCandidate({ applicantRecord: { type: "bnode", value: "b1" } })).toMatchObject({ comparison_name: null, source_record_key: null });
});
it("keeps duplicate candidates, native RDF types and provider extensions intact", () => {
  const binding = { applicantRecord: { type: "uri", value: "https://data.epo.org/data/vc/fixture" }, name: { type: "literal", value: "Acme" } };
  const native: SparqlResults = { head: { vars: ["name"] }, results: { bindings: [binding, binding] } };
  const result = evidenceView(native, { query: "fixture", kind: "applicant_candidates", limit: 2, offset: 0 });
  expect(result.native).toBe(native);
  expect(result.applicants).toHaveLength(2);
  expect(result._workflow).toMatchObject({ paging: { returned_rows: 2, next_offset: 2, snapshot_pinned: false, completeness: "unverified" } });
});
it("does not call an empty family result complete or infer family membership", () => {
  const native = { head: {}, results: { bindings: [] } };
  expect(evidenceView(native, { query: "fixture", kind: "docdb_simple_family", limit: 50, offset: 0 })).toMatchObject({ native, _workflow: { kind: "docdb_simple_family", release: null, paging: { next_offset: null, completeness: "unverified" } } });
});
