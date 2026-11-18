import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  testDir: "./screenshot-specs",
  outputDir: "../../test-results/playwright-screenshots",
  use: {
    ...baseConfig.use,
    browserName: "firefox",
    screenshot: "off",
    trace: "off"
  }
});
