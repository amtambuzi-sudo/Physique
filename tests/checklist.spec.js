// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const NOW = new Date("2026-10-07T10:00:00"); // Wed; this week = Sun Oct 4 – Sat Oct 10

const NAMES = { m1: "Goblet Squat (DB)", m2: "Chest Press (machine)" };
// entries: {id: completed} or {id: [completed, weight]} for old weighted logs
function monday(dk, entries) {
  return {
    dateKey: dk, dateDisplay: dk, sessionType: "monday", dayLabel: "Full Body A", hardcore: false,
    exercises: Object.entries(entries).map(([id, v]) => {
      const [completed, weight] = Array.isArray(v) ? v : [v, null];
      return { id, name: NAMES[id], weight, completed };
    }),
    cardio: { name: "Treadmill HIIT finisher", completed: true }, savedAt: `${dk}T18:00:00.000Z`,
  };
}
const SEED = {
  "session:2026-10-05_monday": monday("2026-10-05", { m1: true, m2: false }),
  "session:2026-10-06_recreational": {
    dateKey: "2026-10-06", dateDisplay: "x", sessionType: "recreational", dayLabel: "Play", hardcore: false,
    exercises: [], activity: { name: "Tennis", duration: 60, intensity: "moderate", completed: true },
    cardio: { name: "Recreational activity", completed: true }, savedAt: "2026-10-06T18:00:00.000Z",
  },
  "session:2026-09-28_monday": monday("2026-09-28", { m1: [true, 30], m2: true }),
  "session:2026-09-21_monday": monday("2026-09-21", { m1: true, m2: false }),
  "session:2026-09-14_monday": monday("2026-09-14", { m1: false }),
  "session:2026-09-07_monday": monday("2026-09-07", { m1: true }), // 5th-latest m1: outside the window of 4
  "session:2026-08-02_monday": monday("2026-08-02", { m1: true }), // outside the 8-week chart
};

async function open(page, seed = SEED) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((s) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v));
  }, seed);
  await page.goto(APP_URL);
  await expect(page.locator(".week-pill")).toHaveCount(7);
  return errors;
}
const target = (page, id) => page.locator(".exercise-row", { has: page.locator(`.done-check[data-id="${id}"]`) })
  .locator(".exercise-target");

test("rows show the program's guide load; Hardcore adds a set and says go heavier", async ({ page }) => {
  const errors = await open(page, {});
  await page.locator('.week-pill[data-date="2026-10-05"]').click();
  await expect(target(page, "m1")).toHaveText("3 × 10 · ~25 lb");
  await page.locator("#hardcoreToggle").click();
  await expect(target(page, "m1")).toHaveText("4 × 10 · go heavier: ~27.5 lb");
  await expect(target(page, "m1").locator(".hc-hint")).toHaveCount(1);

  await page.locator('.workout-pill[data-type="wednesday"]').click();
  await expect(target(page, "w8")).toHaveText("3 × 30–45 sec"); // timed: no load
  await page.locator("#hardcoreToggle").click();
  await expect(target(page, "w8")).toHaveText("4 × 30–45 sec");
  await page.locator("#saveBtn").click();
  await expect(page.locator("#savedNote")).toHaveText("Saved ✓");
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("session:2026-10-05_wednesday")));
  expect(saved.hardcore).toBe(true);
  expect(saved.exercises.every((e) => e.weight === null)).toBe(true);
  expect(errors).toEqual([]);
});

test("re-saving an old day keeps the weights it was logged with", async ({ page }) => {
  const errors = await open(page);
  await page.locator("#prevWeek").click();
  await page.locator('.week-pill[data-date="2026-09-28"]').click();
  await page.locator('.done-check[data-id="m3"]').check();
  await page.locator("#saveBtn").click();
  await expect(page.locator("#savedNote")).toHaveText("Saved ✓");
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("session:2026-09-28_monday")));
  const byId = Object.fromEntries(saved.exercises.map((e) => [e.id, e]));
  expect(byId.m1).toEqual({ id: "m1", name: "Goblet Squat (DB)", weight: 30, completed: true });
  expect(byId.m3).toEqual({ id: "m3", name: "Lat Pulldown (machine)", weight: null, completed: true });
  expect(errors).toEqual([]);
});

test("Trend: sessions per week over the last 8 Sunday-start weeks", async ({ page }) => {
  const errors = await open(page);
  await page.locator('.tab[data-tab="progress"]').click();
  // Bars only for weeks with sessions: this week (2), Sep 27, Sep 20, Sep 13, Sep 6 (1 each).
  await expect(page.locator("#weeklyChart svg path")).toHaveCount(5);
  await expect(page.locator("#weeklyChart svg text", { hasText: "This wk" })).toHaveCount(1);
  await expect(page.locator("#weeklyChart line[stroke-dasharray]")).toHaveCount(1);
  await expect(page.locator(".chart-sub").first()).toHaveText("Last 8 weeks, Sunday start · dashed line = goal of 4");
  await expect(page.locator(".trend-table tr")).toHaveCount(8);
  await page.locator(".trend-table summary").click();
  await expect(page.locator(".trend-table tr").nth(0)).toHaveText("This week2");
  await expect(page.locator(".trend-table tr").nth(1)).toHaveText("Week of Sun, Sep 271");
  await expect(page.locator(".trend-table tr").nth(7)).toHaveText("Week of Sun, Aug 160");

  await page.locator("#weeklyChart .hit").last().hover();
  await expect(page.locator("#weeklyChart .chart-tip")).toBeVisible();
  await expect(page.locator("#weeklyChart .chart-tip")).toHaveText("Week of Sun, Oct 4: 2 sessions");
  expect(errors).toEqual([]);
});

test("Trend: completion counts the last 4 logged times, skips freeform modes", async ({ page }) => {
  const errors = await open(page);
  await page.locator('.tab[data-tab="progress"]').click();
  // m1: Oct 5 ✓, Sep 28 ✓, Sep 21 ✓, Sep 14 ✗  (Sep 7 / Aug 2 fall outside the window)
  await expect(page.locator('.comp-row[data-id="m1"] .comp-count')).toHaveText("3/4");
  await expect(page.locator('.comp-row[data-id="m1"] .comp-meter span')).toHaveAttribute("style", "width:75%");
  // m2: Oct 5 ✗, Sep 28 ✓, Sep 21 ✗
  await expect(page.locator('.comp-row[data-id="m2"] .comp-count')).toHaveText("1/3");
  await expect(page.locator(".comp-row")).toHaveCount(2); // never-logged exercises are hidden
  await expect(page.locator(".comp-group")).toHaveText(["Full Body A"]);
  expect(errors).toEqual([]);
});
