import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("/mcp unauthorized", () => {
  it("returns 401 with a WWW-Authenticate header", async () => {
    const resp = await SELF.fetch("https://worker.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(resp.status).toBe(401);
    expect(resp.headers.get("www-authenticate")).toBeTruthy();
  });

  it("liveness route returns 200 JSON", async () => {
    const resp = await SELF.fetch("https://worker.test/");
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { name: string };
    expect(json.name).toBe("mymlh-mcp-server");
  });
});
