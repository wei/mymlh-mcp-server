import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUpstreamAuthorizeUrl, requestUpstreamToken } from "../../src/oauth/upstream";
import { stubFetch } from "../helpers/stub-fetch";

describe("getUpstreamAuthorizeUrl", () => {
  it("builds an authorize URL with required params and prompt=consent", () => {
    const url = getUpstreamAuthorizeUrl({
      upstream_url: "https://example.test/authorize",
      client_id: "cid",
      scope: "public user:read:profile",
      redirect_uri: "https://my.example/callback",
      state: "abc",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://example.test/authorize");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("https://my.example/callback");
    expect(u.searchParams.get("scope")).toBe("public user:read:profile");
    expect(u.searchParams.get("state")).toBe("abc");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("prompt")).toBe("consent");
  });

  it("omits state if not provided", () => {
    const url = getUpstreamAuthorizeUrl({
      upstream_url: "https://example.test/authorize",
      client_id: "cid",
      scope: "public",
      redirect_uri: "https://my.example/callback",
    });
    expect(new URL(url).searchParams.get("state")).toBeNull();
  });
});

describe("requestUpstreamToken", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs x-www-form-urlencoded for authorization_code grant", async () => {
    const { calls } = stubFetch([
      { status: 200, body: JSON.stringify({ access_token: "AT", token_type: "Bearer", expires_in: 3600 }) },
    ]);

    const [json, err] = await requestUpstreamToken({
      upstream_url: "https://example.test/token",
      client_id: "cid",
      client_secret: "sec",
      grant_type: "authorization_code",
      code: "C",
      redirect_uri: "https://my.example/callback",
    });
    expect(err).toBeNull();
    expect(json?.access_token).toBe("AT");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.test/token");
    expect(calls[0].init.method).toBe("POST");
    const headers = new Headers(calls[0].init.headers as HeadersInit);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(calls[0].init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("C");
    expect(body.get("redirect_uri")).toBe("https://my.example/callback");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("sec");
  });

  it("POSTs refresh_token grant", async () => {
    const { calls } = stubFetch([{ status: 200, body: JSON.stringify({ access_token: "AT2" }) }]);

    const [json] = await requestUpstreamToken({
      upstream_url: "https://example.test/token",
      client_id: "cid",
      client_secret: "sec",
      grant_type: "refresh_token",
      refresh_token: "RT",
    });
    expect(json?.access_token).toBe("AT2");
    const body = new URLSearchParams(calls[0].init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("RT");
  });

  it("returns 400 when authorization_code is missing code", async () => {
    const [json, err] = await requestUpstreamToken({
      upstream_url: "https://example.test/token",
      client_id: "cid",
      client_secret: "sec",
      grant_type: "authorization_code",
      redirect_uri: "https://my.example/callback",
    });
    expect(json).toBeNull();
    expect(err).toBeInstanceOf(Response);
    expect(err?.status).toBe(400);
  });

  it("returns 400 when refresh_token grant is missing refresh_token", async () => {
    const [, err] = await requestUpstreamToken({
      upstream_url: "https://example.test/token",
      client_id: "cid",
      client_secret: "sec",
      grant_type: "refresh_token",
    });
    expect(err?.status).toBe(400);
  });

  it("returns 502 Response when upstream returns non-2xx", async () => {
    stubFetch([{ status: 500, body: "oops", contentType: "text/plain" }]);

    const [, err] = await requestUpstreamToken({
      upstream_url: "https://example.test/token",
      client_id: "cid",
      client_secret: "sec",
      grant_type: "refresh_token",
      refresh_token: "RT",
    });
    expect(err?.status).toBe(502);
  });
});
