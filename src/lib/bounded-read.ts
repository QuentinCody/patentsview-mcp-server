const MAX_BYTES = 4 * 1024 * 1024;
export async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: string[] = []; let bytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("EPO response exceeds 4 MiB; narrow the request");
      chunks.push(decoder.decode(part.value, { stream: true }));
    }
    chunks.push(decoder.decode()); return chunks.join("");
  } finally { void reader.cancel().catch(() => {}); } // Best-effort stream cleanup.
}
