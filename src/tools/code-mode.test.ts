import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { createEpoOpsApiFetch } from "../lib/api-adapter";
import { epoOpsCatalog } from "../spec/catalog";
afterEach(() => vi.unstubAllGlobals());

it("registers both aliases and retains historical staging names", async () => {
  const server = new McpServer({ name: "fixture", version: "1" });
  // SAFETY: invalid execution never invokes this fixture loader.
  registerCodeMode(server, { CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1]);
  registerQueryData(server, {}); registerGetSchema(server, {});
  // SAFETY: inspect SDK registry to exercise actual registered callbacks.
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools;
  expect(Object.keys(tools)).toHaveLength(12);
  for (const prefix of ["", "mcp_"]) {
    expect(await tools[prefix + "patents_search"].handler({ query: "simple family", max_results: 2 }, {})).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
    for (const [name, args] of [["patents_execute", { code: "" }], ["patents_query_data", { data_access_id: "fixture", sql: "SELECT 1" }], ["patents_get_schema", { data_access_id: "fixture" }], ["patentsview_query_data", { data_access_id: "fixture", sql: "SELECT 1" }], ["patentsview_get_schema", { data_access_id: "fixture" }]] as const) {
      expect(await tools[prefix + name].handler(args, {})).toMatchObject({ content: expect.any(Array), structuredContent: expect.any(Object), isError: true });
    }
  }
});

it("stages full applicant evidence and native RDF fields with tier metadata", async () => {
  const native = { head: { vars: ["name"] }, results: { bindings: [{ name: { type: "literal", value: "α".repeat(18000), "xml:lang": "el" }, applicantRecord: { type: "uri", value: "https://data.epo.org/data/vc/fixture" } }] }, provider_extension: "fixture" };
  vi.stubGlobal("fetch", async () => Response.json(native));
  const stored: unknown[] = [];
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      // SAFETY: shared staging sends this envelope to the fixture process route.
      const payload = await request.json() as { data: unknown }; stored.push(payload.data);
      return Response.json({ success: true, tables_created: ["applicants"], total_rows: 1 });
    }
    return Response.json({ success: true, schema: { tables: { applicants: { columns: [{ name: "native_name" }] } } } });
  } }) };
  const proxy = createApiProxyTool({ apiFetch: createEpoOpsApiFetch({ EPO_OPS_KEY: "", EPO_OPS_SECRET: "" }), catalog: epoOpsCatalog, doNamespace: namespace, stagingPrefix: "patents", maxInlineBytes: 30 * 1024 });
  const result = await proxy.handler({ method: "GET", path: "/lod/search/applicant-evidence", params: { name: "Acme" } }, { sql: () => [] });
  expect(result).toMatchObject({ __staged: true, data_access_id: expect.any(String), _staging: expect.any(Object) });
  expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toEqual(expect.arrayContaining([expect.objectContaining({ native, _meta: expect.objectContaining({ tier: "epo-lod", sparql: expect.any(String) }), applicants: [expect.objectContaining({ native_name: native.results.bindings[0].name, legal_entity_verified: false })] })]));
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});
