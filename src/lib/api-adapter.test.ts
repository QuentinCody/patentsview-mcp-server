import { afterEach, expect, it, vi } from "vitest";
import { createEpoOpsApiFetch } from "./api-adapter";
const api = createEpoOpsApiFetch({ EPO_OPS_KEY: "", EPO_OPS_SECRET: "" });
afterEach(() => vi.unstubAllGlobals());

it("routes keyless applicant evidence without touching OPS or dropping RDF metadata", async () => {
  const native = { head: { vars: ["name"], link: ["fixture"] }, results: { bindings: [{ name: { type: "literal", value: "Acme AG", "xml:lang": "de" } }] }, extension: "retained" };
  const fetch = vi.fn(async () => Response.json(native)); vi.stubGlobal("fetch", fetch);
  expect((await api({ method: "GET", path: "/lod/search/applicant-evidence", params: { name: "Acme AG" } })).data).toMatchObject({ native, applicants: [{ native_name: native.results.bindings[0].name, comparison_name: "acme ag", legal_entity_verified: false }], _meta: { tier: "epo-lod", credentialed: false, sparql: expect.any(String) } });
  expect(fetch.mock.calls).toHaveLength(1);
});
it("retains empty-family uncertainty without probing or inventing members", async () => {
  const fetch = vi.fn(async () => Response.json({ head: {}, results: { bindings: [] } })); vi.stubGlobal("fetch", fetch);
  expect((await api({ method: "GET", path: "/lod/publication/EP/1000000/simple-family", params: {} })).data).toMatchObject({ _workflow: { kind: "docdb_simple_family", paging: { completeness: "unverified" } }, native: { results: { bindings: [] } } });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("keeps the OPS equivalents route credentialed", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(api({ method: "GET", path: "/published-data/publication/epodoc/EP1000000.A1/equivalents/biblio" })).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });
  expect(fetch).not.toHaveBeenCalled();
});
it("preserves the existing LOD result shape", async () => {
  const native = { head: {}, results: { bindings: [{ publication: { type: "uri", value: "https://data.epo.org/fixture" } }] } };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  expect((await api({ method: "GET", path: "/lod/publication/EP/1000000/application" })).data).toMatchObject(native);
});
it("rejects POST instead of silently substituting GET", async () => {
  await expect(api({ method: "POST", path: "/lod/search/applicant-evidence", body: { name: "Acme" } })).rejects.toThrow("GET");
});
