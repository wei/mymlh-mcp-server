// Stub entrypoint replaced by real OAuthProvider wiring in Task 14.
// Required so wrangler/vitest-pool-workers can bundle the worker for unit tests
// before the integration wiring is in place.
export default {
  async fetch(): Promise<Response> {
    return new Response("not yet wired", { status: 503 });
  },
} satisfies ExportedHandler;
