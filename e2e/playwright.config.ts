import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for GitHub notifications webapp E2E tests.
 *
 * The tests run against the FastAPI server which serves:
 * - API endpoints at /notifications/html/*, /github/*
 * - Static webapp at /app/
 */
export default defineConfig({
  testDir: './tests',

  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI for stability
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list']
  ],

  // Shared settings for all projects
  use: {
    // Base URL for the webapp
    baseURL: 'http://localhost:8000/app/',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run local dev server before starting the tests
  webServer: {
    command: 'cd .. && uv run python -m ghsim.api.server --test --no-reload --port 8000',
    url: 'http://localhost:8000/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },

  // Output directory for test artifacts
  outputDir: 'test-results',
});
