/**
 * NOTE: Outbound HTTP mocking (fetchMock) is not available in @cloudflare/vitest-pool-workers.
 * The success path of /callback (which calls https://my.mlh.io/oauth/token and
 * https://api.mlh.com/v4/users/me) cannot be tested here without a MockUpstream service binding
 * or undici MockAgent integration. That coverage is omitted; the upstream-call logic is
 * comprehensively covered by the unit tests in test/unit/upstream.test.ts.
 *
 * This file covers the defensive (error) paths that do NOT require outbound calls.
 */

import { env, SELF } from "cloudflare:test";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { beforeEach, describe, expect, it } from "vitest";
import { createUpstreamState } from "../../src/oauth/state";
import { injectTestSecrets } from "../helpers/setup-env";

beforeEach(() => {
  injectTestSecrets({ MYMLH_CLIENT_ID: "cid", MYMLH_CLIENT_SECRET: "sec", COOKIE_ENCRYPTION_KEY: "cookie-secret" });
});

describe("/callback", () => {
  it("returns 400 when state param is missing", async () => {
    const resp = await SELF.fetch("https://worker.test/callback?code=SOME_CODE");
    expect(resp.status).toBe(400);
  });

  it("returns 400 when state is not a known token", async () => {
    const resp = await SELF.fetch(`https://worker.test/callback?code=SOME_CODE&state=${"A".repeat(43)}`);
    expect(resp.status).toBe(400);
  });

  it("returns 400 for a legacy signed-JSON state", async () => {
    const legacy = `${"ab".repeat(32)}.${btoa(JSON.stringify({ clientId: "any" }))}`;
    const resp = await SELF.fetch(`https://worker.test/callback?code=SOME_CODE&state=${encodeURIComponent(legacy)}`);
    expect(resp.status).toBe(400);
  });

  it("returns non-2xx when stored state resolves but upstream code exchange fails", async () => {
    const oauthReqInfo = {
      clientId: "any-client",
      redirectUri: "https://client.test/cb",
      scope: ["public"],
      state: "xyz",
      responseType: "code",
      codeChallenge: "c".repeat(43),
      codeChallengeMethod: "S256",
    } as unknown as AuthRequest;
    // Seed the same KV namespace the worker reads. SELF and the test runner
    // share bindings in vitest-pool-workers.
    const token = await createUpstreamState((env as unknown as Env).OAUTH_KV, oauthReqInfo);

    const url = new URL("https://worker.test/callback");
    url.searchParams.set("code", "UPSTREAM_CODE");
    url.searchParams.set("state", token);

    const resp = await SELF.fetch(url.href, { redirect: "manual" });
    // The KV token resolves; upstream token exchange then fails (no real my.mlh.io
    // reachable from the test pool), so the handler must produce an error response.
    expect(resp.status).toBeGreaterThanOrEqual(400);
  });
});
