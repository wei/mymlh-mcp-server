# MLH OAuth: unauthenticated `/oauth/authorize` breaks via the `my.mlh.io` → `www.mlh.com` 308 redirect

**Reported by:** MyMLH MCP Server maintainers
**Date:** 2026-07-10
**Affected hosts:** `my.mlh.io`, `www.mlh.com`
**Severity:** High. Blocks every OAuth login for a not-yet-authenticated user.

## Summary

An OAuth client that starts the authorization flow at the documented endpoint
`https://my.mlh.io/oauth/authorize` receives a `308 Permanent Redirect` to
`https://www.mlh.com/oauth/authorize`. For a user who is **not** logged in, the
resulting `www.mlh.com` sign-in flow builds a malformed `return_to` value (the
base URL is left un-encoded) and the flow ends in a **500 Internal Server
Error**.

A user who is **already** logged in never hits the sign-in leg, so the same
authorize request succeeds. That is why the bug only appears for logged-out
users.

## Impact

- Any OAuth client still pointing at `my.mlh.io/oauth/authorize` (the host in
  MLH's current developer docs) cannot log in a new/logged-out user.
- The failure is silent from the client's side: MLH returns its own 500 page,
  so the client has nothing to act on.

## Environment

- Client: MyMLH MCP Server (`https://mymlh-mcp.git.ci`), OAuth 2.0 + PKCE.
- Registered redirect URI: `https://mymlh-mcp.git.ci/callback`.
- Requested scopes: `public offline_access user:read:profile user:read:education user:read:employment`.

## Reproduction

### Step 1 — client sends the user to the documented authorize endpoint

```
https://my.mlh.io/oauth/authorize
  ?client_id=<CLIENT_ID>
  &redirect_uri=https%3A%2F%2Fmymlh-mcp.git.ci%2Fcallback
  &scope=public+offline_access+user%3Aread%3Aprofile+user%3Aread%3Aeducation+user%3Aread%3Aemployment
  &state=<STATE>
  &response_type=code
  &prompt=consent
```

`my.mlh.io` answers with a permanent redirect to `www.mlh.com`:

```console
$ curl -sS -D - -o /dev/null 'https://my.mlh.io/oauth/authorize?client_id=...&redirect_uri=...&scope=...&response_type=code&prompt=consent'
HTTP/2 308
location: https://www.mlh.com/oauth/authorize?client_id=...&redirect_uri=...&scope=public+offline_access+...&response_type=code&prompt=consent
server: cloudflare
```

### Step 2 — `www.mlh.com/oauth/authorize` sends a logged-out user to sign-in

The browser then lands on a sign-in URL whose `return_to` is **malformed**. The
scheme, host, and path of the inner URL are not percent-encoded:

```
https://www.mlh.com/signin?return_to=https://www.mlh.com/oauth/authorize?client_id%3D...%26redirect_uri%3D...
                                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ NOT encoded
```

### Step 3 — result: 500 Internal Server Error

The `/signin` **page renders** (`200`). The `500` fires when MLH processes that
`return_to` server-side, with the sign-in URL still shown in the address bar:

> 500 - Internal Server Error
> Oops, Something Went Wrong

## The encoding defect

`return_to` carries a full URL as a value inside another URL's query string, so
every reserved character in it must be percent-encoded. MLH encodes most of it
correctly but leaves two things un-encoded. Compare the broken value against a
well-formed one:

| | `return_to` value | Result |
|---|---|---|
| **Broken** (browser receives) | `https://www.mlh.com/oauth/authorize?client_id%3D...&scope%3Dpublic+offline_access+...` | 500 |
| **Correct** | `https%3A%2F%2Fwww.mlh.com%2Foauth%2Fauthorize%3Fclient_id%3D...%26scope%3Dpublic%2Boffline_access%2B...` | 200 |

The rest of the value is fine. For example `redirect_uri` is correctly
double-encoded (`https%253A%252F%252Fmymlh-mcp.git.ci%252Fcallback`) in both. Only
two things differ, and both point at the same root cause:

1. **Base URL not encoded.** `https://www.mlh.com/oauth/authorize?` appears
   literally instead of `https%3A%2F%2Fwww.mlh.com%2Foauth%2Fauthorize%3F`. The
   literal `://` and `?` make the value stop being a single opaque string.
2. **`scope` separators not encoded.** Literal `+` (`public+offline_access+...`)
   instead of `%2B`. After one decode pass these become spaces.

The signature (correctly-encoded query fragment appended to an un-encoded
`base_path + "?"`, with `+`-for-space separators) matches building `return_to` by
**string concatenation** of an already-encoded query onto an un-encoded base,
rather than encoding the whole URL as one unit. When the sign-in handler later
tries to redirect to this value, it parses a URL containing an unencoded nested
query and raw spaces, which is the likely 500.

## Notes for whoever reproduces this internally

- A **cookie-less** `GET` of the malformed sign-in URL returns `200` (the form
  renders). We could not make the bare `GET` 500. Reproduce with a **logged-out
  browser session and a real login submit**, or with a stale/valid MLH session
  cookie present. The failure is on the leg that **processes/follows** `return_to`
  (form submit, or a session short-circuit that skips the form), not on rendering
  the form. That is consistent with the 500 page showing the `/signin` URL in the
  address bar.
- A request sent **directly** to `www.mlh.com/oauth/authorize` (skipping the
  `my.mlh.io` 308) produced a correctly-encoded `return_to` in our tests. The
  malformed value appeared for the flow that arrived through the legacy 308 hop.
  This points at the sign-in `return_to` builder on `www.mlh.com`, not at the 308
  itself.
- The token endpoint is unaffected: both `my.mlh.io/oauth/token` and
  `www.mlh.com/oauth/token` respond normally (Doorkeeper `401` on bad creds). Only
  the browser-facing `/oauth/authorize` performs the 308.

## Requested fixes (either resolves it for us)

1. **Percent-encode the `return_to` base URL** in the `www.mlh.com` sign-in
   redirect so the whole inner URL survives round-tripping. This is the actual
   defect.
2. **Confirm the intended public authorize host.** If `www.mlh.com/oauth/authorize`
   is now canonical, please update the developer docs so clients point there
   directly and skip the 308 hop. If `my.mlh.io` remains canonical, the 308 to
   `www.mlh.com` should preserve a well-formed request.

## Contact

Happy to provide full request/response captures, a HAR file, or a live client to
test against.
