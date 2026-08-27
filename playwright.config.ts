import { defineConfig, devices } from "@playwright/test";

import { assertReleaseE2eEnvironment } from "./src/server/release/e2e-isolation";

const enabled = Boolean(process.env.E2E_DATABASE_URL);
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3101";
const port = new URL(baseURL).port || "3101";
const packageRunner = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const useProductionServer = process.env.E2E_SERVER_MODE === "production";
if (enabled) {
  assertReleaseE2eEnvironment({
    databaseUrl: process.env.E2E_DATABASE_URL!,
    baseUrl: baseURL,
    serverMode: process.env.E2E_SERVER_MODE,
    localRuntimeMode: process.env.LOCAL_RUNTIME_MODE,
  });
}
const webServerCommand = useProductionServer
  ? "node --env-file=.env.local scripts/start-production.mjs"
  : `${packageRunner} dev:all`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "artifacts/playwright-report" }]],
  outputDir: "artifacts/playwright",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Edge"],
    channel: "msedge",
  },
  webServer: enabled ? {
    command: webServerCommand,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: process.env.E2E_DATABASE_URL!,
      E2E_RATE_LIMIT_BYPASS: "1",
      AI_ADAPTER: "test",
      AI_LOG_HMAC_KEY: process.env.AI_LOG_HMAC_KEY ?? "e2e-ai-input-integrity-key-32-characters",
      APP_URL: baseURL,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-auth-secret-at-least-32-characters-long",
      AUTH_TRUSTED_PROXIES: "127.0.0.1/32,::1/128",
      NEXT_PUBLIC_APP_URL: baseURL,
      PORT: port,
      RATE_LIMIT_TRUST_PROXY: "1",
    },
  } : undefined,
});
