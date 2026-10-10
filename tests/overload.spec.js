// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const NOW = new Date("2026-10-07T10:00:00"); // Wed; current week Sun Oct 4 – Sat Oct 10

const NAMES = { m1: "Goblet Squat (DB)", m2: "Chest Press (machine)", m3: "Lat Pulldown (machine)",
  m4: "Leg Extension", m5: "Leg Curl (reverse leg extension)", m6: "DB Hip Thrust / Glute Bridge",
  m7: "DB Romanian Deadlift", w8: "Plank" };
// entries: {id: weight} = completed, {id: [weight, false]} = logged but not checked off
function session(dk, type, entries) {
  return {
    dateKey: dk, dateDisplay: dk, sessionType: type, dayLabel: "seed", hardcore: false,
    exercises: Object.entries(entries).map(([id, v]) => {
      const [weight, completed] = Array.isArray(v) ? v : [v, true];
      return { id, name: NAMES[id], weight, completed };
    }),
    cardio: { name: "x", completed: true }, savedAt: `${dk}T18:00:00.000Z`,
  };
}
// Weeks (Sun start): Sep 13, Sep 20, Sep 27, then the current week Oct 4.
const SEED = {
  "session:2026-09-14_monday": session("2026-09-14", "monday", { m2: 40, m6: 20 }),
  "session:2026-09-21_monday": session("2026-09-21", "monday", { m1: 30, m4: 40, m5: 35, m6: 20 }),
  "session:2026-09-28_monday": session("2026-09-28", "monday", { m1: 30, m2: 40, m3: 45, m4: 45, m5: [35, false], m7: 25 }),
  "session:2026-09-30_monday": session("2026-09-30", "monday", { m7: 25 }),
  "session:2026-09-23_wednesday": session("2026-09-23", "wednesday", { w8: 45 }),
  "session:2026-09-30_wednesday": session("2026-09-30", "wednesday", { w8: 45 }),
};

async function open(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
  }, SEED);
  await page.goto(APP_URL);
  await expect(page.locator(".week-pill")).toHaveCount(7);
  return errors;
}
const row = (page, id) => page.locator(".exercise-row", { has: page.locator(`.weight-input[data-id="${id}"]`) });
const target = (page, id) => row(page, id).locator(".exercise-target");
const input = (page, id) => page.locator(`.weight-input[data-id="${id}"]`);

test("suggests +5 lb only after two consecutive completed weeks at the same weight", async ({ page }) => {
  const errors = await open(page);
  await page.locator('.week-pill[data-date="2026-10-05"]').click();

  // Sep 21 + Sep 28 at 30, both completed → ready.
  await expect(target(page, "m1")).toHaveText("3 × 10 · last: 30 lb · ⬆ +5 → 35 lb");
  await expect(input(page, "m1")).toHaveAttribute("placeholder", "35");
  // Sep 14 and Sep 28 with a skipped week between → count restarted.
  await expect(target(page, "m2")).toHaveText("3 × 10 · last: 40 lb · wk 1/2 at 40 lb");
  await expect(input(page, "m2")).toHaveAttribute("placeholder", "40");
  // Only one week logged.
  await expect(target(page, "m3")).toHaveText("3 × 10 · last: 45 lb · wk 1/2 at 45 lb");
  // Weight went 40 → 45, so 45 has one week.
  await expect(target(page, "m4")).toHaveText("3 × 12 · last: 45 lb · wk 1/2 at 45 lb");
  // Sep 28 not checked off; Sep 21 alone is more than a week ago → no streak.
  await expect(target(page, "m5")).toHaveText("3 × 12 · last: 35 lb");
  // Two weeks (Sep 14, 21) but nothing since → lapsed.
  await expect(target(page, "m6")).toHaveText("3 × 12 · last: 20 lb");
  // Twice in the same week is still one week.
  await expect(target(page, "m7")).toHaveText("3 × 10 · last: 25 lb · wk 1/2 at 25 lb");
  expect(errors).toEqual([]);
});

test("timed exercises never get a weight bump", async ({ page }) => {
  const errors = await open(page);
  await page.locator('.workout-pill[data-type="wednesday"]').click();
  await expect(target(page, "w8")).toHaveText("3 × 30–45 sec · last: 45 sec");
  expect(errors).toEqual([]);
});

test("after taking the bump, the new weight starts its own two-week count", async ({ page }) => {
  const errors = await open(page);
  await page.locator('.week-pill[data-date="2026-10-05"]').click();
  await input(page, "m1").fill("35");
  await row(page, "m1").locator(".done-check").check();
  await page.locator("#saveBtn").click();
  await expect(page.locator("#savedNote")).toHaveText("Saved ✓");
  // The logged day keeps its advice (it only looks at earlier sessions).
  await expect(target(page, "m1")).toContainText("⬆ +5 → 35 lb");

  await page.locator("#nextWeek").click();
  await page.locator('.week-pill[data-date="2026-10-12"]').click();
  await expect(target(page, "m1")).toHaveText("3 × 10 · last: 35 lb · wk 1/2 at 35 lb");
  await expect(input(page, "m1")).toHaveAttribute("placeholder", "35");
  expect(errors).toEqual([]);
});

test("Hardcore still scales up from the suggested weight", async ({ page }) => {
  const errors = await open(page);
  await page.locator('.week-pill[data-date="2026-10-05"]').click();
  await page.locator("#hardcoreToggle").click();
  await expect(input(page, "m1")).toHaveAttribute("placeholder", "37.5"); // 35 × 1.1, rounded to 2.5
  expect(errors).toEqual([]);
});
