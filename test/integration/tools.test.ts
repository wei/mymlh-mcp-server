/**
 * NOTE: Outbound HTTP mocking (fetchMock) is not available in @cloudflare/vitest-pool-workers.
 * A full OAuth round-trip (register -> authorize -> callback -> token -> /mcp tools/list + tools/call)
 * is not covered here because the /callback step requires mocking https://my.mlh.io/oauth/token
 * and https://api.mlh.com/v4/users/me, which cannot be intercepted from the test runner when
 * the Worker runs in a separate isolate via SELF.fetch.
 *
 * The tool registration logic (mymlh_get_user) is covered by unit tests in test/unit/.
 * This file verifies that the /mcp endpoint is wired up and protected by OAuth — i.e.,
 * invalid bearer tokens are rejected.
 */
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { injectTestSecrets } from "../helpers/setup-env";

beforeEach(() => {
  injectTestSecrets({ MYMLH_CLIENT_ID: "cid", MYMLH_CLIENT_SECRET: "sec", COOKIE_ENCRYPTION_KEY: "cookie-secret" });
});

describe("/mcp tool calls", () => {
  it("rejects a fake bearer token with 401", async () => {
    const resp = await SELF.fetch("https://worker.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer totally-fake-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(resp.status).toBe(401);
    expect(resp.headers.get("www-authenticate")).toBeTruthy();
  });

  it("rejects a malformed Authorization header with 401", async () => {
    const resp = await SELF.fetch("https://worker.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Basic dXNlcjpwYXNz",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(resp.status).toBe(401);
  });
});
