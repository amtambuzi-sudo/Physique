// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("Me button sits between the title and date and holds Trend + Log", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await page.goto(APP_URL);

  // Order in the title row: title, Me, date.
  const order = await page.locator(".title-row > *").evaluateAll((els) => els.map((e) => e.id || e.tagName));
  expect(order).toEqual(["H1", "meBtn", "todayLabel"]);
  await expect(page.locator("#meBtn")).toHaveText("Me");
  await expect(page.locator("#meBtn svg")).toBeVisible();
  const [t, m, d] = await Promise.all(["h1", "#meBtn", "#todayLabel"].map((s) => page.locator(s).boundingBox()));
  expect(t.x + t.width).toBeLessThanOrEqual(m.x);
  expect(m.x + m.width).toBeLessThanOrEqual(d.x);

  await expect(page.locator("nav .tab")).toHaveText(["Today", "Guide"]);
  await expect(page.locator("#tab-me")).toBeHidden();

  await page.locator("#meBtn").click();
  await expect(page.locator("#meBtn")).toHaveClass(/active/);
  await expect(page.locator("#meBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("nav .tab.active")).toHaveCount(0);
  await expect(page.locator(".subtab")).toHaveText(["Trend", "Log"]);
  await expect(page.locator('.subtab[data-sub="progress"]')).toHaveClass(/active/);
  await expect(page.locator("#tab-progress")).toBeVisible();
  await expect(page.locator("#tab-history")).toBeHidden();

  await page.locator('.subtab[data-sub="history"]').click();
  await expect(page.locator("#tab-history")).toBeVisible();
  await expect(page.locator("#backupCard")).toBeVisible(); // backup buttons came along
  await expect(page.locator("#tab-progress")).toBeHidden();

  // Leaving and coming back remembers the last Me page.
  await page.locator('nav .tab[data-tab="guide"]').click();
  await expect(page.locator("#tab-me")).toBeHidden();
  await expect(page.locator("#meBtn")).not.toHaveClass(/active/);
  await page.locator("#meBtn").click();
  await expect(page.locator("#tab-history")).toBeVisible();

  // Picking a day jumps back to Today.
  await page.locator('.week-pill[data-date="2026-10-05"]').click();
  await expect(page.locator("#tab-today")).toBeVisible();
  await expect(page.locator('nav .tab[data-tab="today"]')).toHaveClass(/active/);
  await expect(page.locator("#meBtn")).not.toHaveClass(/active/);
  expect(errors).toEqual([]);
});

test("fits on a small phone (iPhone SE width) without overflow", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await page.goto(APP_URL);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const date = await page.locator("#todayLabel").boundingBox();
  expect(date.x + date.width).toBeLessThanOrEqual(320);
  await ctx.close();
});
