import { expect, it } from "vitest";
import { boundedText } from "./bounded-read";
it("preserves multibyte data", async () => { expect(await boundedText(new Response("α😀"))).toBe("α😀"); });
it("bounds bytes instead of string characters", async () => { await expect(boundedText(new Response("α".repeat(3 * 1024 * 1024)))).rejects.toThrow("4 MiB"); });
it("rejects corrupt UTF-8", async () => { await expect(boundedText(new Response(new Uint8Array([255])))).rejects.toThrow(); });
