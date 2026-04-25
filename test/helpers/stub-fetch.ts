import { vi } from "vitest";

export type FetchCall = { url: string; init: RequestInit };

export type StubReply = { status: number; body: string; contentType?: string };

export function stubFetch(replies: StubReply[]) {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    const reply = replies[i++] ?? replies[replies.length - 1];
    return new Response(reply.body, {
      status: reply.status,
      headers: { "content-type": reply.contentType ?? "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}
