import { defineConfig, devices } from '@playwright/test';

const targetUrl = process.env.BASE_URL;
const port = process.env.SHOP_PORT ?? '3100';
const baseURL = targetUrl || `http://127.0.0.1:${port}`;
const healthUrl = new URL('/api/health', baseURL).href;
const smokeSpec = '**/*.smoke.spec.ts';
const uatSpec = '**/*.uat.spec.ts';
const apiSpec = '**/*.api.spec.ts';
const regressionBrowsers = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ...(process.env.PLAYWRIGHT_FULL_MATRIX === '1' ? [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ] : []),
];

export default defineConfig({
  testDir: './tests',
  globalSetup: targetUrl ? './tests/support/wait-for-public-shop.ts' : undefined,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 25_000,
  expect: { timeout: 5_000 },
  reporter: [
    [process.env.CI ? 'line' : 'list'],
    ['html', { open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    baseURL,
    locale: 'ru-RU',
    actionTimeout: 8_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    // Stock and account tests run only against the server started for this run.
    ...(!targetUrl ? [
      ...regressionBrowsers.map(browser => ({ ...browser, testIgnore: [smokeSpec, apiSpec] })),
      { name: 'api', testMatch: apiSpec },
    ] : []),
    ...(!targetUrl && process.env.PLAYWRIGHT_FULL_MATRIX === '1' ? [
      { name: 'mobile-chromium', testMatch: uatSpec, use: { ...devices['Pixel 7'] } },
      { name: 'mobile-webkit', testMatch: uatSpec, use: { ...devices['iPhone 13'] } },
    ] : []),
    {
      name: 'smoke-chromium',
      testMatch: smokeSpec,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'smoke-firefox',
      testMatch: smokeSpec,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'smoke-webkit',
      testMatch: smokeSpec,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: targetUrl ? undefined : {
    command: 'node scripts/start-shop.mjs',
    url: healthUrl,
    env: { SHOP_PORT: port },
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    timeout: 15_000,
  },
});
