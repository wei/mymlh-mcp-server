import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { injectTestSecrets } from "../helpers/setup-env";

async function registerClient() {
  const resp = await SELF.fetch("https://worker.test/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test Client",
      redirect_uris: ["https://client.test/cb"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(resp.status).toBe(201);
  return (await resp.json()) as { client_id: string; redirect_uris: string[] };
}

describe("/authorize", () => {
  beforeEach(() => {
    injectTestSecrets();
  });

  it("GET /authorize without approval cookie renders dialog", async () => {
    const { client_id, redirect_uris } = await registerClient();
    const url = new URL("https://worker.test/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client_id);
    url.searchParams.set("redirect_uri", redirect_uris[0]);
    url.searchParams.set("code_challenge", "c".repeat(43));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", "xyz");

    const resp = await SELF.fetch(url.href);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/html");
    const html = await resp.text();
    expect(html).toContain("Test Client");
    expect(html).toContain("MyMLH MCP Server");
  });

  it("POST /authorize with encoded state redirects to MyMLH authorize URL", async () => {
    const { client_id, redirect_uris } = await registerClient();
    const oauthReqInfo = {
      clientId: client_id,
      redirectUri: redirect_uris[0],
      scope: [],
      state: "xyz",
      responseType: "code",
      codeChallenge: "c".repeat(43),
      codeChallengeMethod: "S256",
    };
    const form = new FormData();
    form.set("state", btoa(JSON.stringify({ oauthReqInfo })));

    const resp = await SELF.fetch("https://worker.test/authorize", {
      method: "POST",
      body: form,
      redirect: "manual",
    });
    expect(resp.status).toBe(302);
    const loc = resp.headers.get("location") ?? "";
    expect(loc).toContain("https://www.mlh.com/oauth/authorize");
    expect(loc).toContain("prompt=consent");
    expect(loc).toContain("client_id=test-client-id");
    expect(resp.headers.get("set-cookie")).toContain("mcp-approved-clients=");
    expect(resp.headers.get("set-cookie")).toContain("Max-Age=5");
    // Upstream state must be the short KV token, never the signed JSON blob:
    // MLH's /signin 500s once state exceeds ~370 chars (session cookie overflow).
    const upstreamState = new URL(loc).searchParams.get("state") ?? "";
    expect(upstreamState).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
