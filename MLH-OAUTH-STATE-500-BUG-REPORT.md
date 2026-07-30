# MLH OAuth bug: `www.mlh.com` sign-in returns 500 when the OAuth `state` parameter exceeds ~370 characters

**Reported by:** MyMLH MCP Server maintainers (`https://mymlh-mcp.git.ci`)
**Date:** 2026-07-30 (supersedes our 2026-07-10 report, which misattributed the cause to state decoding)
**Component:** `www.mlh.com` OAuth sign-in (`/oauth/authorize` → `/signin?return_to=…`)
**Our MLH app `client_id`s:** `YfAUElSH9NpO1VObnKXe-CsWJm4gexnoDVvgnYhmtTI` (production), `jth2HVajFVw2sxvnmpr-K3MXatwdEWrgQ9r8XWnVkbk` (staging)
**Severity:** High. Logged-out sign-in fails with a 500 for any OAuth client whose `state` exceeds ~370 characters.

## TL;DR

During the authorization-code flow, MLH redirects a logged-out user through
`GET /oauth/authorize` → `302` → `GET /signin?return_to=<authorize URL>`.
The `/oauth/authorize` response **stores the entire `return_to` URL,
including the client's `state`, in the cookie-backed Rails session**
(`_mlh_core_session`). When `state` pushes the serialized session cookie
past the 4096-byte Rails cookie-store limit, `/signin` returns
**500 Internal Server Error**.

Length alone triggers the 500. We ruled out content.

| `state` sent to `/oauth/authorize` | `/signin` result |
|---|---|
| ≤ 370 characters (any content, incl. base64 JSON) | **200**, sign-in renders |
| ≥ 375 characters (even just `aaa…`) | **500**, 3/3 repeats |

RFC 6749 (§4.1.1, §10.12) defines `state` as opaque, sets no length
ceiling, and requires the authorization server to round-trip it untouched.
OAuth bridges (MCP remote servers, oauth2-proxy,
`@cloudflare/workers-oauth-provider` integrations, VS Code's dynamic auth
flows) send signed or JWT states of 400–700 characters as a matter of
course. The bug hits all of them, and only on the logged-out path: new-user
onboarding.

## Evidence

### 1. The session cookie carries the failure

From a real browser HAR (2026-07-30, ~19:45 UTC):

1. `GET https://www.mlh.com/oauth/authorize?...&state=<601-char state>` (no cookies sent)
   → `302` to `/signin?return_to=…`
   → **`Set-Cookie: _mlh_core_session=<~6 KB encrypted blob>`**
   - `x-request-id: e3ccfe3b-f9a5-e799-4468-3704c1c5a2b0`
2. `GET https://www.mlh.com/signin?return_to=…` (browser sends that cookie back)
   → **500** ("Oops, Something Went Wrong")
   - `x-request-id: 1c06b1bb-914b-b656-0585-72c3c64eba1e`
   - `x-runtime: 0.091`, a fast crash consistent with an unrescued
     `ActionDispatch::Cookies::CookieOverflow`-class failure

Fetch the same two URLs without cookie propagation and both return 200.
Curl one-liners, health checks, and other jar-less probes cannot reproduce
the bug, so it looks intermittent from the outside.

### 2. Length threshold, content ruled out

We held `client_id`, `redirect_uri`, scopes, and headers constant and
varied only `state`, with cookies propagating across hops
(`curl -sL -c jar -b jar`):

| `state` | `/signin` | `_mlh_core_session` size after authorize |
|---|---|---|
| `opaquetoken12345` (16 chars) | 200 | 2326 B |
| `a` × 100 | 200 | 2802 B |
| `a` × 200 | 200 | 3398 B |
| `a` × 300 | 200 | 3938 B |
| `a` × 370 | 200 (3/3) | |
| `a` × 375 | **500** | |
| `a` × 380 | **500** (3/3) | |
| `a` × 400 | **500** | 2974 B (session write degraded) |
| real 601-char signed state | **500** (3/3) | |

The cookie grows linearly with `state` and crosses 4096 bytes where the
500 begins. We tested special characters (`"`, `://`, `?`, `%`), URL-shaped
client IDs, and base64 padding in isolation; none of them matters. A
380-character string of `a` fails. A 370-character signed JSON blob
succeeds.

The boundary shifts with the other parameter lengths, because the limit
applies to the whole serialized session.

## Reproduction

### 500 (state = 380 chars)
Go to this url from any **fresh** browser: https://www.mlh.com/oauth/authorize?client_id=jth2HVajFVw2sxvnmpr-K3MXatwdEWrgQ9r8XWnVkbk&redirect_uri=https%3A%2F%2Fmymlh-mcp-alt.git.ci%2Fcallback&scope=public+offline_access+user%3Aread%3Aprofile+user%3Aread%3Aeducation+user%3Aread%3Aemployment&response_type=code&prompt=consent&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

### 200 (identical, state = 370 chars)
Go to this url from any **fresh** browser: https://www.mlh.com/oauth/authorize?client_id=jth2HVajFVw2sxvnmpr-K3MXatwdEWrgQ9r8XWnVkbk&redirect_uri=https%3A%2F%2Fmymlh-mcp-alt.git.ci%2Fcallback&scope=public+offline_access+user%3Aread%3Aprofile+user%3Aread%3Aeducation+user%3Aread%3Aemployment&response_type=code&prompt=consent&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

Log lookup: `x-request-id 1c06b1bb-914b-b656-0585-72c3c64eba1e`
(2026-07-30 19:45:57 UTC) has the stack trace.

## Requested fix

1. **Stop persisting `return_to` in the cookie session.** Move sessions to
   a server-side store (Redis/DB), or thread `return_to` through the
   sign-in flow as a query/form parameter. A cookie session cannot hold
   client-controlled data of unbounded length.
2. **Rescue the overflow.** Even after (1), a session write that exceeds
   the cookie limit should drop the value and re-prompt instead of
   returning a 500 with no diagnostic.

## Impact on MCP integrations

More and more MCP remote servers use MyMLH as their identity provider.
Their OAuth bridges send signed-JSON states of 400+ characters by
construction; VS Code's flow produces ~600. Each of those integrations
fails for logged-out users on MLH's own branded 500 page, and the support
tickets land with MLH while the integrator gets nothing to debug.

We already shipped a mitigation: our server now sends a 43-character
single-use server-side token as `state`, so our integration no longer
depends on this fix. Any other OAuth client with a long `state` remains
broken.
