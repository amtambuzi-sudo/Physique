// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
// Wednesday 7 Oct 2026, so day-pill dates are deterministic:
// Mon → 2026-10-05, Wed → 2026-10-07, Wknd → 2026-10-04, others → today.
const NOW = new Date("2026-10-07T10:00:00");

async function openApp(page, { beforeLoad } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.setFixedTime(NOW);
  if (beforeLoad) await page.addInitScript(beforeLoad);
  await page.goto(APP_URL);
  await expect(page.locator(".week-pill")).toHaveCount(6);
  return errors;
}

const pill = (page, label) => page.locator(".week-pill", { hasText: new RegExp(`^${label}( ✓)?$`) });
const tab = (page, name) => page.locator(`.tab[data-tab="${name}"]`);
const readKey = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const sessionKeys = (page) => page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.startsWith("session:")).sort());

async function fillLiftDay(page, weights) {
  for (const [id, w] of Object.entries(weights)) {
    await page.locator(`.weight-input[data-id="${id}"]`).fill(String(w));
    await page.locator(`.done-check[data-id="${id}"]`).check();
  }
}
async function save(page) {
  await page.locator("#saveBtn").click();
  await expect(page.locator("#savedNote")).toHaveText("Saved ✓");
}

test("renders every tab with no errors and no window.storage", async ({ page }) => {
  const errors = await openApp(page);
  expect(await page.evaluate(() => typeof window.storage)).toBe("undefined");
  await expect(page.locator("#loggingForLabel")).toContainText("Wednesday — Full Body B");
  await expect(page.locator(".exercise-row")).toHaveCount(8);

  await tab(page, "nextweek").click();
  await expect(page.locator(".nw-card")).toHaveCount(4);
  await tab(page, "guide").click();
  await expect(page.locator(".guide-row")).toHaveCount(24);
  await tab(page, "history").click();
  await expect(page.locator(".empty-state")).toBeVisible();
  await tab(page, "progress").click();
  // Unique exercise ids across modes that define exercises (recreational has none).
  await expect(page.locator("#progressSelect option")).toHaveCount(32);
  await expect(page.locator(".chart-empty")).toBeVisible();
  expect(errors).toEqual([]);
});

test("lift-day save writes the original key + data shape and survives reload", async ({ page }) => {
  const errors = await openApp(page);
  await pill(page, "Mon").click();
  await fillLiftDay(page, { m1: 30, m3: 50 });
  await page.locator("#cardioCheck").check();
  await save(page);

  expect(await sessionKeys(page)).toEqual(["session:2026-10-05_monday"]);
  const saved = JSON.parse(await readKey(page, "session:2026-10-05_monday"));
  expect(Object.keys(saved).sort()).toEqual(
    ["cardio", "dateDisplay", "dateKey", "dayLabel", "exercises", "hardcore", "savedAt", "sessionType"]);
  expect(saved).toMatchObject({
    dateKey: "2026-10-05", sessionType: "monday", dayLabel: "Monday — Full Body A",
    hardcore: false, cardio: { name: "Treadmill HIIT finisher", completed: true },
  });
  expect(saved.exercises).toHaveLength(7);
  expect(saved.exercises[0]).toEqual({ id: "m1", name: "Goblet Squat (DB)", weight: 30, completed: true });
  expect(saved.exercises[1]).toEqual({ id: "m2", name: "Chest Press (machine)", weight: null, completed: false });

  await page.reload();
  await expect(pill(page, "Mon")).toHaveText("Mon ✓");
  await pill(page, "Mon").click();
  await expect(page.locator('.weight-input[data-id="m1"]')).toHaveValue("30");
  await expect(page.locator('.done-check[data-id="m1"]')).toBeChecked();
  await expect(page.locator('.done-check[data-id="m2"]')).not.toBeChecked();
  await expect(page.locator("#cardioCheck")).toBeChecked();
  await expect(page.locator("#savedNote")).toContainText("Loaded saved log");

  await tab(page, "history").click();
  await expect(page.locator(".hist-item")).toHaveCount(1);
  await expect(page.locator(".hist-summary")).toContainText("2/7 exercises");

  await tab(page, "progress").click();
  await page.locator("#progressSelect").selectOption("m1");
  await expect(page.locator("#chartWrap circle")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("every mode saves and reloads", async ({ page }) => {
  const errors = await openApp(page);
  const cases = [
    { pill: "Mon", type: "monday", date: "2026-10-05", weights: { m2: 45 } },
    { pill: "Wed", type: "wednesday", date: "2026-10-07", weights: { w6: 30 } },
    { pill: "Wknd", type: "weekend", date: "2026-10-04", weights: { s7: 20 } },
    { pill: "Rec", type: "recovery", date: "2026-10-07", weights: { r1: 600 } },
    { pill: "KB", type: "kettlebell", date: "2026-10-07", weights: { k2: 35 } },
  ];
  for (const c of cases) {
    await pill(page, c.pill).click();
    await fillLiftDay(page, c.weights);
    await save(page);
  }
  await pill(page, "Play").click();
  await page.locator("#recActivity").fill("Pickup basketball");
  await page.locator("#recDuration").fill("75");
  await page.locator("#recIntensity").selectOption("hard");
  await page.locator("#recCompleted").check();
  await save(page);

  expect(await sessionKeys(page)).toEqual([
    "session:2026-10-04_weekend", "session:2026-10-05_monday", "session:2026-10-07_kettlebell",
    "session:2026-10-07_recovery", "session:2026-10-07_recreational", "session:2026-10-07_wednesday",
  ]);
  const rec = JSON.parse(await readKey(page, "session:2026-10-07_recreational"));
  expect(rec).toMatchObject({
    sessionType: "recreational", exercises: [], hardcore: false,
    activity: { name: "Pickup basketball", duration: 75, intensity: "hard", completed: true },
    cardio: { name: "Recreational activity", completed: true },
  });

  await page.reload();
  for (const label of ["Mon", "Wed", "Rec", "KB", "Play"]) {
    await expect(pill(page, label)).toHaveText(`${label} ✓`);
  }
  // Mid-week, the Wknd pill targets last Sunday, which falls in the previous
  // Mon-start week — so it is saved but not counted as done this week.
  await expect(pill(page, "Wknd")).toHaveText("Wknd");
  for (const c of cases) {
    await pill(page, c.pill).click();
    for (const [id, w] of Object.entries(c.weights)) {
      await expect(page.locator(`.weight-input[data-id="${id}"]`)).toHaveValue(String(w));
    }
  }
  await pill(page, "Play").click();
  await expect(page.locator("#recActivity")).toHaveValue("Pickup basketball");
  await expect(page.locator("#recDuration")).toHaveValue("75");
  await expect(page.locator("#recIntensity")).toHaveValue("hard");

  await tab(page, "history").click();
  await expect(page.locator(".hist-item")).toHaveCount(6);
  await tab(page, "progress").click();
  await page.locator("#progressSelect").selectOption("k2");
  await expect(page.locator("#chartWrap circle")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("no state bleeds between day pills", async ({ page }) => {
  const errors = await openApp(page);
  await pill(page, "Mon").click();
  await page.locator("#hardcoreToggle").click();
  await expect(page.locator("#hardcoreToggle")).toHaveClass(/on/);
  await page.locator('.weight-input[data-id="m1"]').fill("99"); // unsaved

  await pill(page, "Wed").click();
  await expect(page.locator("#hardcoreToggle")).not.toHaveClass(/on/);
  await expect(page.locator(".hc-badge")).toHaveCount(0);
  await expect(page.locator('.weight-input[data-id="m1"]')).toHaveCount(0);

  // Freeform mode hides the toggle + cardio card; a lift day must restore them.
  await pill(page, "Play").click();
  await expect(page.locator("#hardcoreToggle")).toBeHidden();
  await expect(page.locator("#cardioCard")).toBeHidden();
  await pill(page, "KB").click();
  await expect(page.locator("#hardcoreToggle")).toBeVisible();
  await expect(page.locator("#cardioCard")).toBeVisible();
  await expect(page.locator(".exercise-row")).toHaveCount(9);

  await pill(page, "Mon").click();
  await expect(page.locator('.weight-input[data-id="m1"]')).toHaveValue("");
  await expect(page.locator("#hardcoreToggle")).not.toHaveClass(/on/);
  expect(errors).toEqual([]);
});

test("reads data already in the original shape (incl. recreational, no exercise defs)", async ({ page }) => {
  const errors = await openApp(page, {
    beforeLoad: () => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("session:2026-09-28_monday", JSON.stringify({
        dateKey: "2026-09-28", dateDisplay: "Monday, Sep 28", sessionType: "monday",
        dayLabel: "Monday — Full Body A", hardcore: true,
        exercises: [{ id: "m1", name: "Goblet Squat (DB)", weight: 25, completed: true }],
        cardio: { name: "Treadmill HIIT finisher", completed: false }, savedAt: "2026-09-28T18:00:00.000Z",
      }));
      localStorage.setItem("session:2026-10-05_monday", JSON.stringify({
        dateKey: "2026-10-05", dateDisplay: "Monday, Oct 5", sessionType: "monday",
        dayLabel: "Monday — Full Body A", hardcore: false,
        exercises: [{ id: "m1", name: "Goblet Squat (DB)", weight: 30, completed: true }],
        cardio: { name: "Treadmill HIIT finisher", completed: true }, savedAt: "2026-10-05T18:00:00.000Z",
      }));
      localStorage.setItem("session:2026-10-03_recreational", JSON.stringify({
        dateKey: "2026-10-03", dateDisplay: "Saturday, Oct 3", sessionType: "recreational",
        dayLabel: "Recreational / Sports — Tennis", hardcore: false, exercises: [],
        activity: { name: "Tennis", duration: 60, intensity: "moderate", completed: true },
        cardio: { name: "Recreational activity", completed: true }, savedAt: "2026-10-03T18:00:00.000Z",
      }));
      localStorage.setItem("unrelated-key", "ignored");
    },
  });
  await tab(page, "history").click();
  await expect(page.locator(".hist-item")).toHaveCount(3);
  await expect(page.locator(".hist-day").first()).toHaveText("Monday — Full Body A");
  await tab(page, "progress").click();
  await page.locator("#progressSelect").selectOption("m1");
  await expect(page.locator("#chartWrap circle")).toHaveCount(2);
  await expect(page.locator(".chart-caption")).toHaveText("2026-09-28 → 2026-10-05 · 25–30 lb");
  // Wednesday's form uses lastWeightFor() across saved sessions; m1 isn't on it,
  // but the most recent Monday is what the Mon pill loads.
  await pill(page, "Mon").click();
  await expect(page.locator('.weight-input[data-id="m1"]')).toHaveValue("30");
  expect(errors).toEqual([]);
});

test("falls back to window.storage when localStorage is blocked", async ({ page }) => {
  const errors = await openApp(page, {
    beforeLoad: () => {
      Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
      const mem = new Map();
      window.__artifactStore = mem;
      window.storage = {
        async get(k) { return mem.has(k) ? { key: k, value: mem.get(k) } : null; },
        async set(k, v) { mem.set(k, v); return { key: k, value: v }; },
        async delete(k) { mem.delete(k); return { key: k, deleted: true }; },
        async list(p = "") { return { keys: [...mem.keys()].filter((k) => k.startsWith(p)) }; },
      };
    },
  });
  await fillLiftDay(page, { w2: 20 });
  await save(page);
  expect(await page.evaluate(() => [...window.__artifactStore.keys()])).toEqual(["session:2026-10-07_wednesday"]);
  await expect(pill(page, "Wed")).toHaveText("Wed ✓");
  expect(errors).toEqual([]);
});

test("reports failure instead of crashing when nothing can persist", async ({ page }) => {
  const errors = await openApp(page, {
    beforeLoad: () => {
      Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
    },
  });
  await expect(page.locator(".exercise-row")).toHaveCount(8);
  await page.locator("#saveBtn").click();
  await expect(page.locator("#savedNote")).toHaveText("Couldn't save — try again.");
  expect(errors).toEqual([]);
});

test("reports failure when localStorage quota is exceeded", async ({ page }) => {
  const errors = await openApp(page, {
    beforeLoad: () => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).startsWith("session:")) throw new DOMException("full", "QuotaExceededError");
        return orig.call(this, k, v);
      };
    },
  });
  await page.locator("#saveBtn").click();
  await expect(page.locator("#savedNote")).toHaveText("Couldn't save — try again.");
  expect(errors).toEqual([]);
});
