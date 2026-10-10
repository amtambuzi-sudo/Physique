// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

// mode "vibrate": Android-style navigator.vibrate is recorded.
// mode "ios": no vibrate; record clicks on the hidden <input switch> label instead.
async function open(page, mode = "vibrate") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00"));
  await page.addInitScript((m) => {
    window.__buzz = [];
    if (m === "vibrate") {
      Object.defineProperty(navigator, "vibrate", { value: (p) => { window.__buzz.push(p); return true; }, configurable: true });
    } else {
      Object.defineProperty(Navigator.prototype, "vibrate", { value: undefined, configurable: true });
      const orig = HTMLLabelElement.prototype.click;
      HTMLLabelElement.prototype.click = function () {
        if (this.querySelector('input[type="checkbox"][switch]')) window.__buzz.push("switch");
        return orig.call(this);
      };
    }
  }, mode);
  await page.goto(APP_URL);
  await expect(page.locator(".week-pill")).toHaveCount(7);
  return errors;
}
const buzzes = (page) => page.evaluate(() => window.__buzz.length);
const item = (page, id) => page.locator(".exercise-item", { has: page.locator(`.done-check[data-id="${id}"]`) });

test("buzzes on check-offs, save, day/workout/week switches and Hardcore", async ({ page }) => {
  const errors = await open(page);
  let n = 0;
  const expectBuzz = async () => { n++; await expect.poll(() => buzzes(page)).toBe(n); };

  await page.locator('.done-check[data-id="w2"]').check(); await expectBuzz();
  await page.locator('.done-check[data-id="w2"]').uncheck(); await expectBuzz();
  await page.locator("#cardioCheck").check(); await expectBuzz();
  await page.locator("#hardcoreToggle").click(); await expectBuzz();
  await page.locator('.week-pill[data-date="2026-10-05"]').click(); await expectBuzz();
  await page.locator("#workoutSelect").selectOption("recreational"); await expectBuzz();
  await page.locator("#recCompleted").check(); await expectBuzz();
  await page.locator("#prevWeek").click(); await expectBuzz();
  await page.locator("#saveBtn").click(); await expectBuzz();
  await expect(page.locator("#savedNote")).toHaveText("Saved ✓");
  expect(await page.evaluate(() => window.__buzz)).toEqual(Array(n).fill(10));
  // Tabs don't buzz.
  await page.locator('.tab[data-tab="guide"]').click();
  expect(await buzzes(page)).toBe(n);
  expect(errors).toEqual([]);
});

test("press and hold opens the how-to with a buzz; the release doesn't close it again", async ({ page }) => {
  const errors = await open(page);
  const it = item(page, "w6");
  const box = await it.locator(".exercise-name").boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await expect(it).toHaveClass(/pressing/);
  await expect(it.locator(".howto")).toBeVisible({ timeout: 2000 });
  expect(await buzzes(page)).toBe(1);
  await page.mouse.up();
  await expect(it.locator(".howto")).toBeVisible();
  await expect(it).not.toHaveClass(/pressing/);
  // A normal tap afterwards still closes it.
  await it.locator(".exercise-info").click();
  await expect(it.locator(".howto")).toBeHidden();
  expect(await buzzes(page)).toBe(2);
  expect(errors).toEqual([]);
});

test("a hold that drags (scrolling) is cancelled", async ({ page }) => {
  const errors = await open(page);
  const it = item(page, "w6");
  const box = await it.locator(".exercise-name").boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + box.height / 2 + 40, { steps: 4 });
  await page.waitForTimeout(700);
  await expect(it.locator(".howto")).toBeHidden();
  expect(await buzzes(page)).toBe(0);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test("quick tap still toggles the how-to (with a buzz)", async ({ page }) => {
  const errors = await open(page);
  const it = item(page, "w2");
  await it.locator(".exercise-info").click();
  await expect(it.locator(".howto")).toBeVisible();
  expect(await buzzes(page)).toBe(1);
  expect(errors).toEqual([]);
});

test("iPhone path: without navigator.vibrate it toggles a hidden native switch", async ({ page }) => {
  const errors = await open(page, "ios");
  await page.locator('.done-check[data-id="w2"]').check();
  await expect.poll(() => page.evaluate(() => window.__buzz)).toEqual(["switch"]);
  await page.locator("#hardcoreToggle").click();
  await expect.poll(() => buzzes(page)).toBe(2);
  // The throwaway switch is removed again and never touches the log.
  await expect(page.locator("input[switch]")).toHaveCount(0);
  await expect(page.locator('.done-check[data-id="w2"]')).toBeChecked();
  expect(errors).toEqual([]);
});
