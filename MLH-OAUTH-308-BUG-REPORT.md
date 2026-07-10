# MLH OAuth: `www.mlh.com/signin` returns 500 for the authorization-code flow (logged-out users)

**Reported by:** MyMLH MCP Server maintainers (`https://mymlh-mcp.git.ci`)
**Date:** 2026-07-10
**Affected host:** `www.mlh.com` (sign-in / OAuth), reached via the `my.mlh.io` → `www.mlh.com` redirect
**Severity:** High. Blocks OAuth login for any user who is not already signed in on `www.mlh.com`.

## Summary

When a logged-out user runs the OAuth 2.0 authorization-code flow, MLH sends
them to `https://www.mlh.com/signin?return_to=<oauth authorize URL>`, and that
sign-in page returns **500 Internal Server Error**. The 500 comes from MLH's
own origin (`via: heroku-router`, `x-runtime` present), while the `return_to`
value on the wire is correctly percent-encoded. A user who already has an active
`www.mlh.com` session does not hit the sign-in leg, so the flow succeeds for
them. That is why the failure only appears for logged-out users.

This blocks all new logins to our app (`client_id` `YfAUElSH...`).

## What we observed (from a real browser HAR)

The full chain for a logged-out user:

1. `POST https://mymlh-mcp.git.ci/authorize` (our server, user clicks "Approve")
   → `302` to `https://www.mlh.com/oauth/authorize?...`
2. `GET https://www.mlh.com/oauth/authorize?client_id=YfAUElSH...&redirect_uri=https%3A%2F%2Fmymlh-mcp.git.ci%2Fcallback&scope=public+offline_access+user%3Aread%3Aprofile+user%3Aread%3Aeducation+user%3Aread%3Aemployment&response_type=code&prompt=consent`
   → `302` to `https://www.mlh.com/signin?return_to=<correctly-encoded authorize URL>`
   - `x-request-id: ecb90db6-7ed4-de4f-3888-e928c1ccb604`
3. `GET https://www.mlh.com/signin?return_to=https%3A%2F%2Fwww.mlh.com%2Foauth%2Fauthorize%3F...`
   → **`500 Internal Server Error`**
   - `x-request-id: 931eda3e-390a-50e4-f28e-1bce5f01cb51`
   - `x-runtime: 0.030073`, `via: 2.0 heroku-router`, `content-type: text/html`

The `return_to` in step 3 is well-formed and fully percent-encoded
(`https%3A%2F%2Fwww.mlh.com%2Foauth%2Fauthorize%3Fclient_id%3D...`). The 500 is
not a client-side or encoding problem; MLH's sign-in controller raises while
handling the request.

**Please pull `x-request-id 931eda3e-390a-50e4-f28e-1bce5f01cb51` (and the
preceding `ecb90db6-...`) from your logs — the stack trace is the fastest path
to the root cause.**

## Reproduction

- Trigger: run the authorization-code flow while **not** signed in on
  `www.mlh.com`, e.g. open our authorize endpoint and click "Approve":
  `https://mymlh-mcp.git.ci/authorize?client_id=TB5ewzFzu3XcKylF&response_type=code&code_challenge=...&code_challenge_method=S256&redirect_uri=http://127.0.0.1:33418/&state=...`
- Result: land on `www.mlh.com/signin?return_to=...` → 500.

### What does and does not reproduce it

- **Reproduces:** a real browser that has previously visited `www.mlh.com`
  (i.e. carries `www.mlh.com` session state). The 500 appears on the `/signin`
  GET, before any credentials are entered.
- **Does NOT reproduce:** a cookie-less request. `curl` (and, we expect, a clean
  incognito window) gets `200` on the exact same `/signin?return_to=...` URL and
  renders the login form. Injecting a garbage `_mlh_session` / `remember_user_token`
  cookie also stays `200`. So the crash depends on specific, valid `www.mlh.com`
  session state, not on the presence of any cookie.

This points at the code path that handles `return_to` for a request that carries
`www.mlh.com` session state (e.g. redirecting an already-recognized visitor to
an OAuth `authorize` URL).

## Related: whole-domain redirect, docs not updated

- The entire `my.mlh.io` domain now issues `308 Permanent Redirect` to
  `www.mlh.com` (including `my.mlh.io/oauth/authorize` and `my.mlh.io/signin`).
- Your developer docs (`https://my.mlh.io/developers/docs`) still list
  `my.mlh.io/oauth/authorize` as the OAuth endpoint. If `www.mlh.com` is now the
  intended host, the docs should be updated; if not, the domain-wide 308 may be
  unintended.
- The token endpoint responds normally on both hosts (Doorkeeper `401` on bad
  creds), so token exchange is unaffected. Only the browser-facing sign-in leg
  500s.

## Requested fix

1. Fix the `www.mlh.com/signin` 500 for the OAuth authorization-code flow — start
   from `x-request-id 931eda3e-390a-50e4-f28e-1bce5f01cb51`.
2. Confirm the canonical OAuth host (`my.mlh.io` vs `www.mlh.com`) and align the
   developer docs.

## Contact

We can provide the full HAR, additional `x-request-id`s, or a live client to test
against.
