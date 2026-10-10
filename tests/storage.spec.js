// @ts-check
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
// Wednesday 7 Oct 2026. Sunday-start week shown on load: Sun 4 … Sat 10 Oct.
const NOW = new Date("2026-10-07T10:00:00");

async function openApp(page, { beforeLoad } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.setFixedTime(NOW);
  if (beforeLoad) await page.addInitScript(beforeLoad);
  await page.goto(APP_URL);
  await expect(page.locator(".week-pill")).toHaveCount(7);
  return errors;
}

const day = (page, dk) => page.locator(`.week-pill[data-date="${dk}"]`);
const workout = (page, type) => page.locator(`.workout-pill[data-type="${type}"]`);
const tab = (page, name) => page.locator(`.tab[data-tab="${name}"]`);
const readKey = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const sessionKeys = (page) => page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.startsWith("session:")).sort());

async function checkOff(page, ids) {
  for (const id of ids) await page.locator(`.done-check[data-id="${id}"]`).check();
}
async function save(page) {
  await page.locator("#saveBtn").click();
  await expect(page.locator("#savedNote")).toHaveText("Saved ✓");
}
function seed(sessions) {
  // Runs in the page before app scripts; only seeds on first load of the test.
  return { fn: (s) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  }, arg: sessions };
}
async function openSeeded(page, sessions) {
  const s = seed(sessions);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(s.fn, s.arg);
  await page.goto(APP_URL);
  await expect(page.locator(".week-pill")).toHaveCount(7);
  return errors;
}
const mondaySession = (dk, weight, savedAt = `${dk}T18:00:00.000Z`) => ({
  dateKey: dk, dateDisplay: dk, sessionType: "monday", dayLabel: "Monday — Full Body A", hardcore: false,
  exercises: [{ id: "m1", name: "Goblet Squat (DB)", weight, completed: true }],
  cardio: { name: "Treadmill HIIT finisher", completed: true }, savedAt,
});

test("renders a Sunday-start daily strip, every tab, no errors", async ({ page }) => {
  const errors = await openApp(page);
  expect(await page.evaluate(() => typeof window.storage)).toBe("undefined");
  await expect(page.locator(".week-pill .dow")).toHaveText(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  await expect(page.locator(".week-pill .dom")).toHaveText(["4", "5", "6", "7", "8", "9", "10"]);
  await expect(day(page, "2026-10-07")).toHaveClass(/selected/);
  await expect(day(page, "2026-10-07")).toHaveClass(/is-today/);
  await expect(workout(page, "wednesday")).toHaveClass(/selected/);
  await expect(page.locator("#loggingForLabel")).toHaveText(/^Full Body B · today, Wednesday, Oct 7$/);
  await expect(page.locator(".exercise-row")).toHaveCount(8);

  await tab(page, "nextweek").click();
  await expect(page.locator(".nw-card")).toHaveCount(4);
  await expect(page.locator(".nw-date").nth(0)).toHaveText("Monday, Oct 12");
  await expect(page.locator(".nw-date").nth(1)).toHaveText("Wednesday, Oct 14");
  await expect(page.locator(".nw-date").nth(2)).toHaveText("Sun, Oct 11 or Sat, Oct 17");
  await tab(page, "guide").click();
  await expect(page.locator(".guide-row")).toHaveCount(24);
  await tab(page, "history").click();
  await expect(page.locator(".empty-state")).toBeVisible();
  await expect(page.locator("#backupCard")).toBeVisible();
  await tab(page, "progress").click();
  await expect(page.locator("#trendWrap .chart-empty")).toHaveText("Log a workout to see your consistency here.");
  // No weight entry anywhere: rows are name + target + checkbox.
  await tab(page, "today").click();
  await expect(page.locator('input[type="number"]')).toHaveCount(0);
  await expect(page.locator(".exercise-row .done-check")).toHaveCount(8);
  expect(errors).toEqual([]);
});

test("empty days pre-select their scheduled workout", async ({ page }) => {
  const errors = await openApp(page);
  const expected = {
    "2026-10-04": "weekend", "2026-10-05": "monday", "2026-10-06": "monday", "2026-10-07": "wednesday",
    "2026-10-08": "wednesday", "2026-10-09": "wednesday", "2026-10-10": "weekend",
  };
  for (const [dk, type] of Object.entries(expected)) {
    await day(page, dk).click();
    await expect(day(page, dk)).toHaveClass(/selected/);
    await expect(workout(page, type)).toHaveClass(/selected/);
  }
  expect(errors).toEqual([]);
});

test("saves to the tapped date with the original key + data shape, survives reload", async ({ page }) => {
  const errors = await openApp(page);
  await day(page, "2026-10-05").click();
  await checkOff(page, ["m1", "m3"]);
  await page.locator("#cardioCheck").check();
  await save(page);

  expect(await sessionKeys(page)).toEqual(["session:2026-10-05_monday"]);
  const saved = JSON.parse(await readKey(page, "session:2026-10-05_monday"));
  expect(Object.keys(saved).sort()).toEqual(
    ["cardio", "dateDisplay", "dateKey", "dayLabel", "exercises", "hardcore", "savedAt", "sessionType"]);
  expect(saved).toMatchObject({
    dateKey: "2026-10-05", sessionType: "monday", dayLabel: "Full Body A",
    hardcore: false, cardio: { name: "Treadmill HIIT finisher", completed: true },
  });
  expect(saved.exercises).toHaveLength(7);
  expect(saved.exercises[0]).toEqual({ id: "m1", name: "Goblet Squat (DB)", weight: null, completed: true });
  expect(saved.exercises[1]).toEqual({ id: "m2", name: "Chest Press (machine)", weight: null, completed: false });

  await page.reload();
  await expect(day(page, "2026-10-05")).toHaveClass(/done/);
  await expect(day(page, "2026-10-07")).not.toHaveClass(/done/);
  await day(page, "2026-10-05").click();
  await expect(workout(page, "monday")).toHaveText("Body A ✓");
  await expect(page.locator('.done-check[data-id="m1"]')).toBeChecked();
  await expect(page.locator('.done-check[data-id="m2"]')).not.toBeChecked();
  await expect(page.locator("#cardioCheck")).toBeChecked();
  await expect(page.locator("#savedNote")).toContainText("Loaded saved log");

  await tab(page, "history").click();
  await expect(page.locator(".hist-item")).toHaveCount(1);
  await expect(page.locator(".hist-summary")).toContainText("2/7 exercises");
  await page.locator(".hist-top").click();
  await expect(page.locator(".hist-row").nth(0)).toHaveText("Goblet Squat (DB)✓");
  await expect(page.locator(".hist-row").nth(1)).toHaveText("Chest Press (machine)—");
  expect(errors).toEqual([]);
});

test("both weekend days count toward the same Sunday-start week", async ({ page }) => {
  const errors = await openApp(page);
  for (const dk of ["2026-10-04", "2026-10-10"]) {
    await day(page, dk).click();
    await expect(workout(page, "weekend")).toHaveClass(/selected/);
    await checkOff(page, ["s7"]);
    await save(page);
  }
  expect(await sessionKeys(page)).toEqual(["session:2026-10-04_weekend", "session:2026-10-10_weekend"]);
  await page.reload();
  await expect(day(page, "2026-10-04")).toHaveClass(/done/);
  await expect(day(page, "2026-10-10")).toHaveClass(/done/);
  expect(errors).toEqual([]);
});

test("week arrows reach last week's days for logging", async ({ page }) => {
  const errors = await openApp(page);
  await page.locator("#prevWeek").click();
  await expect(page.locator(".week-pill .dom")).toHaveText(["27", "28", "29", "30", "1", "2", "3"]);
  // Changing the visible week doesn't change what's being logged until a day is tapped.
  await expect(page.locator("#loggingForLabel")).toContainText("Oct 7");
  await day(page, "2026-10-03").click();
  await expect(page.locator("#loggingForLabel")).toHaveText("Full Body C · Saturday, Oct 3");
  await save(page);
  expect(await sessionKeys(page)).toEqual(["session:2026-10-03_weekend"]);
  await expect(day(page, "2026-10-03")).toHaveClass(/done/);
  await page.locator("#nextWeek").click();
  await expect(page.locator(".week-pill .dom")).toHaveText(["4", "5", "6", "7", "8", "9", "10"]);
  expect(errors).toEqual([]);
});

test("every workout can be logged on one day and reloads", async ({ page }) => {
  const errors = await openApp(page);
  const cases = [
    { type: "monday", ids: ["m2"] },
    { type: "wednesday", ids: ["w6"] },
    { type: "weekend", ids: ["s7"] },
    { type: "recovery", ids: ["r1"] },
    { type: "kettlebell", ids: ["k2"] },
  ];
  for (const c of cases) {
    await workout(page, c.type).click();
    await checkOff(page, c.ids);
    await save(page);
  }
  await workout(page, "recreational").click();
  await page.locator("#recActivity").fill("Pickup basketball");
  await page.locator("#recDuration").fill("75");
  await page.locator("#recIntensity").selectOption("hard");
  await page.locator("#recCompleted").check();
  await save(page);

  const types = ["kettlebell", "monday", "recovery", "recreational", "wednesday", "weekend"];
  expect(await sessionKeys(page)).toEqual(types.map((t) => `session:2026-10-07_${t}`));
  const rec = JSON.parse(await readKey(page, "session:2026-10-07_recreational"));
  expect(rec).toMatchObject({
    sessionType: "recreational", exercises: [], hardcore: false,
    activity: { name: "Pickup basketball", duration: 75, intensity: "hard", completed: true },
    cardio: { name: "Recreational activity", completed: true },
  });

  await page.reload();
  await expect(page.locator(".workout-pill.logged")).toHaveCount(6);
  for (const c of cases) {
    await workout(page, c.type).click();
    for (const id of c.ids) await expect(page.locator(`.done-check[data-id="${id}"]`)).toBeChecked();
  }
  await workout(page, "recreational").click();
  await expect(page.locator("#recActivity")).toHaveValue("Pickup basketball");
  await expect(page.locator("#recDuration")).toHaveValue("75");
  await expect(page.locator("#recIntensity")).toHaveValue("hard");

  await tab(page, "history").click();
  await expect(page.locator(".hist-item")).toHaveCount(6);
  await tab(page, "progress").click();
  await expect(page.locator("#trendWrap table tr").first()).toHaveText("This week6");
  expect(errors).toEqual([]);
});

test("no state bleeds between days or workouts", async ({ page }) => {
  const errors = await openApp(page);
  await day(page, "2026-10-05").click();
  await page.locator("#hardcoreToggle").click();
  await expect(page.locator("#hardcoreToggle")).toHaveClass(/on/);
  await page.locator('.done-check[data-id="m1"]').check(); // unsaved

  await workout(page, "wednesday").click();
  await expect(page.locator("#hardcoreToggle")).not.toHaveClass(/on/);
  await expect(page.locator(".hc-badge")).toHaveCount(0);

  await workout(page, "monday").click();
  await page.locator("#hardcoreToggle").click();
  await day(page, "2026-10-06").click();
  await expect(page.locator("#hardcoreToggle")).not.toHaveClass(/on/);
  await expect(page.locator('.done-check[data-id="m1"]')).not.toBeChecked();

  // Freeform mode hides the toggle + cardio card; a lift workout must restore them.
  await workout(page, "recreational").click();
  await expect(page.locator("#hardcoreToggle")).toBeHidden();
  await expect(page.locator("#cardioCard")).toBeHidden();
  await workout(page, "kettlebell").click();
  await expect(page.locator("#hardcoreToggle")).toBeVisible();
  await expect(page.locator("#cardioCard")).toBeVisible();
  await expect(page.locator(".exercise-row")).toHaveCount(9);
  expect(errors).toEqual([]);
});

test("reads data in the original shape; a logged day opens on its workout", async ({ page }) => {
  const errors = await openSeeded(page, {
    "session:2026-09-28_monday": { ...mondaySession("2026-09-28", 25), hardcore: true },
    "session:2026-10-05_monday": mondaySession("2026-10-05", 30),
    "session:2026-10-06_recreational": {
      dateKey: "2026-10-06", dateDisplay: "Tuesday, Oct 6", sessionType: "recreational",
      dayLabel: "Recreational / Sports — Tennis", hardcore: false, exercises: [],
      activity: { name: "Tennis", duration: 60, intensity: "moderate", completed: true },
      cardio: { name: "Recreational activity", completed: true }, savedAt: "2026-10-06T18:00:00.000Z",
    },
    "unrelated-key": "ignored",
    "session:garbage": "not json",
    "session:2026-10-01_monday": { note: "missing fields" },
  });
  await tab(page, "history").click();
  await expect(page.locator(".hist-item")).toHaveCount(3);
  await expect(page.locator(".hist-day").first()).toHaveText("Recreational / Sports — Tennis");
  // Old weights still show in the Log details.
  await page.locator(".hist-top").nth(1).click();
  await expect(page.locator(".hist-details.open .hist-row")).toHaveText(["Goblet Squat (DB)30 lb · ✓"]);
  await tab(page, "progress").click();
  await expect(page.locator('.comp-row[data-id="m1"] .comp-count')).toHaveText("2/2");
  // Tuesday is normally Body A, but it has a Play session logged, so it opens on that.
  await day(page, "2026-10-06").click();
  await expect(workout(page, "recreational")).toHaveClass(/selected/);
  await expect(page.locator("#recActivity")).toHaveValue("Tennis");
  expect(errors).toEqual([]);
});

test("user text is escaped and a blank duration never shows 'null min'", async ({ page }) => {
  const errors = await openApp(page);
  const name = `Tom's "5v5" <b>ball</b> & <img src=x onerror="window.__pwned=1">`;
  await workout(page, "recreational").click();
  await page.locator("#recActivity").fill(name);
  await save(page);

  await page.reload();
  await workout(page, "recreational").click();
  await expect(page.locator("#recActivity")).toHaveValue(name);
  await tab(page, "history").click();
  await expect(page.locator(".hist-summary")).toHaveText("moderate—");
  await expect(page.locator(".hist-day")).toHaveText(`Recreational / Sports — ${name}`);
  await page.locator(".hist-top").click();
  await expect(page.locator(".hist-row").nth(1)).toHaveText("Duration—");
  await expect(page.locator("#historyCard b, #historyCard img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("hostile values in stored lift data are escaped", async ({ page }) => {
  const errors = await openSeeded(page, {
    "session:2026-10-05_monday": {
      ...mondaySession("2026-10-05", `"><img src=x onerror="window.__pwned=1">`),
      dayLabel: `<img src=x onerror="window.__pwned=1">`,
      exercises: [{ id: "m1", name: `<img src=x onerror="window.__pwned=1">`, weight: `"><img src=x onerror="window.__pwned=1">`, completed: true }],
    },
  });
  await day(page, "2026-10-05").click();
  await tab(page, "history").click();
  await page.locator(".hist-top").click();
  await tab(page, "progress").click();
  await expect(page.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("export file then import into an empty browser round-trips everything", async ({ page, browser }) => {
  const errors = await openApp(page);
  await day(page, "2026-10-05").click();
  await checkOff(page, ["m1"]);
  await save(page);
  await workout(page, "recreational").click();
  await page.locator("#recActivity").fill("Tennis");
  await save(page);

  await tab(page, "history").click();
  const downloadP = page.waitForEvent("download");
  await page.locator("#exportBtn").click();
  const download = await downloadP;
  expect(download.suggestedFilename()).toBe("training-log-backup-2026-10-07.json");
  const file = path.join(test.info().outputDir, "backup.json");
  await download.saveAs(file);
  await expect(page.locator("#backupNote")).toContainText("Exported 2 sessions");
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(backup.format).toBe("training-log-backup");
  expect(backup.version).toBe(1);
  expect(Object.keys(backup.sessions).sort()).toEqual(["session:2026-10-05_monday", "session:2026-10-05_recreational"]);
  const originals = {};
  for (const k of Object.keys(backup.sessions)) originals[k] = JSON.parse(await readKey(page, k));
  expect(backup.sessions).toEqual(originals);

  const backupUpload = { name: "backup.json", mimeType: "application/json", buffer: fs.readFileSync(file) };
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  const errors2 = await openApp(page2);
  await tab(page2, "history").click();
  await page2.locator("#importFile").setInputFiles(backupUpload);
  await expect(page2.locator("#backupNote")).toHaveText("Import done: 2 added, 0 updated.");
  await expect(page2.locator(".hist-item")).toHaveCount(2);
  for (const k of Object.keys(originals)) expect(JSON.parse(await readKey(page2, k))).toEqual(originals[k]);
  await expect(day(page2, "2026-10-05")).toHaveClass(/done/);

  // Re-importing the same file changes nothing.
  await page2.locator("#importFile").setInputFiles(backupUpload);
  await expect(page2.locator("#backupNote")).toHaveText("Import done: 0 added, 0 updated, 2 kept (local copy same or newer).");
  await ctx2.close();
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
});

test("pasted import: newer wins, older kept, invalid skipped, raw window.storage dumps accepted", async ({ page }) => {
  const errors = await openSeeded(page, {
    "session:2026-10-05_monday": mondaySession("2026-10-05", 30, "2026-10-05T18:00:00.000Z"),
    "session:2026-10-04_monday": mondaySession("2026-10-04", 28, "2026-10-04T18:00:00.000Z"),
  });
  await tab(page, "history").click();
  const paste = {
    // Bare key → JSON-string map, the way window.storage stores values.
    "session:2026-10-05_monday": JSON.stringify(mondaySession("2026-10-05", 35, "2026-10-06T08:00:00.000Z")),
    "session:2026-10-04_monday": mondaySession("2026-10-04", 20, "2026-10-01T00:00:00.000Z"),
    "session:2026-10-03_monday": mondaySession("2026-10-03", 27),
    "session:2026-10-02_monday": mondaySession("2026-10-09", 1), // key/date mismatch
    "session:2026-10-01_monday": "{not json",
    "other:key": mondaySession("2026-10-01", 1),
  };
  await page.locator("#backupText").fill(JSON.stringify(paste));
  await page.locator("#importPasteBtn").click();
  await expect(page.locator("#backupNote")).toHaveText(
    "Import done: 1 added, 1 updated, 1 kept (local copy same or newer), 3 skipped (invalid).");
  expect(await sessionKeys(page)).toEqual(
    ["session:2026-10-03_monday", "session:2026-10-04_monday", "session:2026-10-05_monday"]);
  expect(JSON.parse(await readKey(page, "session:2026-10-05_monday")).exercises[0].weight).toBe(35);
  expect(JSON.parse(await readKey(page, "session:2026-10-04_monday")).exercises[0].weight).toBe(28);
  await expect(page.locator(".hist-item")).toHaveCount(3);

  await page.locator("#backupText").fill("nope");
  await page.locator("#importPasteBtn").click();
  await expect(page.locator("#backupNote")).toHaveText("That isn't valid JSON — nothing imported.");
  expect(errors).toEqual([]);
});

test("Copy JSON uses the clipboard, or falls back to the text box", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors = await openApp(page);
  await save(page);
  await tab(page, "history").click();
  await page.locator("#copyBtn").click();
  await expect(page.locator("#backupNote")).toHaveText("Copied 1 session to the clipboard.");
  const clip = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(Object.keys(clip.sessions)).toEqual(["session:2026-10-07_wednesday"]);

  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error("blocked")); });
  await page.locator("#copyBtn").click();
  await expect(page.locator("#backupNote")).toContainText("Clipboard blocked");
  const boxed = JSON.parse(await page.locator("#backupText").inputValue());
  expect(Object.keys(boxed.sessions)).toEqual(["session:2026-10-07_wednesday"]);
  expect(errors).toEqual([]);
});

test("inside a Claude.ai artifact, window.storage is used and exportable", async ({ page }) => {
  const errors = await openApp(page, {
    beforeLoad: () => {
      const mem = new Map([["session:2026-09-30_wednesday", JSON.stringify({
        dateKey: "2026-09-30", dateDisplay: "Wednesday, Sep 30", sessionType: "wednesday",
        dayLabel: "Wednesday — Full Body B", hardcore: false,
        exercises: [{ id: "w2", name: "DB Shoulder Press", weight: 15, completed: true }],
        cardio: { name: "Steady-state bike", completed: true }, savedAt: "2026-09-30T18:00:00.000Z",
      })]]);
      window.__artifactStore = mem;
      window.storage = {
        async get(k) { return mem.has(k) ? { key: k, value: mem.get(k) } : null; },
        async set(k, v) { mem.set(k, v); return { key: k, value: v }; },
        async delete(k) { mem.delete(k); return { key: k, deleted: true }; },
        async list(p = "") { return { keys: [...mem.keys()].filter((k) => k.startsWith(p)) }; },
      };
    },
  });
  await checkOff(page, ["w2"]);
  await save(page);
  expect(await page.evaluate(() => [...window.__artifactStore.keys()].sort()))
    .toEqual(["session:2026-09-30_wednesday", "session:2026-10-07_wednesday"]);
  expect(await sessionKeys(page)).toEqual([]); // nothing written to localStorage
  await tab(page, "history").click();
  await expect(page.locator(".hist-item")).toHaveCount(2);
  const downloadP = page.waitForEvent("download");
  await page.locator("#exportBtn").click();
  const backup = JSON.parse(fs.readFileSync(await (await downloadP).path(), "utf8"));
  expect(Object.keys(backup.sessions).sort())
    .toEqual(["session:2026-09-30_wednesday", "session:2026-10-07_wednesday"]);
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
