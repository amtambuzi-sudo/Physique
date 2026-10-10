// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function open(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await page.goto(APP_URL);
  await expect(page.locator(".week-pill")).toHaveCount(7);
  await page.locator("#workoutSelect").selectOption("wednesday");
  return errors;
}
const item = (page, id) => page.locator(".exercise-item", { has: page.locator(`.done-check[data-id="${id}"]`) });

test("tapping an exercise shows its diagram and a short explanation; tapping again hides it", async ({ page }) => {
  const errors = await open(page);
  await page.locator("#workoutSelect").selectOption("monday");
  const it = item(page, "m6");
  await expect(it.locator(".howto")).toBeHidden();
  await it.locator(".exercise-info").click();
  await expect(it.locator(".howto")).toBeVisible();
  await expect(it.locator(".howto-fig svg")).toHaveAttribute("aria-label", "DB Hip Thrust / Glute Bridge diagram");
  await expect(it.locator(".howto-fig svg path").first()).toBeVisible();
  await expect(it.locator(".howto-works")).toHaveText("Works: Glutes, hamstrings");
  await expect(it.locator(".howto-cue")).toContainText("drive hips up by squeezing glutes");
  await expect(it.locator(".exercise-info")).toHaveAttribute("aria-expanded", "true");
  // Other rows stay closed.
  await expect(item(page, "m1").locator(".howto")).toBeHidden();
  await it.locator(".exercise-info").click();
  await expect(it.locator(".howto")).toBeHidden();
  expect(errors).toEqual([]);
});

test("checking an exercise off does not open its panel", async ({ page }) => {
  const errors = await open(page);
  const it = item(page, "w2");
  await it.locator(".done-check").check();
  await expect(it.locator(".done-check")).toBeChecked();
  await expect(it.locator(".howto")).toBeHidden();
  expect(errors).toEqual([]);
});

test("keyboard: Enter toggles the panel", async ({ page }) => {
  const errors = await open(page);
  const it = item(page, "w6");
  await it.locator(".exercise-info").focus();
  await page.keyboard.press("Enter");
  await expect(it.locator(".howto")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(it.locator(".howto")).toBeHidden();
  expect(errors).toEqual([]);
});

test("every exercise in every workout has a diagram and explanation", async ({ page }) => {
  const errors = await open(page);
  for (const type of ["monday", "wednesday", "weekend", "recovery", "kettlebell"]) {
    await page.locator("#workoutSelect").selectOption(type);
    const items = page.locator(".exercise-item");
    const n = await items.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const it = items.nth(i);
      await it.locator(".exercise-info").click();
      await expect(it.locator(".howto-fig svg *").first()).toBeAttached();
      await expect(it.locator(".howto-works")).toHaveText(/^Works: \S/);
      await expect(it.locator(".howto-cue")).not.toBeEmpty();
    }
  }
  // Aliased names reuse the right guide.
  await page.locator("#workoutSelect").selectOption("weekend");
  await item(page, "s3").locator(".exercise-info").click();
  await expect(item(page, "s3").locator(".howto-works")).toHaveText("Works: Lats, upper back, biceps");
  expect(errors).toEqual([]);
});

test("Hardcore re-render keeps the panels working", async ({ page }) => {
  const errors = await open(page);
  await page.locator("#hardcoreToggle").click();
  const it = item(page, "w2");
  await it.locator(".exercise-info").click();
  await expect(it.locator(".howto")).toBeVisible();
  await expect(it.locator(".exercise-target")).toHaveText("4 × 10 · go heavier: 20 lb");
  expect(errors).toEqual([]);
});
