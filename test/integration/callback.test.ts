/**
 * NOTE: Outbound HTTP mocking (fetchMock) is not available in @cloudflare/vitest-pool-workers.
 * The success path of /callback (which calls https://my.mlh.io/oauth/token and
 * https://api.mlh.com/v4/users/me) cannot be tested here without a MockUpstream service binding
 * or undici MockAgent integration. That coverage is omitted; the upstream-call logic is
 * comprehensively covered by the unit tests in test/unit/upstream.test.ts.
 *
 * This file covers the defensive (error) paths that do NOT require outbound calls.
 */
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { signState } from "../../src/oauth/approval/cookie";
import { injectTestSecrets } from "../helpers/setup-env";

beforeEach(() => {
  injectTestSecrets({ MYMLH_CLIENT_ID: "cid", MYMLH_CLIENT_SECRET: "sec", COOKIE_ENCRYPTION_KEY: "cookie-secret" });
});

describe("/callback", () => {
  it("returns 400 when state param is missing", async () => {
    const resp = await SELF.fetch("https://worker.test/callback?code=SOME_CODE");
    expect(resp.status).toBe(400);
  });

  it("returns 400 when state is not valid base64 JSON", async () => {
    const resp = await SELF.fetch("https://worker.test/callback?code=SOME_CODE&state=!!!not-base64!!!");
    expect(resp.status).toBe(400);
  });

  it("returns non-2xx when signed state verifies but upstream code exchange fails", async () => {
    const oauthReqInfo = {
      clientId: "any-client",
      redirectUri: "https://client.test/cb",
      scope: ["public"],
      state: "xyz",
      responseType: "code",
      codeChallenge: "c".repeat(43),
      codeChallengeMethod: "S256",
    };
    const url = new URL("https://worker.test/callback");
    url.searchParams.set("code", "UPSTREAM_CODE");
    url.searchParams.set("state", await signState(JSON.stringify(oauthReqInfo), "cookie-secret"));

    const resp = await SELF.fetch(url.href, { redirect: "manual" });
    // Signed state passes verifyState; upstream token exchange then fails (no real my.mlh.io
    // reachable from the test pool), so the handler must produce an error response.
    expect(resp.status).toBeGreaterThanOrEqual(400);
  });
});
