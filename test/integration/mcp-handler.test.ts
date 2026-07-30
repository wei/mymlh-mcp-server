/**
 * Exercises the stateless MCP handler directly, bypassing the OAuth provider so
 * props can be injected. Covers both wire eras the single /mcp route serves:
 * 2026-07-28 (per-request _meta envelope) and legacy 2025 (initialize handshake).
 */
import { createMcpHandler } from "agents/mcp/server";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../../src/mcp/server";
import type { Props } from "../../src/types";

const props: Props = {
  id: "u",
  first_name: "F",
  last_name: "L",
  email: "e@example.test",
  accessToken: "AT",
  scope: "public user:read:profile",
};

const handler = createMcpHandler(() => createMcpServer(), {
  route: "/mcp",
  authContext: { props },
});

const MODERN_ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://worker.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function readJsonRpc(resp: Response): Promise<Record<string, unknown>> {
  const text = await resp.text();
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) return JSON.parse(text);
  // SSE frame: pick the first `data:` line.
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw new Error(`No SSE data frame in response: ${text}`);
  return JSON.parse(line.slice("data:".length).trim());
}

describe("stateless /mcp handler", () => {
  it("lists tools for a 2026-07-28 request with no prior handshake", async () => {
    const resp = await handler.fetch(
      post(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN_ENVELOPE } },
        { "Mcp-Method": "tools/list" },
      ),
    );

    expect(resp.status).toBe(200);
    const body = (await readJsonRpc(resp)) as {
      result?: { tools?: { name: string }[]; resultType?: string; cacheScope?: string };
      error?: unknown;
    };
    expect(body.error).toBeUndefined();
    expect(body.result?.tools?.map((t) => t.name)).toContain("mymlh_get_user");
    // 2026-07-28 result shape: completion status and list cacheability.
    expect(body.result?.resultType).toBe("complete");
    expect(body.result?.cacheScope).toBe("private");
  });

  it("still serves legacy 2025-era clients on the same route", async () => {
    const resp = await handler.fetch(
      post({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "legacy-client", version: "1.0.0" },
        },
      }),
    );

    expect(resp.status).toBe(200);
    const body = (await readJsonRpc(resp)) as { result?: { serverInfo?: { name: string } }; error?: unknown };
    expect(body.error).toBeUndefined();
    expect(body.result?.serverInfo?.name).toBe("mymlh-mcp-server");
  });

  it("rejects a request for a route it does not own", async () => {
    const resp = await handler.fetch(new Request("https://worker.test/sse", { method: "POST" }));
    expect(resp.status).toBe(404);
  });
});
