# MLH OAuth bug: `www.mlh.com` sign-in returns 500 because it decodes the opaque `state` parameter

**Reported by:** MyMLH MCP Server maintainers (`https://mymlh-mcp.git.ci`)
**Date:** 2026-07-10
**Component:** `www.mlh.com` OAuth sign-in (`/oauth/authorize` → `/signin`)
**Our MLH app `client_id`:** `YfAUElSH9NpO1VObnKXe-CsWJm4gexnoDVvgnYhmtTI`
**Severity:** High. Blocks the authorization-code flow for every user who is not
already signed in to `www.mlh.com`.

## TL;DR

During the OAuth authorization-code flow, MLH sends a logged-out user to
`https://www.mlh.com/signin?return_to=<oauth authorize URL>` and that page
returns **500 Internal Server Error**. We isolated the trigger: holding the
entire request constant and changing **only the `state` parameter** flips the
result.

| `state` sent to `/oauth/authorize` | `/signin` result |
|---|---|
| an opaque token, e.g. `opaquetoken12345` | **200** — sign-in page renders |
| our real `state` (a signed token whose base64 segment decodes to JSON) | **500** |

`state` is opaque to the authorization server per RFC 6749 (§4.1.1, §10.12) and
must be round-tripped untouched. The 500 only occurs when the `state` value
decodes to content containing characters like `"` and `://`, which indicates
MLH's sign-in is **decoding and parsing `state`** and choking on its contents.
(Your engineer confirmed seeing a stray quote `"` break the auth URL in the
logs.)

**Fix:** treat `state` as an opaque string; do not decode or parse it.

## Impact

- New/logged-out users cannot complete OAuth login to our app. The flow dies on
  MLH's own 500 page, so the client has nothing to recover from.
- Any OAuth client that sends a non-trivial `state` (signed tokens, JSON, JWT-ish
  values) is affected. Clients that happen to send a short/alphanumeric `state`
  may not notice.

## Environment

- Our server is a Cloudflare Worker at `https://mymlh-mcp.git.ci` that acts as an
  OAuth 2.0 + PKCE bridge between MCP clients and MyMLH.
- Registered redirect URI with MLH: `https://mymlh-mcp.git.ci/callback`.
- Scopes requested: `public offline_access user:read:profile user:read:education user:read:employment`.
- The `state` we send upstream is our own signed token of the form
  `‹hmac-hex›.‹base64(json)›`. It is opaque on the wire (no quotes). Example
  decoded payload:
  ```json
  {"responseType":"code","clientId":"TB5ewzFzu3XcKylF","redirectUri":"http://127.0.0.1:33418/","scope":[],"state":"02p38Qna6lUR5Jp5m9RN2A==","codeChallenge":"CVVw7G3JjH4HwjuC_fFvS5m3hl71ofkHojGPB4l2krs","codeChallengeMethod":"S256","resource":"https://mymlh-mcp.git.ci/mcp"}
  ```

## Full request chain (from a real-browser HAR)

Reproduced in a clean browser, including a fresh incognito window with no cookies.

1. `GET https://mymlh-mcp.git.ci/authorize?...` → `200` (our consent screen)
2. User clicks **Approve** → `POST https://mymlh-mcp.git.ci/authorize`
   → `302` to `https://www.mlh.com/oauth/authorize?...`
3. `GET https://www.mlh.com/oauth/authorize?client_id=YfAUElSH...&redirect_uri=https%3A%2F%2Fmymlh-mcp.git.ci%2Fcallback&scope=public+offline_access+user%3Aread%3Aprofile+user%3Aread%3Aeducation+user%3Aread%3Aemployment&state=‹our-state›&response_type=code&prompt=consent`
   → `302` to `https://www.mlh.com/signin?return_to=‹authorize-url, correctly percent-encoded›`
   - `x-request-id: ecb90db6-7ed4-de4f-3888-e928c1ccb604`
4. `GET https://www.mlh.com/signin?return_to=...`
   → **`500 Internal Server Error`** ("Oops, Something Went Wrong")
   - `x-request-id: 931eda3e-390a-50e4-f28e-1bce5f01cb51`
   - `x-runtime: 0.030073`, `via: 2.0 heroku-router`, `content-type: text/html`

**Please pull `x-request-id 931eda3e-390a-50e4-f28e-1bce5f01cb51` from your logs —
the stack trace pinpoints where `state` (or the decoded `return_to`) is parsed.**

## Isolation (what we tested)

All tests used the identical `client_id`, `redirect_uri`, browser, and cookie
state. We changed one variable at a time.

- **`state` = opaque token** (`opaquetoken12345`): `/signin` → **200**, sign-in
  page renders normally.
- **`state` = our real signed token** (base64 decodes to the JSON above):
  `/signin` → **500**.
- **Scope count** (3 scopes vs 5 scopes): no effect. Both 500 with our `state`,
  both 200 with an opaque `state`.
- **Cookies:** no effect. Fresh incognito (no cookies) still 500s; injecting a
  garbage `_mlh_session` / `remember_user_token` cookie does not change the
  result.
- **`return_to` encoding:** correct on the wire (verified in the HAR); not the
  cause.

Conclusion: the 500 is a deterministic function of the **content of `state`**,
which should never be inspected by the authorization server.

## Root cause

MLH's `www.mlh.com` sign-in / OAuth flow decodes the `state` parameter and its
decoded contents (e.g. the `"` characters, or the embedded `http://...` URL)
break request handling, producing a 500. Under OAuth 2.0 (RFC 6749):

- §4.1.1: `state` is "an opaque value used by the client".
- §10.12: the value must be preserved and returned unmodified; the authorization
  server does not interpret it.

Our `state` is opaque on the wire; the only way its inner `"`/URL can appear in
your logs is if the sign-in code base64-decodes it (our value has a JWT-like
`x.y` shape, which may trigger a decode path).

## Requested fix

1. **Treat `state` as opaque.** Do not base64-decode, JSON-parse, or otherwise
   interpret `state` in the sign-in / `/oauth/authorize` / `return_to` handling.
   Store and return it unmodified. An opaque `state` already completes fine (200),
   so this removes the 500.
2. **Confirm the canonical OAuth host and update docs.** The entire `my.mlh.io`
   domain currently issues `308 Permanent Redirect` to `www.mlh.com` (including
   `my.mlh.io/oauth/authorize` and `my.mlh.io/signin`), but
   `https://my.mlh.io/developers/docs` still lists `my.mlh.io/oauth/authorize` as
   the OAuth endpoint. Please confirm which host is canonical and align the docs.

Note: the token endpoint is unaffected. `POST /oauth/token` returns normal
Doorkeeper responses on both `my.mlh.io` and `www.mlh.com`.

## Appendix: one-line repro for your engineer

In a logged-out browser, open (`client_id` is our app; substitute any registered
`redirect_uri`):

The two URLs are identical except for `state`.

- **Works (200):** `https://www.mlh.com/oauth/authorize?client_id=YfAUElSH9NpO1VObnKXe-CsWJm4gexnoDVvgnYhmtTI&redirect_uri=https%3A%2F%2Fmymlh-mcp.git.ci%2Fcallback&scope=public+offline_access+user%3Aread%3Aprofile&response_type=code&prompt=consent&state=opaquetoken12345`
- **500:** `https://www.mlh.com/oauth/authorize?client_id=YfAUElSH9NpO1VObnKXe-CsWJm4gexnoDVvgnYhmtTI&redirect_uri=https%3A%2F%2Fmymlh-mcp.git.ci%2Fcallback&scope=public+offline_access+user%3Aread%3Aprofile&response_type=code&prompt=consent&state=6ab217e018296fb06979a634bd311f01fe0ad0f2b1da297a669af02c10f015db.eyJyZXNwb25zZVR5cGUiOiJjb2RlIiwiY2xpZW50SWQiOiJUQjVld3pGenUzWGNLeWxGIiwicmVkaXJlY3RVcmkiOiJodHRwOi8vMTI3LjAuMC4xOjMzNDE4LyIsInNjb3BlIjpbXSwic3RhdGUiOiIwMnAzOFFuYTZsVVI1SnA1bTlSTjJBPT0iLCJjb2RlQ2hhbGxlbmdlIjoiQ1ZWdzdHM0pqSDRId2p1Q19mRnZTNW0zaGw3MW9ma0hvakdQQjRsMmtycyIsImNvZGVDaGFsbGVuZ2VNZXRob2QiOiJTMjU2IiwicmVzb3VyY2UiOiJodHRwczovL215bWxoLW1jcC5naXQuY2kvbWNwIn0=`

## Contact

We can provide the full HAR, additional `x-request-id`s, or a live client to test
against.
