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

  it("returns 400 (or 5xx) when state is valid base64 but code exchange fails (no real upstream)", async () => {
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
    url.searchParams.set("state", btoa(JSON.stringify(oauthReqInfo)));

    const resp = await SELF.fetch(url.href, { redirect: "manual" });
    // Without a real upstream, the token exchange will fail — expect non-2xx success
    // The handler will return 4xx/5xx or redirect with an error
    const isErrorOrRedirect = resp.status < 200 || resp.status >= 400 || resp.status === 302 || resp.status === 303;
    expect(isErrorOrRedirect).toBe(true);
  });
});
