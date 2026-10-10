const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const port = 3051;
const origin = `http://127.0.0.1:${port}`;
const worker = spawn(
  process.execPath,
  [path.resolve("node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--ip", "127.0.0.1", "--port", String(port)],
  { env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
let startupError;
worker.on("error", (error) => { startupError = error; });
for (const stream of [worker.stdout, worker.stderr]) {
  stream.on("data", (chunk) => { logs = (logs + chunk).slice(-12000); });
}
const exited = new Promise((resolve) => worker.once("exit", resolve));

(async () => {
  try {
    let ready = false;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (worker.exitCode !== null) throw new Error(`Worker exited before readiness.\n${logs}`);
      try {
        const response = await fetch(origin + "/overview", { signal: AbortSignal.timeout(5000) });
        if (response.status === 200) {
          assert.ok((await response.text()).includes("TerraGate"), "Missing application shell");
          ready = true;
          break;
        }
      } catch (error) {
        if (error.code === "ERR_ASSERTION") throw error;
      }
      await delay(500);
    }
    assert.ok(ready, `Cloudflare runtime never served a healthy overview.\n${logs}`);
    for (const route of ["/reviews/new", "/settings", "/runs/runtime-smoke"]) {
      const response = await fetch(origin + route, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, `${route} must render an application shell`);
      assert.ok((await response.text()).includes("TerraGate"));
    }
    const mark = await fetch(origin + "/brand/terragate-mark.svg");
    assert.equal(mark.status, 200);
    assert.ok(mark.headers.get("content-type").includes("image/svg+xml"));
    assert.ok((await mark.text()).includes('viewBox="0 0 40 30"'));
    console.log("Cloudflare workerd runtime smoke passed: four route shells and Stratum asset.");
  } finally {
    if (worker.exitCode === null) worker.kill("SIGTERM");
    await exited;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
