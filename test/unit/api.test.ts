import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMyMLHApi } from "../../src/mymlh/api";
import type { Props } from "../../src/types";
import { stubFetch } from "../helpers/stub-fetch";

const env = {
  MYMLH_CLIENT_ID: "cid",
  MYMLH_CLIENT_SECRET: "sec",
} as unknown as Env;

function harness(initial: Props) {
  let state = { ...initial };
  const getProps = () => state;
  const updateProps = vi.fn(async (next: Props) => {
    state = { ...next };
  });
  const api = makeMyMLHApi(env, getProps, updateProps);
  return { api, getProps, updateProps };
}

const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMyMLHWithAutoRefresh", () => {
  it("does not refresh when token is fresh", async () => {
    const { api, updateProps } = harness({
      id: "u",
      first_name: "F",
      last_name: "L",
      email: "e",
      accessToken: "AT",
      refreshToken: "RT",
      expiresIn: 3600,
      accessTokenIssuedAt: now(),
    });

    const { calls } = stubFetch([{ status: 200, body: JSON.stringify({ id: "u" }) }]);

    const resp = await api.fetchMyMLHWithAutoRefresh("https://api.mlh.com/v4/users/me");
    expect(resp.status).toBe(200);
    expect(updateProps).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.mlh.com/v4/users/me");
    const authHeader = new Headers(calls[0].init.headers as HeadersInit).get("Authorization");
    expect(authHeader).toBe("Bearer AT");
  });

  it("proactively refreshes when within 60s of expiry", async () => {
    const { api, updateProps } = harness({
      id: "u",
      first_name: "F",
      last_name: "L",
      email: "e",
      accessToken: "AT_old",
      refreshToken: "RT",
      expiresIn: 3600,
      accessTokenIssuedAt: now() - 3600, // already expired
    });

    const { calls } = stubFetch([
      // First call: refresh token POST to my.mlh.io
      { status: 200, body: JSON.stringify({ access_token: "AT_new", expires_in: 3600 }) },
      // Second call: api.mlh.com with new token
      { status: 200, body: JSON.stringify({ id: "u" }) },
    ]);

    const resp = await api.fetchMyMLHWithAutoRefresh("https://api.mlh.com/v4/users/me");
    expect(resp.status).toBe(200);
    expect(updateProps).toHaveBeenCalledTimes(1);
    // First call should be the token refresh POST
    expect(calls[0].url).toBe("https://my.mlh.io/oauth/token");
    expect(calls[0].init.method).toBe("POST");
    // Second call should be the api call with new token
    expect(calls[1].url).toBe("https://api.mlh.com/v4/users/me");
    const authHeader = new Headers(calls[1].init.headers as HeadersInit).get("Authorization");
    expect(authHeader).toBe("Bearer AT_new");
  });

  it("retries once on 401 with refreshed token", async () => {
    const { api, updateProps } = harness({
      id: "u",
      first_name: "F",
      last_name: "L",
      email: "e",
      accessToken: "AT_old",
      refreshToken: "RT",
      expiresIn: 3600,
      accessTokenIssuedAt: now(),
    });

    const { calls } = stubFetch([
      // First call: api.mlh.com returns 401
      { status: 401, body: "unauth" },
      // Second call: token refresh POST
      { status: 200, body: JSON.stringify({ access_token: "AT_new", expires_in: 3600 }) },
      // Third call: api.mlh.com with new token
      { status: 200, body: JSON.stringify({ id: "u" }) },
    ]);

    const resp = await api.fetchMyMLHWithAutoRefresh("https://api.mlh.com/v4/users/me");
    expect(resp.status).toBe(200);
    expect(updateProps).toHaveBeenCalled();
    // First call: api with old token
    expect(calls[0].url).toBe("https://api.mlh.com/v4/users/me");
    const auth0 = new Headers(calls[0].init.headers as HeadersInit).get("Authorization");
    expect(auth0).toBe("Bearer AT_old");
    // Second call: token refresh
    expect(calls[1].url).toBe("https://my.mlh.io/oauth/token");
    // Third call: api with new token
    expect(calls[2].url).toBe("https://api.mlh.com/v4/users/me");
    const auth2 = new Headers(calls[2].init.headers as HeadersInit).get("Authorization");
    expect(auth2).toBe("Bearer AT_new");
  });

  it("does not clear tokens proactively when no refresh token and access token still works", async () => {
    const { api, getProps, updateProps } = harness({
      id: "u",
      first_name: "F",
      last_name: "L",
      email: "e",
      accessToken: "AT_valid",
      refreshToken: undefined,
      expiresIn: 3600,
      accessTokenIssuedAt: now() - 3600, // within refresh threshold (near-expiry)
    });

    const { calls } = stubFetch([
      // Only call: api.mlh.com returns 200 (token still valid)
      { status: 200, body: JSON.stringify({ id: "u" }) },
    ]);

    const resp = await api.fetchMyMLHWithAutoRefresh("https://api.mlh.com/v4/users/me");
    expect(resp.status).toBe(200);
    // No token endpoint was called
    expect(calls.every((c) => c.url !== "https://my.mlh.io/oauth/token")).toBe(true);
    // Access token must not be cleared
    expect(getProps().accessToken).toBe("AT_valid");
    // updateProps not called (no refresh happened)
    expect(updateProps).not.toHaveBeenCalled();
  });

  it("clears tokens on double 401", async () => {
    const { api, getProps, updateProps } = harness({
      id: "u",
      first_name: "F",
      last_name: "L",
      email: "e",
      accessToken: "AT_old",
      refreshToken: "RT",
      expiresIn: 3600,
      accessTokenIssuedAt: now(),
    });

    const { calls } = stubFetch([
      // First call: api.mlh.com returns 401
      { status: 401, body: "unauth" },
      // Second call: token refresh POST succeeds
      { status: 200, body: JSON.stringify({ access_token: "AT_new", expires_in: 3600 }) },
      // Third call: api.mlh.com returns 401 again
      { status: 401, body: "unauth" },
    ]);

    const resp = await api.fetchMyMLHWithAutoRefresh("https://api.mlh.com/v4/users/me");
    expect(resp.status).toBe(401);
    expect(updateProps).toHaveBeenCalled();
    expect(getProps().accessToken).toBe("");
    // Verify call sequence
    expect(calls[0].url).toBe("https://api.mlh.com/v4/users/me");
    expect(calls[1].url).toBe("https://my.mlh.io/oauth/token");
    expect(calls[2].url).toBe("https://api.mlh.com/v4/users/me");
  });
});
