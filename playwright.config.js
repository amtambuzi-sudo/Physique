// @ts-check
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  reporter: "list",
  use: { ...devices["iPhone 13"], browserName: "chromium" },
});
