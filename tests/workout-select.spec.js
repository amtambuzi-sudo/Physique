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
  return errors;
}
const select = (page) => page.locator("#workoutSelect");

test("one dropdown lists every workout incl. Rest day; no button row", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator(".workout-pill")).toHaveCount(0);
  await expect(select(page).locator("option")).toHaveText([
    "Full Body A", "Full Body B", "Full Body C", "Active Recovery", "Rest day", "Kettlebell + Mat", "Recreational / Sports",
  ]);
  await expect(select(page)).toHaveValue("wednesday");
  await select(page).selectOption("weekend");
  await expect(page.locator("#loggingForLabel")).toHaveText("Full Body C · today, Wednesday, Oct 7");
  await expect(page.locator(".exercise-item")).toHaveCount(7);
  // Changing day re-selects that day's default.
  await page.locator('.week-pill[data-date="2026-10-05"]').click();
  await expect(select(page)).toHaveValue("monday");
  expect(errors).toEqual([]);
});

test("Rest day: no exercises, saves, marks the day, isn't a training session", async ({ page }) => {
  const errors = await open(page);
  await page.locator('.week-pill[data-date="2026-10-08"]').click();
  await select(page).selectOption("rest");
  await expect(page.locator("#loggingForLabel")).toHaveText("Rest day · Thursday, Oct 8");
  await expect(page.locator(".exercise-item")).toHaveCount(0);
  await expect(page.locator("#hardcoreToggle")).toBeHidden();
  await expect(page.locator("#cardioCard")).toBeHidden();
  await expect(page.locator(".rest-body")).toContainText("No training planned");
  await page.locator("#saveBtn").click();
  await expect(page.locator("#savedNote")).toHaveText("Saved ✓");

  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("session:2026-10-08_rest")));
  expect(saved).toMatchObject({ dateKey: "2026-10-08", sessionType: "rest", dayLabel: "Rest day", hardcore: false, exercises: [] });
  expect(Object.keys(saved).sort()).toEqual(
    ["cardio", "dateDisplay", "dateKey", "dayLabel", "exercises", "hardcore", "savedAt", "sessionType"]);

  await page.reload();
  await expect(page.locator('.week-pill[data-date="2026-10-08"]')).toHaveClass(/done/);
  await page.locator('.week-pill[data-date="2026-10-08"]').click();
  await expect(select(page)).toHaveValue("rest"); // a logged day opens on what was logged
  await expect(select(page).locator('option[value="rest"]')).toHaveText("Rest day ✓");
  await expect(page.locator("#savedNote")).toHaveText("Rest day logged ✓");

  await page.locator('.tab[data-tab="history"]').click();
  await expect(page.locator(".hist-summary")).toHaveText("Rest ✓");
  await page.locator('.tab[data-tab="progress"]').click();
  await page.locator(".trend-table summary").click();
  await expect(page.locator(".trend-table tr").first()).toHaveText("This week0");

  // Leaving Rest restores the lift view.
  await page.locator('.tab[data-tab="today"]').click();
  await select(page).selectOption("monday");
  await expect(page.locator("#hardcoreToggle")).toBeVisible();
  await expect(page.locator(".exercise-item")).toHaveCount(7);
  expect(errors).toEqual([]);
});

test("changing the dropdown buzzes and resets Hardcore", async ({ page }) => {
  await page.addInitScript(() => {
    window.__buzz = 0;
    Object.defineProperty(navigator, "vibrate", { value: () => { window.__buzz++; return true; }, configurable: true });
  });
  const errors = await open(page);
  await page.locator("#hardcoreToggle").click();
  await select(page).selectOption("kettlebell");
  expect(await page.evaluate(() => window.__buzz)).toBe(2);
  await expect(page.locator("#hardcoreToggle")).not.toHaveClass(/on/);
  expect(errors).toEqual([]);
});
