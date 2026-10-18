import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Import as ESM without changing the existing application's package module type.
const source = await readFile(new URL("../pages-v2/public/_worker.js", import.meta.url), "utf8");
const { default: proxy } = await import(`data:text/javascript,${encodeURIComponent(source)}`);

test("Pages routes UI via service binding and fixes the API upstream", async () => {
  const ui = new Request("https://terragate2.pages.dev/runs/example");
  await proxy.fetch(ui, { WEB: { fetch: (request) => {
    assert.equal(request, ui);
    return new Response("shell");
  } } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request, options) => {
    assert.equal(request.url, "https://hwnk8hnyk1.execute-api.us-east-1.amazonaws.com/api/v1/reviews?next=https://evil.invalid");
    assert.equal(request.headers.get("authorization"), "Bearer test");
    assert.equal(request.headers.get("cookie"), null);
    assert.equal(request.headers.get("origin"), null);
    assert.equal(await request.text(), "plan");
    assert.equal(options.redirect, "manual");
    return new Response("result", { headers: { "set-cookie": "private=1", "cache-control": "public" } });
  };
  try {
    const response = await proxy.fetch(new Request("https://terragate2.pages.dev/api/v1/reviews?next=https://evil.invalid", {
      method: "POST", body: "plan", headers: { authorization: "Bearer test", cookie: "private=1", origin: "https://terragate2.pages.dev" }
    }), {});
    assert.equal(await response.text(), "result");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
