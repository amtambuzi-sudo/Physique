// @ts-check
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const URL = "https://tracker.test/Physique/";
const version = HTML.match(/const APP_VERSION = "([^"]+)"/)[1];

// Serve the app over https so the update check runs; `live` is what the server has now.
async function serve(page, state) {
  await page.route(URL, (route) => route.fulfill({ contentType: "text/html", body: state.live }));
}

test("shows the version on the Me page and no banner when up to date", async ({ page }) => {
  const state = { live: HTML };
  await serve(page, state);
  await page.goto(URL);
  await page.locator("#meBtn").click();
  await expect(page.locator("#appVersion")).toHaveText(`Version ${version}`);
  await page.waitForTimeout(300);
  await expect(page.locator("#updateBar")).toBeHidden();
});

test("offers a reload when a newer version is live, and reload picks it up", async ({ page }) => {
  const state = { live: HTML };
  await serve(page, state);
  await page.goto(URL);
  await page.locator("#meBtn").click();
  await expect(page.locator("#appVersion")).toHaveText(`Version ${version}`);

  // A new deploy lands while the app sits in the background, then it comes back.
  state.live = HTML.replace(`const APP_VERSION = "${version}"`, 'const APP_VERSION = "9999-01-01.1"');
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator("#updateBar")).toBeVisible();
  await expect(page.locator("#updateBar")).toContainText("A newer version is available.");

  await page.locator("#updateReload").click();
  await page.locator("#meBtn").click();
  await expect(page.locator("#appVersion")).toHaveText("Version 9999-01-01.1");
  await expect(page.locator("#updateBar")).toBeHidden();
});

test("offline or file:// never shows the banner or errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let first = true;
  await page.route(URL, (route) => {
    if (first) { first = false; return route.fulfill({ contentType: "text/html", body: HTML }); }
    return route.abort("internetdisconnected");
  });
  await page.goto(URL);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(300);
  await expect(page.locator("#updateBar")).toBeHidden();
  expect(errors).toEqual([]);
});
