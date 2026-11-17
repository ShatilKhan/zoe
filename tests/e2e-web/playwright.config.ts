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
    channel: "chrome",
    viewport: { width: 430, height: 932 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      name: "mobile",
      command: "npm run build -w @zoe/mobile && npm exec vite -- apps/mobile/dist --host 127.0.0.1 --port 8083",
      cwd: "../..",
      url: "http://127.0.0.1:8083",
      reuseExistingServer: false,
      timeout: 90_000
    },
    {
      name: "clinician",
      command: "npm run build -w @zoe/clinician-web && npm exec vite -- apps/clinician-web/dist --host 127.0.0.1 --port 4173",
      cwd: "../..",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 90_000
    }
  ]
});
