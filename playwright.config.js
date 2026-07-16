// @ts-check
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8744",
    headless: true,
    viewport: { width: 1280, height: 960 },
    actionTimeout: 15000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "python3 -m http.server 8744",
    port: 8744,
    cwd: "./dist",
    reuseExistingServer: false,
    timeout: 10000,
    stdout: "ignore",
    stderr: "ignore",
  },
});