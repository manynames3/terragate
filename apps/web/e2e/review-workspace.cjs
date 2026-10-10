// Run only against a local development/public-demo API, never customer infrastructure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const cli = process.env.PATH.split(path.delimiter)
  .map((p) => path.join(p, "playwright"))
  .find(fs.existsSync);
if (!cli)
  throw new Error(
    "Run with npm exec --package=playwright -- node e2e/review-workspace.cjs",
  );
const { chromium } = createRequire(fs.realpathSync(cli))("playwright");
const web = process.env.SMOKE_WEB || "http://localhost:3040";
const apiOrigin = process.env.SMOKE_API || "http://localhost:8010";
for (const url of [web, apiOrigin])
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
    "Smoke tests must target loopback hosts",
  );
const api = apiOrigin + "/api/v1";
const output =
  process.env.SMOKE_SCREENSHOTS ||
  "/private/tmp/terragate-enterprise-screenshots";
const requester = {
  "X-TerraGate-User-Email": "workspace-requester@example.test",
  "X-TerraGate-Role": "reviewer",
};
const approver = {
  "X-TerraGate-User-Email": "workspace-approver@example.test",
  "X-TerraGate-Role": "platform-admin",
};
async function json(endpoint, init = {}) {
  const result = await fetch(api + endpoint, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...requester,
      ...init.headers,
    },
  });
  assert.ok(
    result.ok,
    `${endpoint}: ${result.status} ${await result.clone().text()}`,
  );
  return result.json();
}
async function noOverflow(page) {
  assert.ok(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
    "Unexpected page overflow",
  );
}
async function screenshot(page, name, fullPage = false) {
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(output, name), fullPage });
}

(async () => {
  const capabilities = await json("/runtime-capabilities");
  assert.ok(
    capabilities.public_demo,
    "Use PUBLIC_DEMO_MODE=true for this test",
  );
  assert.notEqual(
    capabilities.github_writes,
    "live",
    "External GitHub writes must be disabled",
  );
  const runs = [];
  for (const [fixture, environment] of [
    ["safe-plan.json", "dev"],
    ["risky-cost-plan.json", "dev"],
    ["risky-security-plan.json", "prod"],
  ]) {
    const plan = fs.readFileSync(
      path.resolve(__dirname, "../../../sample-data/terraform-plans", fixture),
      "utf8",
    );
    runs.push(
      await json("/terraform-reviews/json", {
        method: "POST",
        body: JSON.stringify({
          file_name: fixture,
          plan_json_text: plan,
          environment,
        }),
      }),
    );
  }
  const id = runs[2].run_id;
  const before = await json(`/runs/${id}`);
  const patches = await json(`/runs/${id}/fix-patches`);
  const report = await json(`/runs/${id}/report`);
  const plan = await json(`/runs/${id}/plan`);
  assert.ok(JSON.stringify(plan).includes("[REDACTED]"));
  assert.equal((await json(`/runs/${runs[0].run_id}`)).risk_score, 0);
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
      extraHTTPHeaders: requester,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(web + "/overview?status=all");
    const brand = page.getByRole("link", { name: "TerraGate", exact: true });
    const mark = brand.locator('img[src="/brand/terragate-mark.svg"]');
    assert.equal(await mark.evaluate((el) => el.complete && el.naturalWidth > 0), true);
    assert.equal((await mark.boundingBox()).width, 40);
    const favicon = await page.locator('link[rel="icon"]').getAttribute("href");
    const faviconResponse = await context.request.get(new URL(favicon, web).href);
    assert.equal(faviconResponse.status(), 200);
    assert.ok(faviconResponse.headers()["content-type"].includes("image/svg+xml"));
    const row = page.getByRole("link", {
      name: `Open review ${id}`,
      exact: true,
    });
    await row.waitFor();
    await noOverflow(page);
    await screenshot(page, "reviews-desktop.png");
    await row.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(`**/runs/${id}`);
    const post = page.getByRole("button", {
      name: "Post to GitHub",
      exact: true,
    });
    await post.waitFor();
    assert.equal(await post.isEnabled(), false);
    assert.ok(
      (await page.locator("pre").allTextContents()).includes(
        report.pr_comment_draft,
      ),
    );
    const sections = page.getByRole("navigation", { name: "Review sections" });
    await sections.getByRole("link", { name: /^findings$/i }).click();
    await page
      .getByRole("heading", { name: "Request risk exception" })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Commit", exact: true }).count(),
      0,
    );
    const exports = page.getByRole("button", {
      name: "Export snippet",
      exact: true,
    });
    assert.equal(await exports.count(), patches.length);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      exports.first().click(),
    ]);
    assert.equal(
      fs.readFileSync(await download.path(), "utf8"),
      patches[0].snippet,
    );
    await page.getByRole("button", { name: /^evidence$/i }).click();
    await page
      .getByText("Rule implementation version", { exact: true })
      .waitFor();
    await noOverflow(page);
    await screenshot(page, "finding-desktop.png");
    await page
      .getByLabel("Business justification")
      .fill(
        "Temporary access for a planned migration; network monitoring and owner signoff are documented.",
      );
    const expires = new Date(Date.now() + 7 * 86400000);
    const local = new Date(
      expires.getTime() - expires.getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 16);
    await page.getByLabel(/Expires \(your local time\)/).fill(local);
    await page
      .getByRole("button", { name: "Request exception", exact: true })
      .click();
    await page
      .getByText(
        "Exception requested. A different administrator must decide it.",
        { exact: true },
      )
      .waitFor();
    const second = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: approver,
    });
    const admin = await second.newPage();
    admin.setDefaultTimeout(30000);
    await admin.goto(web + "/exceptions");
    const requests = await json(`/exceptions?run_id=${id}`);
    const target = admin
      .locator("section")
      .filter({
        has: admin.locator(
          `a[href="/runs/${id}?finding=${requests.items[0].finding_id}#findings"]`,
        ),
      })
      .first();
    await target
      .getByRole("button", { name: "Accept risk", exact: true })
      .click();
    const decision = admin.getByRole("alertdialog");
    await decision
      .getByLabel("Decision notes")
      .fill(
        "Accepted with verified compensating controls until the migration window closes.",
      );
    await decision
      .getByRole("button", { name: "Record decision", exact: true })
      .click();
    await admin.getByText(/Exception approved\./).waitFor();
    const after = await json(`/runs/${id}`);
    assert.equal(after.risk_score, before.risk_score);
    assert.equal(after.blocking_findings, before.blocking_findings - 1);
    assert.equal(after.approval_status, "pending");
    await page.goto(web + `/runs/${id}#overview`);
    await page
      .getByRole("button", { name: "Approve comment", exact: true })
      .click();
    await page.getByRole("button", { name: "Approved", exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Post to GitHub", exact: true })
      .click();
    const confirmation = page.getByRole("alertdialog");
    await confirmation
      .getByRole("button", { name: "Post comment", exact: true })
      .click();
    await page.getByText(/Public demo mode: approval was recorded/).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Post to GitHub", exact: true })
        .isEnabled(),
      false,
    );
    await sections.getByRole("link", { name: /^plan$/i }).click();
    await page.getByText(/Artifact SHA-256:/).waitFor();
    assert.ok(
      (await page.locator("pre").allTextContents()).some((value) =>
        value.includes("[REDACTED]"),
      ),
    );
    await sections.getByRole("link", { name: /^history$/i }).click();
    await page.getByText("exception.approved", { exact: true }).waitFor();
    for (const route of [
      "repositories",
      "policies",
      "integrations",
      "audit-log",
      "runbooks",
      "reports",
      "approvals",
      "settings",
    ]) {
      await page.goto(web + "/" + route);
      await page.locator("h1").waitFor();
      await noOverflow(page);
    }
    await page.goto(web + "/overview?status=all&q=no-matching-review-0000");
    await page.getByText("No matching reviews", { exact: true }).waitFor();
    await page.goto(web + "/overview?status=all");
    await row.waitFor();
    await page.route(`${apiOrigin}/api/v1/reviews?**`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Temporary service interruption" }),
      }),
    );
    await page
      .getByRole("button", { name: "Refresh reviews", exact: true })
      .click();
    await page.getByText("Reviews unavailable", { exact: true }).waitFor();
    await page.getByText("Showing previous results", { exact: true }).waitFor();
    await page.unroute(`${apiOrigin}/api/v1/reviews?**`);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByText("Latest saved state", { exact: true }).waitFor();
    await page.setViewportSize({ width: 834, height: 1112 });
    await noOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal((await mark.boundingBox()).width, 32);
    await noOverflow(page);
    await screenshot(page, "reviews-mobile.png", true);
    const menu = page.getByRole("button", {
      name: "Open navigation",
      exact: true,
    });
    await menu.click();
    await page
      .getByRole("complementary", { name: "Primary navigation" })
      .waitFor();
    await page.keyboard.press("Escape");
    assert.equal(
      await menu.evaluate((el) => el === document.activeElement),
      true,
    );
    await page.goto(web + `/runs/${id}#findings`);
    await page
      .getByRole("heading", { name: "Request risk exception" })
      .waitFor();
    await noOverflow(page);
    await screenshot(page, "finding-mobile.png", true);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          run_id: id,
          verified: [
            "real upload/review",
            "keyboard queue navigation",
            "redacted plan evidence",
            "export matches saved snippet",
            "independent exception approval",
            "risk unchanged",
            "comment approval/mock post",
            "repeat post disabled",
            "audit history",
            "navigation pages",
            "empty/error/stale states",
            "desktop/tablet/mobile overflow",
            "mobile escape/focus",
            "Stratum SVG desktop/mobile branding and favicon",
          ],
          screenshots: output,
          page_errors: errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
