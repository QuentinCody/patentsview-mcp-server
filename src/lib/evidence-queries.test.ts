import { expect, it } from "vitest";
import { evidenceQuery } from "./evidence-queries";

it("follows the published application → simple family → member relation", () => {
  const result = evidenceQuery("/lod/publication/EP/1000000/simple-family", { kind: "A1", limit: 2, offset: 3 });
  expect(result).toMatchObject({ kind: "docdb_simple_family", limit: 2, offset: 3 });
  expect(result?.query).toContain("?application patent:familyMemberOf ?family");
  expect(result?.query).toContain("?family patent:familyMember ?member");
  // EPO Ontology Specification 1.01 §§5.16/8.50: publicationKind is a resource, not a literal.
  expect(result?.query).toContain("patent:publicationKind patent:publicationKind_A1");
  expect(result?.query).toContain("OPTIONAL { ?memberPublication patent:application ?member");
  expect(result?.query).toMatch(/LIMIT 2\nOFFSET 3$/);
});
it("retains applicant record, publication and address provenance", () => {
  const result = evidenceQuery("/lod/publication/EP/1430076/applicants", {});
  expect(result?.query).toContain("?publication patent:applicantVC ?applicantRecord");
  expect(result?.query).toContain("OPTIONAL { ?applicantRecord vcard:fn ?name }");
  expect(result?.query).toContain("vcard:hasAddress ?address");
});
it("escapes applicant literal quotes/backslashes and preserves exact matching", () => {
  const result = evidenceQuery("/lod/search/applicant-evidence", { name: 'Acme "X"\\ Labs' });
  expect(result?.query).toContain('vcard:fn "Acme \\"X\\"\\\\ Labs"');
  expect(result?.query).not.toContain("CONTAINS");
});
it("makes substring matching explicit", () => {
  expect(evidenceQuery("/lod/search/applicant-evidence", { name: "Acme", match: "contains" })?.query).toContain('CONTAINS(LCASE(STR(?matchedName)), "acme")');
});
it.each([{ limit: 0 }, { limit: 201 }, { limit: false }, { offset: -1 }, { offset: 10001 }, { limit: 1.1 }, { limit: null }, { kind: 'A1" }' }])("rejects invalid controls %j", params => {
  expect(() => evidenceQuery("/lod/publication/EP/1000000/simple-family", params)).toThrow();
});
it.each([{ name: "aa" }, { name: "A\nBC" }, { name: "Acme", match: "fuzzy" }])("rejects invalid applicant selection %j", params => {
  expect(() => evidenceQuery("/lod/search/applicant-evidence", params)).toThrow();
});
it("leaves existing routes to their existing adapter", () => {
  expect(evidenceQuery("/lod/publication/EP/1000000/application", {})).toBeNull();
});
