import { describe, expect, it } from "vitest";
import { renderApprovalDialog } from "../../src/oauth/approval/dialog";

const stubClient = {
  clientId: "c-1",
  clientName: "Example Client",
  clientUri: "https://example.com",
  policyUri: "https://example.com/privacy",
  tosUri: "https://example.com/tos",
  redirectUris: ["https://example.com/cb"],
  contacts: ["dev@example.com"],
  tokenEndpointAuthMethod: "client_secret_basic" as const,
};

function makeRequest() {
  return new Request("https://server.test/authorize?foo=1", { method: "GET" });
}

describe("renderApprovalDialog", () => {
  it("returns text/html; charset=utf-8", async () => {
    const resp = renderApprovalDialog(makeRequest(), {
      client: stubClient,
      server: { name: "MyMLH MCP Server" },
      state: { oauthReqInfo: { clientId: "c-1" } },
    });
    expect(resp.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const text = await resp.text();
    expect(text).toContain("MyMLH MCP Server");
    expect(text).toContain("Example Client");
  });

  it("escapes untrusted HTML in clientName and server description", async () => {
    const resp = renderApprovalDialog(makeRequest(), {
      client: { ...stubClient, clientName: "<script>alert(1)</script>" },
      server: { name: "<img onerror=1>", description: "<b>desc</b>" },
      state: { oauthReqInfo: { clientId: "c-1" } },
    });
    const text = await resp.text();
    expect(text).not.toContain("<script>alert(1)</script>");
    expect(text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(text).not.toContain("<img onerror=1>");
    expect(text).toContain("&lt;img onerror=1&gt;");
    expect(text).not.toMatch(/<b>desc<\/b>/);
    expect(text).toContain("&lt;b&gt;desc&lt;/b&gt;");
  });

  it("omits optional fields when absent", async () => {
    const resp = renderApprovalDialog(makeRequest(), {
      client: { clientId: "c-2", clientName: "Minimal", redirectUris: [], tokenEndpointAuthMethod: "none" },
      server: { name: "S" },
      state: { oauthReqInfo: { clientId: "c-2" } },
    });
    const text = await resp.text();
    expect(text).not.toContain("Privacy Policy:");
    expect(text).not.toContain("Terms of Service:");
    expect(text).not.toContain("Contact:");
  });

  it("form action is the request pathname", async () => {
    const resp = renderApprovalDialog(makeRequest(), {
      client: stubClient,
      server: { name: "S" },
      state: { oauthReqInfo: { clientId: "c-1" } },
    });
    const text = await resp.text();
    expect(text).toContain(`action="/authorize"`);
  });

  it("encodes state as base64 JSON in hidden input", async () => {
    const state = { oauthReqInfo: { clientId: "c-1", extra: "abc" } };
    const resp = renderApprovalDialog(makeRequest(), {
      client: stubClient,
      server: { name: "S" },
      state,
    });
    const text = await resp.text();
    const match = text.match(/name="state" value="([^"]+)"/);
    expect(match).not.toBeNull();
    const decoded = JSON.parse(atob(match?.[1] ?? ""));
    expect(decoded).toEqual(state);
  });
});
