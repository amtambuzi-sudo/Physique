// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function open(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await page.goto(APP_URL);
  await expect(page.locator(".week-pill")).toHaveCount(7);
  return errors;
}
const pick = (page, type) => page.locator("#workoutSelect").selectOption(type);

test("Hardcore toggle only appears on workouts it can change", async ({ page }) => {
  const errors = await open(page);
  const shown = { monday: true, wednesday: true, weekend: true, kettlebell: true,
                  recovery: false, rest: false, recreational: false };
  for (const [type, visible] of Object.entries(shown)) {
    await pick(page, type);
    if (visible) await expect(page.locator("#hardcoreToggle"), type).toBeVisible();
    else await expect(page.locator("#hardcoreToggle"), type).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test("every workout that shows the toggle really changes when it's on", async ({ page }) => {
  const errors = await open(page);
  for (const type of ["monday", "wednesday", "weekend", "kettlebell"]) {
    await pick(page, type);
    const before = await page.locator(".exercise-target").allTextContents();
    await page.locator("#hardcoreToggle").click();
    const after = await page.locator(".exercise-target").allTextContents();
    expect(after.some((t, i) => t !== before[i]), type).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("Active Recovery: no toggle, no Hardcore add-on, saved as not hardcore", async ({ page }) => {
  const errors = await open(page);
  await pick(page, "recovery");
  await expect(page.locator("#hardcoreToggle")).toBeHidden();
  await expect(page.locator(".hc-badge")).toHaveCount(0);
  await expect(page.locator("#cardioCard")).toBeVisible();
  await expect(page.locator("#cardioCard")).not.toContainText("Hardcore add-on");
  await page.locator("#saveBtn").click();
  await expect(page.locator("#savedNote")).toHaveText("Saved ✓");
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("session:2026-10-07_recovery")));
  expect(saved.hardcore).toBe(false);
  expect(errors).toEqual([]);
});
