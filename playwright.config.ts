import { defineConfig, devices } from "@playwright/test";

import { e2eAgentEntryTheme, e2eAppMode } from "./tests/e2e/support/app-mode";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseUrl ?? "http://127.0.0.1:3100";
const appMode = e2eAppMode();
const theme = e2eAgentEntryTheme();
if (externalBaseUrl && (
  process.env.E2E_EXTERNAL_ISOLATED !== "true"
  || !process.env.E2E_APP_MODE
  || !process.env.NEXT_PUBLIC_AGENT_ENTRY_THEME
)) {
  throw new Error("外部 E2E 服务必须明确设置 E2E_EXTERNAL_ISOLATED=true、E2E_APP_MODE 和 NEXT_PUBLIC_AGENT_ENTRY_THEME，确认隔离环境及其构建主题。");
}
const softwareWebGL = process.env.E2E_SOFTWARE_WEBGL === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/playwright",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  metadata: { appMode, agentEntryBuildTheme: theme, softwareWebGL },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: softwareWebGL
      ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }
      : undefined,
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "node --import tsx tests/e2e/start-test-app.ts",
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: appMode === "production" ? 600_000 : 180_000,
        gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
      },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "public",
      testMatch: /(?:^|\/)(?:public|agent-entry-public)\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "authenticated",
      testMatch: /(?:^|\/)(?:authenticated|agent-entry-authenticated|agent-answer-quality|blog-drafts|blog-user-boundary|blog-presentation|response-diagnostics)\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "test-results/.auth/user-one.json",
      },
    },
  ],
});
