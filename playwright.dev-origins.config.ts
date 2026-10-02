import { defineConfig, devices } from "@playwright/test";

// 单独运行日常开发拓扑；生产门禁不承担 HMR / 开发来源校验。
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "dev-origins.spec.ts",
  outputDir: "test-results/dev-origins",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { ...devices["Desktop Chrome"] },
  webServer: {
    command: "E2E_APP_MODE=development E2E_DEV_ORIGINS=true node --import tsx tests/e2e/start-test-app.ts",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
  },
  projects: ["localhost", "127.0.0.1"].map(hostname => ({
    name: hostname,
    use: { baseURL: `http://${hostname}:3100` },
  })),
});
