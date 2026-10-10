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

test("cardio finisher is a fixed finisher with a checkbox, never labelled optional", async ({ page }) => {
  const errors = await open(page);
  for (const type of ["monday", "wednesday", "weekend", "recovery", "kettlebell"]) {
    await page.locator("#workoutSelect").selectOption(type);
    await expect(page.locator("#cardioCard select")).toHaveCount(0);   // no picker
    await expect(page.locator("#cardioCheck")).toBeVisible();          // just a check-off
    await expect(page.locator("#cardioCard")).not.toContainText(/optional|skip/i);
  }
  await page.locator("#workoutSelect").selectOption("kettlebell");
  await expect(page.locator(".cardio-title")).toHaveText("Jump rope / jacks intervals");
  expect(errors).toEqual([]);
});

test("Active Recovery stays one mobility row; its how-to holds the full routine", async ({ page }) => {
  const errors = await open(page);
  await page.locator("#workoutSelect").selectOption("recovery");
  await expect(page.locator(".exercise-item")).toHaveCount(1);
  await expect(page.locator(".exercise-name")).toHaveText("Mobility / stretch flow▾");
  await page.locator(".exercise-info").click();
  await expect(page.locator("#tab-today .howto-steps li")).toHaveCount(8);
  await expect(page.locator("#tab-today .howto-steps li").first()).toContainText("Cat-Cow");
  // KB's mat stretch shares the same routine.
  await page.locator("#workoutSelect").selectOption("kettlebell");
  const k9 = page.locator(".exercise-item", { has: page.locator('.done-check[data-id="k9"]') });
  await k9.locator(".exercise-info").click();
  await expect(k9.locator(".howto-steps li")).toHaveCount(8);
  expect(errors).toEqual([]);
});

test("Guide shows no days of the week", async ({ page }) => {
  const errors = await open(page);
  await page.locator('nav .tab[data-tab="guide"]').click();
  await expect(page.locator(".guide-row")).toHaveCount(26);
  await expect(page.locator(".guide-days")).toHaveCount(0);
  await expect(page.locator("#guideWrap")).not.toContainText("Sat/Sun");
  await expect(page.locator("#guideWrap")).not.toContainText("Mon ·");
  expect(errors).toEqual([]);
});
