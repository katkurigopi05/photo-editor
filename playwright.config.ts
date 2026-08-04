import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests, required by Phase 5 and Phase 6 of the roadmap.
 *
 * These exist because the bugs that actually shipped were invisible to the unit
 * suite: GIF export silently discarded opacity and transparency, a still export
 * wrote the frame from before the last seek, and a missing package export
 * crashed the app at load while 385 tests stayed green. Every check here drives
 * the real UI and then *decodes the file the app produced*, rather than
 * inspecting the code that produced it.
 *
 * `.spec.ts` rather than `.test.ts` on purpose: vitest.config.ts globs
 * `apps/**\/*.test.ts`, so the two runners cannot pick up each other's files.
 */
const PORT = 5199;

export default defineConfig({
  testDir: "./apps/web/e2e",
  // Exports are genuinely slow — a 5s MP4 takes ~30s because every frame waits
  // for a decoded video frame, which is the fix for the stale-frame bug.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // Encoding is CPU-bound; parallel workers just contend and time out.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The build is not optional: Vite serves workspace packages from `dist/`,
    // while vitest aliases them to `src/`. A stale dist is invisible to the
    // unit suite and fatal to the browser — see LESSONS.md 2026-08-03.
    command: `pnpm build && pnpm --filter @director/web dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
