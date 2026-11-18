import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:8083",
    browserName: "firefox",
    viewport: { width: 430, height: 932 },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    name: "mobile",
    command: "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=synthetic-test-key npm run build && npm exec expo -- serve --port 8083",
    cwd: "../../apps/mobile",
    url: "http://127.0.0.1:8083",
    reuseExistingServer: false,
    timeout: 90_000
  }
});
