import { afterEach, expect, it, vi } from "vitest";
import { epoOpsFetch } from "./http";
afterEach(() => vi.unstubAllGlobals());
it("scopes token reuse to credentials and keeps query encoding", async () => {
  const token = vi.fn(); const auth: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    expect(init.redirect).toBe("manual"); expect(init.signal).toBeTruthy();
    if (url.includes("accesstoken")) {
      token(headers.get("Authorization"));
      return Response.json({ access_token: `token-${token.mock.calls.length}`, expires_in: "1200" });
    }
    expect(new URL(url).searchParams.get("q")).toBe('pa="A & B"');
    auth.push(headers.get("Authorization") ?? ""); return Response.json({});
  });
  const a = { EPO_OPS_KEY: "fixture-a", EPO_OPS_SECRET: "fixture-a-secret" };
  const b = { EPO_OPS_KEY: "fixture-b", EPO_OPS_SECRET: "fixture-b-secret" };
  for (const env of [a, a, b]) await epoOpsFetch("/published-data/search", env, { q: 'pa="A & B"', Range: "1-10" });
  a.EPO_OPS_SECRET = "rotated-fixture";
  await epoOpsFetch("/published-data/search", a, { q: 'pa="A & B"' });
  expect(auth).toEqual(["Bearer token-1", "Bearer token-1", "Bearer token-2", "Bearer token-3"]);
});
it("refreshes an unauthorized token once", async () => {
  let tokens = 0; let calls = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("accesstoken")) return Response.json({ access_token: `fixture-${++tokens}`, expires_in: 1200 });
    return new Response("", { status: ++calls === 1 ? 401 : 200 });
  });
  expect((await epoOpsFetch("/published-data/search", { EPO_OPS_KEY: "fixture", EPO_OPS_SECRET: "fixture" })).status).toBe(200);
  expect(tokens).toBe(2); expect(calls).toBe(2);
});
it("does not issue an API request after a malformed token response", async () => {
  const fetch = vi.fn(async () => Response.json({ expires_in: "1200" })); vi.stubGlobal("fetch", fetch);
  await expect(epoOpsFetch("/published-data/search", { EPO_OPS_KEY: "fixture", EPO_OPS_SECRET: "fixture" })).rejects.toThrow("no access token");
  expect(fetch).toHaveBeenCalledTimes(1);
});
