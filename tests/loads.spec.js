// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

// What a typical gym actually has (lb).
const REAL = {
  db: new Set([2, 3, 5, 8, 10, 12, 15, ...Array.from({ length: 17 }, (_, i) => 20 + i * 5)]),
  kb: new Set([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 53, 60, 70, 80]),
  machine: { has: (w) => w % 5 === 0 && w > 0 },
  cable: { has: (w) => w % 5 === 0 && w > 0 },
};

test("every suggested weight, normal and Hardcore, exists for its equipment", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await page.goto(APP_URL);
  await expect(page.locator(".week-pill")).toHaveCount(7);

  const program = await page.evaluate(() =>
    Object.values(PROGRAM).flatMap((p) => p.exercises || []).map((e) => ({ ...e })));
  expect(program).toHaveLength(32);

  for (const type of ["monday", "wednesday", "weekend", "recovery", "kettlebell"]) {
    await page.locator(`.workout-pill[data-type="${type}"]`).click();
    for (const hardcore of [false, true]) {
      const toggle = page.locator("#hardcoreToggle");
      if (hardcore !== (await toggle.evaluate((el) => el.classList.contains("on")))) await toggle.click();
      const rows = await page.locator(".exercise-item").evaluateAll((els) => els.map((el) => ({
        id: el.querySelector(".done-check").dataset.id,
        target: el.querySelector(".exercise-target").textContent,
      })));
      for (const { id, target } of rows) {
        const ex = program.find((e) => e.id === id);
        expect(ex.equip, id).toBeTruthy();
        const m = target.match(/(?:~|go heavier: )(\d+(?:\.\d+)?) lb/);
        if (ex.start === null) {
          expect(m, `${id} shouldn't show a weight`).toBeNull();
          continue;
        }
        const w = Number(m[1]);
        expect(REAL[ex.equip].has(w), `${id} ${ex.name}: ${w} lb isn't a real ${ex.equip} weight`).toBe(true);
        if (hardcore) {
          expect(target).toContain("go heavier");
          expect(w).toBeGreaterThan(ex.start);
        } else {
          expect(w).toBe(ex.start);
        }
      }
    }
  }
  expect(errors).toEqual([]);
});

test("Hardcore adds a set to sets×reps only; timed flows keep their length", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await page.goto(APP_URL);
  await page.locator('.workout-pill[data-type="recovery"]').click();
  await page.locator("#hardcoreToggle").click();
  await expect(page.locator(".exercise-target")).toHaveText(["10 min"]);
  await page.locator('.workout-pill[data-type="kettlebell"]').click();
  await page.locator("#hardcoreToggle").click();
  const t = (id) => page.locator(".exercise-item", { has: page.locator(`.done-check[data-id="${id}"]`) }).locator(".exercise-target");
  await expect(t("k7")).toHaveText("3 × 10/direction · go heavier: 15 lb");
  await expect(t("k8")).toHaveText("4 × 30–45 sec");
  await expect(t("k9")).toHaveText("10 min");
  await expect(t("k2")).toHaveText("4 × 15 · go heavier: 30 lb");
});
