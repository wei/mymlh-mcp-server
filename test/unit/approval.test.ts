import { describe, expect, it } from "vitest";
import { clientIdAlreadyApproved, parseRedirectApproval } from "../../src/oauth/approval";
import { buildSetCookie, readApprovedClients } from "../../src/oauth/approval/cookie";

const SECRET = "test-secret-key";

function makeGet(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { method: "GET", headers });
}

function makePost(url: string, body: FormData, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", body, headers });
}

describe("clientIdAlreadyApproved", () => {
  it("returns false when no cookie", async () => {
    const req = makeGet("https://s.test/authorize");
    expect(await clientIdAlreadyApproved(req, "c-1", SECRET)).toBe(false);
  });

  it("returns true when cookie contains clientId", async () => {
    const set = await buildSetCookie(["c-1"], SECRET, 60);
    const req = makeGet("https://s.test/authorize", { Cookie: set.split(";")[0] });
    expect(await clientIdAlreadyApproved(req, "c-1", SECRET)).toBe(true);
  });

  it("returns false for missing clientId arg", async () => {
    const set = await buildSetCookie(["c-1"], SECRET, 60);
    const req = makeGet("https://s.test/authorize", { Cookie: set.split(";")[0] });
    expect(await clientIdAlreadyApproved(req, "", SECRET)).toBe(false);
  });
});

describe("parseRedirectApproval", () => {
  it("throws on non-POST", async () => {
    const req = makeGet("https://s.test/authorize");
    await expect(parseRedirectApproval(req, SECRET)).rejects.toThrow();
  });

  it("throws when state missing", async () => {
    const fd = new FormData();
    const req = makePost("https://s.test/authorize", fd);
    await expect(parseRedirectApproval(req, SECRET)).rejects.toThrow();
  });

  it("throws when state is malformed (not valid base64 JSON)", async () => {
    const fd = new FormData();
    fd.set("state", "!!!not-base64!!!");
    const req = makePost("https://s.test/authorize", fd);
    await expect(parseRedirectApproval(req, SECRET)).rejects.toThrow(/decode state/i);
  });

  it("throws when parsed state has no oauthReqInfo.clientId", async () => {
    const fd = new FormData();
    fd.set("state", btoa(JSON.stringify({ oauthReqInfo: { redirectUri: "https://x" } })));
    const req = makePost("https://s.test/authorize", fd);
    await expect(parseRedirectApproval(req, SECRET)).rejects.toThrow(/clientId/);
  });

  it("extracts state and issues Set-Cookie with clientId appended", async () => {
    const state = { oauthReqInfo: { clientId: "c-42" } };
    const fd = new FormData();
    fd.set("state", btoa(JSON.stringify(state)));
    const req = makePost("https://s.test/authorize", fd);
    const { state: parsed, headers } = await parseRedirectApproval(req, SECRET, 5);
    expect(parsed).toEqual(state);
    expect(headers["Set-Cookie"]).toContain("mcp-approved-clients=");
    expect(headers["Set-Cookie"]).toContain("Max-Age=5");
  });

  it("merges with existing approved-clients cookie", async () => {
    const existingSet = await buildSetCookie(["old"], SECRET, 60);
    const state = { oauthReqInfo: { clientId: "new" } };
    const fd = new FormData();
    fd.set("state", btoa(JSON.stringify(state)));
    const req = makePost("https://s.test/authorize", fd, {
      Cookie: existingSet.split(";")[0],
    });
    const { headers } = await parseRedirectApproval(req, SECRET, 60);
    const newCookieHeader = headers["Set-Cookie"].split(";")[0];
    const approved = await readApprovedClients(newCookieHeader, SECRET);
    expect(approved).toEqual(["old", "new"]);
  });
});
