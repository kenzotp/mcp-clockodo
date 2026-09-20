// Unit tests with an injected fetch — no live Clockodo account needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ClockodoClient, ClockodoError } from "../src/clockodo.ts";

function clientWith(response: { status: number; body: unknown }, calls: { url: string; init: RequestInit }[] = []) {
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  return new ClockodoClient("user@example.com", "key123", fetchImpl);
}

test("auth headers are sent on every request", async () => {
  const calls: any[] = [];
  const c = clientWith({ status: 200, body: { data: { id: 1 } } }, );
  // capture headers via custom fetch
  const c2 = new ClockodoClient("user@example.com", "key123", async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } });
  });
  await c2.get("/v4/users/me");
  const headers = new Headers(calls[0].init.headers as HeadersInit);
  assert.equal(headers.get("X-ClockodoApiUser"), "user@example.com");
  assert.equal(headers.get("X-ClockodoApiKey"), "key123");
  void c;
});

test("list extracts the data array and paging", async () => {
  const c = new ClockodoClient("u", "k", async () =>
    new Response(
      JSON.stringify({ customers: [{ id: 1 }, { id: 2 }], paging: { items_per_page: 100, current_page: 2, total_pages: 3 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  const res = await c.list("/v3/customers", { page: 2 });
  assert.equal(res.items.length, 2);
  assert.equal(res.page, 2);
  assert.equal(res.totalPages, 3);
});

test("upstream errors surface Clockodo's own message", async () => {
  const c = new ClockodoClient("u", "k", async () =>
    new Response(JSON.stringify({ error: { message: "no access to this customer", code: 403 } }), { status: 403 }),
  );
  await assert.rejects(() => c.get("/v3/customers/1"), (err: any) => {
    assert.ok(err instanceof ClockodoError);
    assert.equal(err.status, 403);
    assert.match(err.message, /no access to this customer/);
    return true;
  });
});

test("query params land in the URL", async () => {
  const seen: string[] = [];
  const c = new ClockodoClient("u", "k", async (input) => {
    seen.push(String(input));
    return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } });
  });
  await c.get("/v2/entries", { time_since: "2026-09-01T00:00:00", page: 2 });
  assert.match(seen[0], /time_since=2026-09-01T00%3A00%3A00|time_since=2026-09-01T00:00:00/);
  assert.match(seen[0], /page=2/);
});
