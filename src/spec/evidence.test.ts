import { expect, it, vi } from "vitest";
import { epoOpsCatalog } from "./catalog";
import { evidenceEndpoints, evidenceWorkflows } from "./evidence";
import { evidenceQuery } from "../lib/evidence-queries";

it("routes the documented keyless examples to bounded ontology queries", async () => {
  const get = vi.fn(async (path: string, params: Record<string, unknown>) => {
    expect(evidenceQuery(path, params)?.query).toContain("LIMIT");
    return { __staged: true, data_access_id: "fixture" };
  });
  for (const endpoint of evidenceEndpoints.filter(e => e.path.startsWith("/lod/"))) {
    // Execute only checked-in catalog examples with a fixture API, not external code.
    const run = new Function("api", `return (async () => {${endpoint.example}})()`);
    await expect(run({ get })).resolves.toMatchObject({ __staged: true });
  }
  for (const workflow of evidenceWorkflows) {
    const run = new Function("api", `return (async () => {${workflow.code}})()`);
    await expect(run({ get })).resolves.toMatchObject({ __staged: true });
  }
  expect(epoOpsCatalog.endpointCount).toBe(epoOpsCatalog.endpoints.length);
});
