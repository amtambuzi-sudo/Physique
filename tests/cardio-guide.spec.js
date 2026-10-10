// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function open(page, beforeLoad) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  if (beforeLoad) await page.addInitScript(beforeLoad);
  await page.goto(APP_URL);
  await expect(page.locator(".week-pill")).toHaveCount(7);
  return errors;
}
const cardio = (page) => page.locator("#cardioSelect");

test("finisher is required but selectable; defaults to the workout's own cardio", async ({ page }) => {
  const errors = await open(page);
  const defaults = { monday: "Treadmill HIIT finisher", wednesday: "Steady-state bike",
    weekend: "Run/walk intervals (treadmill)", recovery: "Easy bike or walk", kettlebell: "Jump rope / jacks intervals" };
  for (const [type, name] of Object.entries(defaults)) {
    await page.locator("#workoutSelect").selectOption(type);
    await expect(cardio(page)).toHaveValue(name);
    await expect(page.locator("#cardioCheck")).toBeVisible(); // still a required check-off
  }
  await expect(cardio(page).locator("option")).toHaveCount(9);
  await expect(cardio(page).locator("option", { hasText: /skip|optional/i })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("picking a finisher updates its description and is saved", async ({ page }) => {
  const errors = await open(page);
  await page.locator("#workoutSelect").selectOption("monday");
  await cardio(page).selectOption("Rower");
  await expect(page.locator("#cardioDetail")).toContainText("22 strokes/min");
  await page.locator("#cardioCheck").check();
  await page.locator("#saveBtn").click();
  await expect(page.locator("#savedNote")).toHaveText("Saved ✓");
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("session:2026-10-07_monday")));
  expect(saved.cardio).toEqual({ name: "Rower", completed: true });

  await page.reload();
  await page.locator("#workoutSelect").selectOption("monday");
  await expect(cardio(page)).toHaveValue("Rower");
  await expect(page.locator("#cardioCheck")).toBeChecked();
  expect(errors).toEqual([]);
});

test("Hardcore keeps the chosen finisher and adds its add-on", async ({ page }) => {
  const errors = await open(page);
  await page.locator("#workoutSelect").selectOption("wednesday");
  await cardio(page).selectOption("Stair climber");
  await page.locator("#hardcoreToggle").click();
  await expect(cardio(page)).toHaveValue("Stair climber");
  await expect(page.locator("#cardioDetail")).toContainText("Hardcore add-on");
  await expect(page.locator("#cardioDetail")).toContainText("light hands on the rails");
  expect(errors).toEqual([]);
});

test("an old saved finisher not in the list still shows as itself", async ({ page }) => {
  const errors = await open(page, () => {
    localStorage.setItem("session:2026-10-07_kettlebell", JSON.stringify({
      dateKey: "2026-10-07", dateDisplay: "x", sessionType: "kettlebell", dayLabel: "x", hardcore: false,
      exercises: [], cardio: { name: "Optional finisher", completed: true }, savedAt: "2026-10-07T08:00:00.000Z",
    }));
  });
  await expect(page.locator("#workoutSelect")).toHaveValue("kettlebell");
  await expect(cardio(page)).toHaveValue("Optional finisher");
  await expect(page.locator("#cardioCheck")).toBeChecked();
  expect(errors).toEqual([]);
});

test("Active Recovery is a full mobility routine, each move with a how-to", async ({ page }) => {
  const errors = await open(page);
  await page.locator("#workoutSelect").selectOption("recovery");
  await expect(page.locator(".exercise-name")).toHaveText([
    "Cat-Cow▾", "World's Greatest Stretch▾", "90/90 Hip Switch▾", "Half-Kneeling Hip Flexor Stretch▾",
    "Figure-4 Glute Stretch▾", "Supine Hamstring Stretch▾", "Thoracic Open Book▾", "Wall Slides▾", "Child's Pose▾",
  ]);
  const items = page.locator(".exercise-item");
  for (let i = 0; i < 9; i++) {
    await items.nth(i).locator(".exercise-info").click();
    await expect(items.nth(i).locator(".howto-fig svg *").first()).toBeAttached();
    await expect(items.nth(i).locator(".howto-cue")).not.toBeEmpty();
  }
  await expect(page.locator("#hardcoreToggle")).toBeHidden();
  expect(errors).toEqual([]);
});

test("Guide shows no days of the week", async ({ page }) => {
  const errors = await open(page);
  await page.locator('nav .tab[data-tab="guide"]').click();
  await expect(page.locator(".guide-row")).toHaveCount(35);
  await expect(page.locator(".guide-days")).toHaveCount(0);
  const text = await page.locator("#guideWrap").innerText();
  expect(text).not.toMatch(/\b(Mon|Wed|Sat\/Sun|Rec)\b(?! )/);
  expect(text).not.toContain("Mon ·");
  expect(errors).toEqual([]);
});
