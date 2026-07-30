import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMyMLHApi, refreshUpstreamProps } from "../../src/mymlh/api";
import type { Props } from "../../src/types";
import { stubFetch } from "../helpers/stub-fetch";

const env = {
  MYMLH_CLIENT_ID: "cid",
  MYMLH_CLIENT_SECRET: "sec",
} as unknown as Env;

const baseProps: Props = {
  id: "u",
  first_name: "F",
  last_name: "L",
  email: "e",
  accessToken: "AT",
  refreshToken: "RT",
  expiresIn: 3600,
  accessTokenIssuedAt: Math.floor(Date.now() / 1000),
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMyMLH", () => {
  it("sends the access token from props and does not touch the token endpoint", async () => {
    const api = makeMyMLHApi(() => baseProps);
    const { calls } = stubFetch([{ status: 200, body: JSON.stringify({ id: "u" }) }]);

    const resp = await api.fetchMyMLH("https://api.mlh.com/v4/users/me");

    expect(resp.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.mlh.com/v4/users/me");
    expect(new Headers(calls[0].init.headers as HeadersInit).get("Authorization")).toBe("Bearer AT");
  });

  it("returns a 401 as-is; recovery is the OAuth refresh flow's job", async () => {
    const api = makeMyMLHApi(() => baseProps);
    const { calls } = stubFetch([{ status: 401, body: "unauth" }]);

    const resp = await api.fetchMyMLH("https://api.mlh.com/v4/users/me");

    expect(resp.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it("preserves caller-supplied headers", async () => {
    const api = makeMyMLHApi(() => baseProps);
    const { calls } = stubFetch([{ status: 200, body: "{}" }]);

    await api.fetchMyMLH("https://api.mlh.com/v4/users/me", { headers: { Accept: "application/json" } });

    const headers = new Headers(calls[0].init.headers as HeadersInit);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer AT");
  });
});

describe("refreshUpstreamProps", () => {
  it("exchanges the refresh token and returns updated props", async () => {
    const { calls } = stubFetch([
      { status: 200, body: JSON.stringify({ access_token: "AT_new", refresh_token: "RT_new", expires_in: 7200 }) },
    ]);

    const next = await refreshUpstreamProps(env, baseProps);

    expect(calls[0].url).toBe("https://my.mlh.io/oauth/token");
    expect(calls[0].init.method).toBe("POST");
    expect(String(calls[0].init.body)).toContain("grant_type=refresh_token");
    expect(next?.accessToken).toBe("AT_new");
    expect(next?.refreshToken).toBe("RT_new");
    expect(next?.expiresIn).toBe(7200);
    expect(next?.accessTokenIssuedAt).toBeGreaterThan(0);
    // Identity fields carry over untouched.
    expect(next?.email).toBe("e");
  });

  it("keeps the existing refresh token when MyMLH does not rotate it", async () => {
    stubFetch([{ status: 200, body: JSON.stringify({ access_token: "AT_new", expires_in: 3600 }) }]);

    const next = await refreshUpstreamProps(env, baseProps);

    expect(next?.refreshToken).toBe("RT");
  });

  it("returns null when there is no refresh token", async () => {
    const { calls } = stubFetch([]);

    const next = await refreshUpstreamProps(env, { ...baseProps, refreshToken: undefined });

    expect(next).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null when MyMLH rejects the refresh token", async () => {
    stubFetch([{ status: 401, body: "unauth" }]);

    expect(await refreshUpstreamProps(env, baseProps)).toBeNull();
  });
});
