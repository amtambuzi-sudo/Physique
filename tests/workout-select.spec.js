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
  await expect(select(page)).toHaveValue("monday");
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

// Seeds sessions, then opens on Wed Oct 7 (this week: Sun 4 – Sat 10).
async function openWith(page, sessions) {
  await page.addInitScript((list) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [dk, type] of list) {
      localStorage.setItem(`session:${dk}_${type}`, JSON.stringify({
        dateKey: dk, dateDisplay: dk, sessionType: type, dayLabel: type, hardcore: false,
        exercises: [], cardio: { name: "x", completed: true }, savedAt: `${dk}T18:00:00.000Z`,
      }));
    }
  }, sessions);
  return open(page);
}
async function preselected(page, dk) {
  if (!(await page.locator(`.week-pill[data-date="${dk}"]`).count())) {
    await page.locator(dk < "2026-10-04" ? "#prevWeek" : "#nextWeek").click();
  }
  await page.locator(`.week-pill[data-date="${dk}"]`).click();
  const v = await select(page).inputValue();
  if (dk < "2026-10-04" || dk > "2026-10-10") await page.locator(dk < "2026-10-04" ? "#nextWeek" : "#prevWeek").click();
  return v;
}

test("weekdays rotate from the last A/B/C logged; a skipped day waits; future days project ahead", async ({ page }) => {
  const errors = await openWith(page, [["2026-10-05", "monday"]]); // did A on Monday
  expect(await preselected(page, "2026-10-06")).toBe("wednesday"); // Tue (skipped) → B
  expect(await preselected(page, "2026-10-07")).toBe("wednesday"); // today: still B, it waited
  expect(await preselected(page, "2026-10-08")).toBe("weekend");   // Thu: assumes B today → C
  expect(await preselected(page, "2026-10-09")).toBe("monday");    // Fri → A
  expect(await preselected(page, "2026-10-10")).toBe("rest");      // Sat
  expect(await preselected(page, "2026-10-11")).toBe("rest");      // Sun
  expect(await preselected(page, "2026-10-12")).toBe("wednesday"); // next Mon → B
  expect(await preselected(page, "2026-10-05")).toBe("monday");    // a logged day opens on what was logged
  expect(errors).toEqual([]);
});

test("rotation wraps C → A, and logging today moves the projection on", async ({ page }) => {
  const errors = await openWith(page, [["2026-10-02", "weekend"], ["2026-10-07", "monday"]]);
  expect(await preselected(page, "2026-10-05")).toBe("monday");  // after C (Fri) → A
  expect(await preselected(page, "2026-10-08")).toBe("wednesday"); // A logged today → B tomorrow
  expect(await preselected(page, "2026-10-09")).toBe("weekend");
  expect(errors).toEqual([]);
});

test("rest, recovery, KB and play days don't advance the rotation", async ({ page }) => {
  const errors = await openWith(page, [
    ["2026-10-02", "monday"], ["2026-10-05", "recovery"], ["2026-10-06", "kettlebell"],
  ]);
  expect(await preselected(page, "2026-10-07")).toBe("wednesday"); // last A/B/C was A → B
  // A future weekday already logged as Play counts as not-a-lift: Thu planned C after B today,
  // Fri is Play, so next Mon is A.
  await page.locator('.week-pill[data-date="2026-10-09"]').click();
  await select(page).selectOption("recreational");
  await page.locator("#saveBtn").click();
  await expect(page.locator("#savedNote")).toHaveText("Saved ✓");
  expect(await preselected(page, "2026-10-08")).toBe("weekend");
  expect(await preselected(page, "2026-10-12")).toBe("monday");
  expect(errors).toEqual([]);
});
